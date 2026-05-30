use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read as IoRead;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::shared::{
    current_timestamp, infer_file_kind, is_supported_extension, load_or_initialize_settings,
    normalize_file_path, read_json_file, repo_root, resolve_recent_files_path,
    system_time_to_unix_string, write_json_file, MODEL_EXTENSIONS, PREVIEW_IMPLEMENTED_EXTENSIONS,
    TEXTURE_EXTENSIONS,
};
use crate::state::PendingOpenFiles;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SelectedFilePayload {
    pub(crate) path: String,
    pub(crate) file_name: String,
    pub(crate) extension: String,
    pub(crate) kind: String,
    pub(crate) parent_directory: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectoryListingPayload {
    pub(crate) files: Vec<SelectedFilePayload>,
    pub(crate) current_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecentFileEntry {
    pub(crate) path: String,
    pub(crate) kind: String,
    pub(crate) last_accessed_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecentFilesPayload {
    pub(crate) recent_files_path: String,
    pub(crate) entries: Vec<RecentFileEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FormatSupportPayload {
    model_extensions: Vec<String>,
    texture_extensions: Vec<String>,
    preview_implemented: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssetInspection {
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

fn build_selected_file_payload(path: PathBuf) -> Result<SelectedFilePayload, AppError> {
    let normalized = normalize_file_path(path)?;

    let extension = normalized
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    if !is_supported_extension(&extension) {
        return Err(AppError::Internal(format!("unsupported file extension: {extension}")));
    }

    let file_name = normalized
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::Internal("failed to resolve file name".into()))?
        .to_string();

    let parent_directory = normalized
        .parent()
        .map(|value| value.display().to_string())
        .ok_or_else(|| AppError::Internal("failed to resolve parent directory".into()))?;

    Ok(SelectedFilePayload {
        path: normalized.display().to_string(),
        file_name,
        extension: extension.clone(),
        kind: infer_file_kind(&extension),
        parent_directory,
    })
}

fn build_selected_file_payload_from_cli_arg(
    argument: &str,
) -> Result<SelectedFilePayload, AppError> {
    let path = PathBuf::from(argument);
    if let Ok(file) = build_selected_file_payload(path.clone()) {
        return Ok(file);
    }
    if path.is_absolute() {
        return build_selected_file_payload(path);
    }
    build_selected_file_payload(repo_root()?.join(path))
}

fn list_supported_files_in_directory(directory: &Path) -> Result<Vec<SelectedFilePayload>, AppError> {
    let mut files = fs::read_dir(directory)
        .map_err(|error| AppError::Io(format!("failed to read directory: {error}")))?
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

fn load_recent_file_entries(
    app: &tauri::AppHandle,
) -> Result<(PathBuf, Vec<RecentFileEntry>), AppError> {
    let recent_files_path = resolve_recent_files_path(app)?;

    if !recent_files_path.exists() {
        write_json_file(&recent_files_path, &Vec::<RecentFileEntry>::new())?;
    }

    let entries = read_json_file::<Vec<RecentFileEntry>>(&recent_files_path)?;
    Ok((recent_files_path, entries))
}

fn save_recent_file_entries(path: &Path, entries: &[RecentFileEntry]) -> Result<(), AppError> {
    write_json_file(path, &entries.to_vec())
}

fn load_clean_recent_file_entries(
    app: &tauri::AppHandle,
) -> Result<(PathBuf, Vec<RecentFileEntry>), AppError> {
    let (_, settings) = load_or_initialize_settings(app)?;
    let (recent_files_path, mut entries) = load_recent_file_entries(app)?;
    let original_len = entries.len();

    entries.retain(|entry| Path::new(&entry.path).exists());
    entries.truncate(settings.recent_files_limit);

    if entries.len() != original_len {
        save_recent_file_entries(&recent_files_path, &entries)?;
    }

    Ok((recent_files_path, entries))
}

fn sync_recent_file(app: &tauri::AppHandle, file: &SelectedFilePayload) -> Result<(), AppError> {
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

    save_recent_file_entries(&recent_files_path, &entries)?;

    Ok(())
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
    Some(ImageDimensions {
        width,
        height,
        source: "png-header".to_string(),
    })
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
                return Some(ImageDimensions {
                    width,
                    height,
                    source: "jpeg-header".to_string(),
                });
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
    Some(ImageDimensions {
        width,
        height,
        source: "dds-header".to_string(),
    })
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
    Some(ImageDimensions {
        width,
        height,
        source: "tga-header".to_string(),
    })
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

fn build_asset_inspection(path: PathBuf) -> Result<AssetInspection, AppError> {
    let normalized = normalize_file_path(path)?;

    let extension = normalized
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.to_ascii_lowercase())
        .unwrap_or_default();

    if !is_supported_extension(&extension) {
        return Err(AppError::Internal(format!(
            "unsupported file extension: {extension}"
        )));
    }

    let file_name = normalized
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or_else(|| AppError::Internal("failed to resolve file name".into()))?
        .to_string();

    let metadata =
        fs::metadata(&normalized).map_err(|e| AppError::Io(format!("failed to read file metadata: {e}")))?;

    let modified_at = metadata
        .modified()
        .ok()
        .and_then(system_time_to_unix_string);
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
pub(crate) fn inspect_asset(path: String) -> Result<AssetInspection, AppError> {
    build_asset_inspection(PathBuf::from(path))
}

#[tauri::command]
pub(crate) fn load_format_support() -> FormatSupportPayload {
    FormatSupportPayload {
        model_extensions: MODEL_EXTENSIONS.iter().map(|e| e.to_string()).collect(),
        texture_extensions: TEXTURE_EXTENSIONS.iter().map(|e| e.to_string()).collect(),
        preview_implemented: PREVIEW_IMPLEMENTED_EXTENSIONS
            .iter()
            .map(|e| e.to_string())
            .collect(),
    }
}

#[tauri::command]
pub(crate) fn open_file_dialog(
    app: tauri::AppHandle,
) -> Result<Option<SelectedFilePayload>, AppError> {
    let file_path = rfd::FileDialog::new()
        .set_title("Open asset file")
        .add_filter(
            "Supported assets",
            &[
                "glb", "gltf", "fbx", "obj", "ply", "stl", "usd", "usda", "usdc", "usdz", "dae",
                "vrm", "abc", "pmx", "pmd", "png", "jpg", "jpeg", "tga", "dds", "ktx2", "hdr",
                "exr",
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
pub(crate) fn resolve_selected_file(
    app: tauri::AppHandle,
    path: String,
) -> Result<SelectedFilePayload, AppError> {
    let payload = build_selected_file_payload(PathBuf::from(path))?;
    sync_recent_file(&app, &payload)?;
    Ok(payload)
}

#[tauri::command]
pub(crate) fn list_supported_siblings(path: String) -> Result<DirectoryListingPayload, AppError> {
    let file = build_selected_file_payload(PathBuf::from(path))?;
    let files = list_supported_files_in_directory(Path::new(&file.parent_directory))?;
    let current_index = files.iter().position(|entry| entry.path == file.path);

    Ok(DirectoryListingPayload {
        files,
        current_index,
    })
}

#[tauri::command]
pub(crate) fn read_binary_file(path: String) -> Result<Vec<u8>, AppError> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    fs::read(normalized).map_err(|error| AppError::Io(format!("failed to read file bytes: {error}")))
}

#[tauri::command]
pub(crate) fn get_startup_file(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingOpenFiles>,
) -> Result<Option<SelectedFilePayload>, AppError> {
    let queued: Vec<PathBuf> = {
        let mut guard = pending.0.lock().unwrap();
        std::mem::take(&mut *guard)
    };

    for path in queued {
        if let Ok(file) = build_selected_file_payload(path) {
            sync_recent_file(&app, &file)?;
            return Ok(Some(file));
        }
    }

    for argument in std::env::args().skip(1) {
        if let Ok(file) = build_selected_file_payload_from_cli_arg(&argument) {
            sync_recent_file(&app, &file)?;
            return Ok(Some(file));
        }
    }

    Ok(None)
}

#[tauri::command]
pub(crate) fn load_recent_files(app: tauri::AppHandle) -> Result<RecentFilesPayload, AppError> {
    let (recent_files_path, entries) = load_clean_recent_file_entries(&app)?;

    Ok(RecentFilesPayload {
        recent_files_path: recent_files_path.display().to_string(),
        entries,
    })
}
