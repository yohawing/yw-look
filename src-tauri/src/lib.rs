use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{Read as IoRead, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Manager;
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

const SETTINGS_FILE_NAME: &str = "settings.json";
const RECENT_FILES_FILE_NAME: &str = "recent-files.json";
const DIAGNOSTICS_LOG_FILE_NAME: &str = "diagnostics.log";
const MENU_ACTION_EVENT: &str = "yw-look://menu-action";
const SHARED_MENU_DEFINITION_JSON: &str = include_str!("../../src/lib/menu-definition.json");
const DEFAULT_UPDATER_ENDPOINT: Option<&str> = option_env!("YW_LOOK_UPDATER_ENDPOINT");
const DEFAULT_UPDATER_PUBLIC_KEY: Option<&str> = option_env!("YW_LOOK_UPDATER_PUBLIC_KEY");
const MODEL_EXTENSIONS: &[&str] = &[
    "glb", "gltf", "fbx", "obj", "ply", "stl", "usd", "usda", "usdc", "usdz", "dae", "vrm", "pmd", "pmx",
];
const TEXTURE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "tga", "dds", "ktx2", "hdr", "exr"];
const FILE_ASSOCIATION_EXTENSIONS: &[&str] = &[
    "glb", "gltf", "fbx", "obj", "ply", "stl", "usd", "usda", "usdc", "usdz", "png", "jpg", "jpeg", "tga", "dds", "hdr", "exr",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct AppSettings {
    version: u32,
    recent_files_limit: usize,
    diagnostics_log_level: String,
    file_associations_enabled: bool,
    update_endpoint_override: Option<String>,
    update_public_key_override: Option<String>,
    allow_insecure_update_endpoint: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateConfigurationPayload {
    current_version: String,
    default_endpoint: Option<String>,
    default_pubkey_available: bool,
    effective_endpoint: Option<String>,
    effective_pubkey_available: bool,
    using_override_endpoint: bool,
    using_override_pubkey: bool,
    allow_insecure_update_endpoint: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateMetadataPayload {
    version: String,
    current_version: String,
    notes: Option<String>,
    pub_date: Option<String>,
    target: String,
    download_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckPayload {
    configuration: UpdateConfigurationPayload,
    update: Option<UpdateMetadataPayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInstallPayload {
    installed_version: String,
    restart_required: bool,
    note: String,
}

#[derive(Default)]
struct PendingUpdateState(Mutex<Option<Update>>);

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetInspection {
    path: String,
    file_name: String,
    extension: String,
    kind: String,
    file_size_bytes: u64,
    modified_at: Option<String>,
    created_at: Option<String>,
    preview_implemented: bool,
    image_dimensions: Option<ImageDimensions>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageDimensions {
    width: u32,
    height: u32,
    source: String,
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

#[cfg(desktop)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedMenuDefinition {
    sections: Vec<SharedMenuSection>,
}

#[cfg(desktop)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedMenuSection {
    id: String,
    label: String,
    entries: Vec<SharedMenuEntry>,
}

#[cfg(desktop)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedShortcutDefinition {
    key: String,
    ctrl_or_meta: Option<bool>,
    shift: Option<bool>,
    alt: Option<bool>,
}

#[cfg(desktop)]
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum SharedMenuEntry {
    Item {
        id: String,
        label: String,
        shortcut: Option<SharedShortcutDefinition>,
    },
    Separator,
    RecentFiles {
        label: String,
    },
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            version: 3,
            recent_files_limit: 20,
            diagnostics_log_level: "info".to_string(),
            file_associations_enabled: false,
            update_endpoint_override: None,
            update_public_key_override: None,
            allow_insecure_update_endpoint: false,
        }
    }
}

#[cfg(desktop)]
fn load_shared_menu_definition() -> Result<SharedMenuDefinition, String> {
    serde_json::from_str(SHARED_MENU_DEFINITION_JSON)
        .map_err(|error| format!("failed to parse shared menu definition: {error}"))
}

#[cfg(desktop)]
fn shortcut_to_accelerator(shortcut: &SharedShortcutDefinition) -> String {
    let mut keys: Vec<String> = Vec::new();

    if shortcut.ctrl_or_meta.unwrap_or(false) {
        keys.push("CmdOrCtrl".to_string());
    }
    if shortcut.shift.unwrap_or(false) {
        keys.push("Shift".to_string());
    }
    if shortcut.alt.unwrap_or(false) {
        keys.push("Alt".to_string());
    }

    keys.push(shortcut.key.to_uppercase());
    keys.join("+")
}

#[cfg(desktop)]
fn collect_menu_action_ids(definition: &SharedMenuDefinition) -> HashSet<String> {
    definition
        .sections
        .iter()
        .flat_map(|section| section.entries.iter())
        .filter_map(|entry| match entry {
            SharedMenuEntry::Item { id, .. } => Some(id.clone()),
            _ => None,
        })
        .collect()
}

#[cfg(desktop)]
fn build_native_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    definition: &SharedMenuDefinition,
) -> Result<Menu<R>, String> {
    let menu = Menu::new(app).map_err(|error| format!("failed to create menu: {error}"))?;

    for section in &definition.sections {
        let submenu = Submenu::with_id(app, section.id.clone(), &section.label, true)
            .map_err(|error| format!("failed to create submenu '{}': {error}", section.id))?;

        for entry in &section.entries {
            match entry {
                SharedMenuEntry::Item {
                    id,
                    label,
                    shortcut,
                } => {
                    let accelerator = shortcut.as_ref().map(shortcut_to_accelerator);
                    let item = MenuItem::with_id(
                        app,
                        id.clone(),
                        label,
                        true,
                        accelerator.as_deref(),
                    )
                    .map_err(|error| format!("failed to create menu item '{id}': {error}"))?;
                    submenu
                        .append(&item)
                        .map_err(|error| format!("failed to append menu item '{id}': {error}"))?;
                }
                SharedMenuEntry::Separator => {
                    let separator = PredefinedMenuItem::separator(app)
                        .map_err(|error| format!("failed to create menu separator: {error}"))?;
                    submenu
                        .append(&separator)
                        .map_err(|error| format!("failed to append menu separator: {error}"))?;
                }
                SharedMenuEntry::RecentFiles { label } => {
                    // Dynamic recent files listing is handled in the React menu UI.
                    // Native menu keeps a disabled placeholder until per-session sync is added.
                    let item = MenuItem::new(app, label, false, None::<&str>).map_err(|error| {
                        format!("failed to create disabled recent files item: {error}")
                    })?;
                    submenu
                        .append(&item)
                        .map_err(|error| format!("failed to append recent files item: {error}"))?;
                }
            }
        }

        menu.append(&submenu)
            .map_err(|error| format!("failed to append submenu '{}': {error}", section.id))?;
    }

    Ok(menu)
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn sanitize_settings(settings: AppSettings) -> AppSettings {
    AppSettings {
        version: settings.version.max(3),
        recent_files_limit: settings.recent_files_limit.max(1),
        diagnostics_log_level: if settings.diagnostics_log_level.trim().is_empty() {
            "info".to_string()
        } else {
            settings.diagnostics_log_level
        },
        file_associations_enabled: settings.file_associations_enabled,
        update_endpoint_override: normalize_optional_text(settings.update_endpoint_override),
        update_public_key_override: normalize_optional_text(settings.update_public_key_override),
        allow_insecure_update_endpoint: settings.allow_insecure_update_endpoint,
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

fn default_updater_endpoint() -> Option<String> {
    DEFAULT_UPDATER_ENDPOINT
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn default_updater_public_key() -> Option<String> {
    DEFAULT_UPDATER_PUBLIC_KEY
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn effective_updater_endpoint(settings: &AppSettings) -> Option<String> {
    settings
        .update_endpoint_override
        .clone()
        .or_else(default_updater_endpoint)
}

fn effective_updater_public_key(settings: &AppSettings) -> Option<String> {
    settings
        .update_public_key_override
        .clone()
        .or_else(default_updater_public_key)
}

fn is_loopback_update_endpoint(endpoint: &str) -> bool {
    endpoint.starts_with("http://127.0.0.1")
        || endpoint.starts_with("http://localhost")
        || endpoint.starts_with("http://[::1]")
}

fn current_app_version(app: &tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

fn build_update_configuration_payload(
    app: &tauri::AppHandle,
    settings: &AppSettings,
) -> UpdateConfigurationPayload {
    let default_endpoint = default_updater_endpoint();
    let default_pubkey = default_updater_public_key();
    let effective_endpoint = effective_updater_endpoint(settings);
    let effective_pubkey = effective_updater_public_key(settings);

    UpdateConfigurationPayload {
        current_version: current_app_version(app),
        default_endpoint,
        default_pubkey_available: default_pubkey.is_some(),
        effective_endpoint,
        effective_pubkey_available: effective_pubkey.is_some(),
        using_override_endpoint: settings.update_endpoint_override.is_some(),
        using_override_pubkey: settings.update_public_key_override.is_some(),
        allow_insecure_update_endpoint: settings.allow_insecure_update_endpoint,
    }
}

fn update_metadata_payload(update: &Update) -> UpdateMetadataPayload {
    UpdateMetadataPayload {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        pub_date: update.date.map(|date| date.to_string()),
        target: update.target.clone(),
        download_url: update.download_url.to_string(),
    }
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

    let canonical = path.canonicalize()
        .map_err(|error| format!("failed to normalize file path: {error}"))?;
    Ok(strip_verbatim_prefix(&canonical))
}

/// Remove the `\\?\` extended-length prefix that `canonicalize()` adds on Windows.
fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    let s = path.display().to_string();
    if s.starts_with(r"\\?\") {
        PathBuf::from(&s[4..])
    } else {
        path.to_path_buf()
    }
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

        sanitize_settings(
            serde_json::from_str::<AppSettings>(&raw)
            .map_err(|error| format!("failed to parse settings file: {error}"))?
        )
    } else {
        let defaults = sanitize_settings(AppSettings::default());
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

fn build_updater(
    app: &tauri::AppHandle,
    settings: &AppSettings,
) -> Result<tauri_plugin_updater::Updater, String> {
    let endpoint = effective_updater_endpoint(settings)
        .ok_or_else(|| "no updater endpoint configured".to_string())?;
    let pubkey = effective_updater_public_key(settings)
        .ok_or_else(|| "no updater public key configured".to_string())?;

    if !settings.allow_insecure_update_endpoint && endpoint.starts_with("http://") {
        return Err(
            "refusing insecure update endpoint; enable the local override toggle for loopback testing"
                .to_string(),
        );
    }

    if settings.allow_insecure_update_endpoint && !is_loopback_update_endpoint(&endpoint) {
        return Err("insecure update endpoints are restricted to localhost or 127.0.0.1".to_string());
    }

    let endpoint = Url::parse(&endpoint)
        .map_err(|error| format!("failed to parse updater endpoint: {error}"))?;

    app
        .updater_builder()
        .pubkey(pubkey)
        .endpoints(vec![endpoint])
        .map_err(|error| format!("failed to configure updater endpoints: {error}"))?
        .build()
        .map_err(|error| format!("failed to build updater client: {error}"))
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

const PREVIEW_IMPLEMENTED_EXTENSIONS: &[&str] = &[
    "glb", "gltf", "fbx", "obj", "ply", "stl",
    "png", "jpg", "jpeg", "tga", "dds", "hdr", "exr",
];

fn system_time_to_unix_string(time: SystemTime) -> Option<String> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs().to_string())
}

fn read_png_dimensions(path: &Path) -> Option<ImageDimensions> {
    let mut file = fs::File::open(path).ok()?;
    let mut header = [0u8; 24];
    file.read_exact(&mut header).ok()?;
    if &header[0..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }
    let width = u32::from_be_bytes([header[16], header[17], header[18], header[19]]);
    let height = u32::from_be_bytes([header[20], header[21], header[22], header[23]]);
    Some(ImageDimensions { width, height, source: "png-header".to_string() })
}

fn read_jpeg_dimensions(path: &Path) -> Option<ImageDimensions> {
    let data = fs::read(path).ok()?;
    if data.len() < 2 || data[0] != 0xFF || data[1] != 0xD8 {
        return None;
    }
    let mut offset = 2;
    while offset + 4 < data.len() {
        if data[offset] != 0xFF {
            break;
        }
        let marker = data[offset + 1];
        if marker == 0xC0 || marker == 0xC2 {
            if offset + 9 < data.len() {
                let height = u16::from_be_bytes([data[offset + 5], data[offset + 6]]) as u32;
                let width = u16::from_be_bytes([data[offset + 7], data[offset + 8]]) as u32;
                return Some(ImageDimensions { width, height, source: "jpeg-header".to_string() });
            }
            break;
        }
        let length = u16::from_be_bytes([data[offset + 2], data[offset + 3]]) as usize;
        offset += 2 + length;
    }
    None
}

fn read_dds_dimensions(path: &Path) -> Option<ImageDimensions> {
    let mut file = fs::File::open(path).ok()?;
    let mut header = [0u8; 20];
    file.read_exact(&mut header).ok()?;
    if &header[0..4] != b"DDS " {
        return None;
    }
    let height = u32::from_le_bytes([header[12], header[13], header[14], header[15]]);
    let width = u32::from_le_bytes([header[16], header[17], header[18], header[19]]);
    Some(ImageDimensions { width, height, source: "dds-header".to_string() })
}

fn read_tga_dimensions(path: &Path) -> Option<ImageDimensions> {
    let mut file = fs::File::open(path).ok()?;
    let mut header = [0u8; 18];
    file.read_exact(&mut header).ok()?;
    let width = u16::from_le_bytes([header[12], header[13]]) as u32;
    let height = u16::from_le_bytes([header[14], header[15]]) as u32;
    if width == 0 || height == 0 || width > 65535 || height > 65535 {
        return None;
    }
    Some(ImageDimensions { width, height, source: "tga-header".to_string() })
}

fn read_image_dimensions(path: &Path, extension: &str) -> Option<ImageDimensions> {
    match extension {
        "png" => read_png_dimensions(path),
        "jpg" | "jpeg" => read_jpeg_dimensions(path),
        "dds" => read_dds_dimensions(path),
        "tga" => read_tga_dimensions(path),
        _ => None,
    }
}

fn build_asset_inspection(path: PathBuf) -> Result<AssetInspection, String> {
    let normalized = normalize_file_path(path)?;

    let extension = normalized
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.to_ascii_lowercase())
        .unwrap_or_default();

    if !is_supported_extension(&extension) {
        return Err(format!("unsupported file extension: {extension}"));
    }

    let file_name = normalized
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or_else(|| "failed to resolve file name".to_string())?
        .to_string();

    let metadata = fs::metadata(&normalized)
        .map_err(|e| format!("failed to read file metadata: {e}"))?;

    let modified_at = metadata.modified().ok().and_then(system_time_to_unix_string);
    let created_at = metadata.created().ok().and_then(system_time_to_unix_string);
    let preview_implemented = PREVIEW_IMPLEMENTED_EXTENSIONS.contains(&extension.as_str());
    let image_dimensions = read_image_dimensions(&normalized, &extension);

    Ok(AssetInspection {
        path: normalized.display().to_string(),
        file_name,
        extension: extension.clone(),
        kind: infer_file_kind(&extension),
        file_size_bytes: metadata.len(),
        modified_at,
        created_at,
        preview_implemented,
        image_dimensions,
    })
}

#[tauri::command]
fn inspect_asset(path: String) -> Result<AssetInspection, String> {
    build_asset_inspection(PathBuf::from(path))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FormatSupportPayload {
    model_extensions: Vec<String>,
    texture_extensions: Vec<String>,
    preview_implemented: Vec<String>,
}

#[tauri::command]
fn load_format_support() -> FormatSupportPayload {
    FormatSupportPayload {
        model_extensions: MODEL_EXTENSIONS.iter().map(|e| e.to_string()).collect(),
        texture_extensions: TEXTURE_EXTENSIONS.iter().map(|e| e.to_string()).collect(),
        preview_implemented: PREVIEW_IMPLEMENTED_EXTENSIONS.iter().map(|e| e.to_string()).collect(),
    }
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
    let settings = sanitize_settings(settings);
    write_settings_file(&settings_path, &settings)?;

    Ok(SettingsPayload {
        settings_path: settings_path.display().to_string(),
        settings,
    })
}

#[tauri::command]
fn load_update_configuration(app: tauri::AppHandle) -> Result<UpdateConfigurationPayload, String> {
    let (_, settings) = load_or_initialize_settings(&app)?;
    Ok(build_update_configuration_payload(&app, &settings))
}

#[tauri::command]
fn open_file_dialog(app: tauri::AppHandle) -> Result<Option<SelectedFilePayload>, String> {
    let file_path = FileDialog::new()
        .set_title("Open asset file")
        .add_filter(
            "Supported assets",
            &[
                "glb", "gltf", "fbx", "obj", "ply", "stl", "usd", "usda", "usdc", "usdz", "dae", "vrm", "pmd", "pmx",
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
        install_strategy: "NSIS and MSI installers register supported file associations on Windows. The runtime toggle remains as a local preference until installer-level opt-in wiring is added.".to_string(),
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

#[tauri::command]
async fn check_for_update(
    app: tauri::AppHandle,
    pending_update: tauri::State<'_, PendingUpdateState>,
) -> Result<UpdateCheckPayload, String> {
    let (_, settings) = load_or_initialize_settings(&app)?;
    let configuration = build_update_configuration_payload(&app, &settings);
    let update = build_updater(&app, &settings)?
        .check()
        .await
        .map_err(|error| format!("failed to check for updates: {error}"))?;

    let payload = UpdateCheckPayload {
        configuration,
        update: update.as_ref().map(update_metadata_payload),
    };

    *pending_update.0.lock().unwrap() = update;

    Ok(payload)
}

#[tauri::command]
async fn install_pending_update(
    pending_update: tauri::State<'_, PendingUpdateState>,
) -> Result<UpdateInstallPayload, String> {
    let update = pending_update
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "no pending update is available; run a check first".to_string())?;
    let installed_version = update.version.clone();

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| format!("failed to install update: {error}"))?;

    Ok(UpdateInstallPayload {
        installed_version,
        restart_required: !cfg!(windows),
        note: if cfg!(windows) {
            "Windows will close the app and hand over to the installer.".to_string()
        } else {
            "Restart the app after installation to load the new version.".to_string()
        },
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    let shared_menu_definition =
        load_shared_menu_definition().expect("failed to load shared menu definition");
    #[cfg(desktop)]
    let menu_action_ids = collect_menu_action_ids(&shared_menu_definition);

    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.on_menu_event(move |app, event| {
            let action_id = event.id().as_ref();
            if menu_action_ids.contains(action_id) {
                if let Err(error) = app.emit(MENU_ACTION_EVENT, action_id.to_string()) {
                    eprintln!("failed to emit menu action event '{action_id}': {error}");
                }
            }
        });
    }

    builder
        .setup(move |app| {
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())
                .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;

            #[cfg(desktop)]
            {
                let menu = build_native_menu(&app.handle(), &shared_menu_definition).map_err(
                    |error| -> Box<dyn std::error::Error> {
                        Box::new(std::io::Error::new(std::io::ErrorKind::Other, error))
                    },
                )?;
                app.set_menu(menu)
                    .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
            }

            app.manage(PendingUpdateState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            load_update_configuration,
            open_file_dialog,
            resolve_selected_file,
            list_supported_siblings,
            read_binary_file,
            get_startup_file,
            load_recent_files,
            load_supported_extensions,
            log_diagnostic_event,
            load_diagnostics_snapshot,
            check_for_update,
            install_pending_update,
            inspect_asset,
            load_format_support
        ])
        .run(tauri::generate_context!())
        .expect("error while running yw-look");
}
