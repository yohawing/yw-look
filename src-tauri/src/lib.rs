use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const SETTINGS_FILE_NAME: &str = "settings.json";
const RECENT_FILES_FILE_NAME: &str = "recent-files.json";
const DIAGNOSTICS_LOG_FILE_NAME: &str = "diagnostics.log";
const MODEL_EXTENSIONS: &[&str] = &[
    "glb", "gltf", "fbx", "obj", "ply", "stl", "usd", "dae", "vrm", "pmd", "pmx",
];
const TEXTURE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "tga", "dds", "ktx2", "hdr", "exr"];
const FILE_ASSOCIATION_EXTENSIONS: &[&str] = &[
    "glb", "gltf", "fbx", "obj", "ply", "stl", "png", "jpg", "jpeg", "tga", "dds", "hdr", "exr",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    version: u32,
    recent_files_limit: usize,
    diagnostics_log_level: String,
    file_associations_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsPayload {
    settings_path: String,
    settings: AppSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectedFilePayload {
    path: String,
    file_name: String,
    extension: String,
    kind: String,
    parent_directory: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryListingPayload {
    files: Vec<SelectedFilePayload>,
    current_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentFileEntry {
    path: String,
    kind: String,
    last_accessed_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentFilesPayload {
    recent_files_path: String,
    entries: Vec<RecentFileEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsPayload {
    diagnostics_log_path: String,
    diagnostics_snapshot: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IntegrationPayload {
    file_associations_enabled: bool,
    install_strategy: String,
    supported_extensions: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticRecordInput {
    code: String,
    level: String,
    message: String,
    detail: Option<String>,
    context_path: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            version: 2,
            recent_files_limit: 20,
            diagnostics_log_level: "info".to_string(),
            file_associations_enabled: false,
        }
    }
}

fn current_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();

    seconds.to_string()
}

fn resolve_app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|error| format!("failed to resolve app config directory: {error}"))
}

fn resolve_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(resolve_app_data_dir(app)?.join(SETTINGS_FILE_NAME))
}

fn resolve_recent_files_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(resolve_app_data_dir(app)?.join(RECENT_FILES_FILE_NAME))
}

fn resolve_diagnostics_log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(resolve_app_data_dir(app)?.join(DIAGNOSTICS_LOG_FILE_NAME))
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "path has no parent directory".to_string())?;

    fs::create_dir_all(parent).map_err(|error| format!("failed to create directory: {error}"))
}

fn write_json_file<T: Serialize>(path: &Path, payload: &T) -> Result<(), String> {
    ensure_parent_dir(path)?;
    let json = serde_json::to_string_pretty(payload)
        .map_err(|error| format!("failed to serialize json: {error}"))?;
    fs::write(path, json).map_err(|error| format!("failed to write file: {error}"))
}

fn read_json_file<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> Result<T, String> {
    if !path.exists() {
        return Ok(T::default());
    }

    let raw = fs::read_to_string(path).map_err(|error| format!("failed to read file: {error}"))?;
    serde_json::from_str::<T>(&raw).map_err(|error| format!("failed to parse json: {error}"))
}

fn write_settings_file(path: &Path, settings: &AppSettings) -> Result<(), String> {
    write_json_file(path, settings)
}

fn infer_file_kind(extension: &str) -> String {
    if MODEL_EXTENSIONS.contains(&extension) {
        "model".to_string()
    } else if TEXTURE_EXTENSIONS.contains(&extension) {
        "texture".to_string()
    } else {
        "unknown".to_string()
    }
}

fn is_supported_extension(extension: &str) -> bool {
    MODEL_EXTENSIONS.contains(&extension) || TEXTURE_EXTENSIONS.contains(&extension)
}

fn normalize_file_path(path: PathBuf) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!("file does not exist: {}", path.display()));
    }

    if !path.is_file() {
        return Err(format!("path is not a file: {}", path.display()));
    }

    path.canonicalize()
        .map_err(|error| format!("failed to normalize file path: {error}"))
}

fn build_selected_file_payload(path: PathBuf) -> Result<SelectedFilePayload, String> {
    let normalized = normalize_file_path(path)?;

    let extension = normalized
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    if !is_supported_extension(&extension) {
        return Err(format!("unsupported file extension: {extension}"));
    }

    let file_name = normalized
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "failed to resolve file name".to_string())?
        .to_string();

    let parent_directory = normalized
        .parent()
        .map(|value| value.display().to_string())
        .ok_or_else(|| "failed to resolve parent directory".to_string())?;

    Ok(SelectedFilePayload {
        path: normalized.display().to_string(),
        file_name,
        extension: extension.clone(),
        kind: infer_file_kind(&extension),
        parent_directory,
    })
}

fn list_supported_files_in_directory(directory: &Path) -> Result<Vec<SelectedFilePayload>, String> {
    let mut files = fs::read_dir(directory)
        .map_err(|error| format!("failed to read directory: {error}"))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| build_selected_file_payload(entry.path()).ok())
        .collect::<Vec<_>>();

    files.sort_by(|left, right| {
        left.file_name
            .to_ascii_lowercase()
            .cmp(&right.file_name.to_ascii_lowercase())
    });

    Ok(files)
}

fn load_or_initialize_settings(app: &tauri::AppHandle) -> Result<(PathBuf, AppSettings), String> {
    let settings_path = resolve_settings_path(app)?;

    let settings = if settings_path.exists() {
        let raw = fs::read_to_string(&settings_path)
            .map_err(|error| format!("failed to read settings file: {error}"))?;

        serde_json::from_str::<AppSettings>(&raw)
            .map_err(|error| format!("failed to parse settings file: {error}"))?
    } else {
        let defaults = AppSettings::default();
        write_settings_file(&settings_path, &defaults)?;
        defaults
    };

    Ok((settings_path, settings))
}

fn load_recent_file_entries(app: &tauri::AppHandle) -> Result<(PathBuf, Vec<RecentFileEntry>), String> {
    let recent_files_path = resolve_recent_files_path(app)?;

    if !recent_files_path.exists() {
        write_json_file(&recent_files_path, &Vec::<RecentFileEntry>::new())?;
    }

    let entries = read_json_file::<Vec<RecentFileEntry>>(&recent_files_path)?;
    Ok((recent_files_path, entries))
}

fn save_recent_file_entries(path: &Path, entries: &[RecentFileEntry]) -> Result<(), String> {
    write_json_file(path, &entries.to_vec())
}

fn append_diagnostic_record(app: &tauri::AppHandle, record: &DiagnosticRecordInput) -> Result<(), String> {
    let log_path = resolve_diagnostics_log_path(app)?;
    ensure_parent_dir(&log_path)?;

    let line = serde_json::json!({
        "timestamp": current_timestamp(),
        "code": record.code,
        "level": record.level,
        "message": record.message,
        "detail": record.detail,
        "contextPath": record.context_path,
    })
    .to_string();

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("failed to open diagnostics log: {error}"))?;

    writeln!(file, "{line}").map_err(|error| format!("failed to append diagnostics log: {error}"))
}

fn sync_recent_file(app: &tauri::AppHandle, file: &SelectedFilePayload) -> Result<(), String> {
    let (_, settings) = load_or_initialize_settings(app)?;
    let (recent_files_path, mut entries) = load_recent_file_entries(app)?;

    entries.retain(|entry| entry.path != file.path && Path::new(&entry.path).exists());
    entries.insert(
        0,
        RecentFileEntry {
            path: file.path.clone(),
            kind: file.kind.clone(),
            last_accessed_at: current_timestamp(),
        },
    );
    entries.truncate(settings.recent_files_limit);

    save_recent_file_entries(&recent_files_path, &entries)
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<SettingsPayload, String> {
    let (settings_path, settings) = load_or_initialize_settings(&app)?;

    Ok(SettingsPayload {
        settings_path: settings_path.display().to_string(),
        settings,
    })
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<SettingsPayload, String> {
    let settings_path = resolve_settings_path(&app)?;
    write_settings_file(&settings_path, &settings)?;

    Ok(SettingsPayload {
        settings_path: settings_path.display().to_string(),
        settings,
    })
}

#[tauri::command]
fn open_file_dialog(app: tauri::AppHandle) -> Result<Option<SelectedFilePayload>, String> {
    let file_path = FileDialog::new()
        .set_title("Open asset file")
        .add_filter(
            "Supported assets",
            &[
                "glb", "gltf", "fbx", "obj", "ply", "stl", "usd", "dae", "vrm", "pmd", "pmx",
                "png", "jpg", "jpeg", "tga", "dds", "ktx2", "hdr", "exr",
            ],
        )
        .pick_file();

    let file = file_path.map(build_selected_file_payload).transpose()?;

    if let Some(ref payload) = file {
        sync_recent_file(&app, payload)?;
    }

    Ok(file)
}

#[tauri::command]
fn resolve_selected_file(app: tauri::AppHandle, path: String) -> Result<SelectedFilePayload, String> {
    let payload = build_selected_file_payload(PathBuf::from(path))?;
    sync_recent_file(&app, &payload)?;
    Ok(payload)
}

#[tauri::command]
fn list_supported_siblings(path: String) -> Result<DirectoryListingPayload, String> {
    let file = build_selected_file_payload(PathBuf::from(path))?;
    let files = list_supported_files_in_directory(Path::new(&file.parent_directory))?;
    let current_index = files.iter().position(|entry| entry.path == file.path);

    Ok(DirectoryListingPayload { files, current_index })
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    fs::read(normalized).map_err(|error| format!("failed to read file bytes: {error}"))
}

#[tauri::command]
fn get_startup_file(app: tauri::AppHandle) -> Result<Option<SelectedFilePayload>, String> {
    for argument in std::env::args().skip(1) {
        if let Ok(file) = build_selected_file_payload(PathBuf::from(argument)) {
            sync_recent_file(&app, &file)?;
            return Ok(Some(file));
        }
    }

    Ok(None)
}

#[tauri::command]
fn load_recent_files(app: tauri::AppHandle) -> Result<RecentFilesPayload, String> {
    let (recent_files_path, mut entries) = load_recent_file_entries(&app)?;
    entries.retain(|entry| Path::new(&entry.path).exists());
    save_recent_file_entries(&recent_files_path, &entries)?;

    Ok(RecentFilesPayload {
        recent_files_path: recent_files_path.display().to_string(),
        entries,
    })
}

#[tauri::command]
fn load_supported_extensions(app: tauri::AppHandle) -> Result<IntegrationPayload, String> {
    let (_, settings) = load_or_initialize_settings(&app)?;

    Ok(IntegrationPayload {
        file_associations_enabled: settings.file_associations_enabled,
        install_strategy: "NSIS/WiX installer registration on Windows; runtime toggle stored in settings for future installer wiring.".to_string(),
        supported_extensions: FILE_ASSOCIATION_EXTENSIONS
            .iter()
            .map(|extension| format!(".{extension}"))
            .collect(),
    })
}

#[tauri::command]
fn log_diagnostic_event(app: tauri::AppHandle, record: DiagnosticRecordInput) -> Result<(), String> {
    append_diagnostic_record(&app, &record)
}

#[tauri::command]
fn load_diagnostics_snapshot(app: tauri::AppHandle) -> Result<DiagnosticsPayload, String> {
    let log_path = resolve_diagnostics_log_path(&app)?;
    ensure_parent_dir(&log_path)?;

    let diagnostics_snapshot = if log_path.exists() {
        let raw = fs::read_to_string(&log_path)
            .map_err(|error| format!("failed to read diagnostics log: {error}"))?;

        raw.lines()
            .rev()
            .take(50)
            .map(|line| line.to_string())
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    } else {
        Vec::new()
    };

    Ok(DiagnosticsPayload {
        diagnostics_log_path: log_path.display().to_string(),
        diagnostics_snapshot,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            open_file_dialog,
            resolve_selected_file,
            list_supported_siblings,
            read_binary_file,
            get_startup_file,
            load_recent_files,
            load_supported_extensions,
            log_diagnostic_event,
            load_diagnostics_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running yw-look");
}
