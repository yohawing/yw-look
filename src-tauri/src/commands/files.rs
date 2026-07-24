use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
use std::fs;
use std::io::Read as IoRead;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::shared::{
    current_timestamp, dialog_filter_extensions, infer_file_kind, is_readable_asset_extension,
    is_supported_extension, load_or_initialize_settings, lock_or_recover, model_extensions,
    motion_extensions, normalize_file_path, preview_implemented_extensions, read_json_file,
    repo_root, resolve_app_data_dir, system_time_to_unix_string, texture_extensions,
    write_json_file, RECENT_FILES_FILE_NAME,
};
use crate::state::PendingOpenFiles;

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SelectedFilePayload {
    pub(crate) path: String,
    pub(crate) file_name: String,
    pub(crate) extension: String,
    pub(crate) kind: String,
    pub(crate) parent_directory: String,
}

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectoryListingPayload {
    pub(crate) files: Vec<SelectedFilePayload>,
    pub(crate) current_index: Option<usize>,
}

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecentFileEntry {
    pub(crate) path: String,
    pub(crate) kind: String,
    pub(crate) last_accessed_at: String,
}

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecentFilesPayload {
    pub(crate) recent_files_path: String,
    pub(crate) entries: Vec<RecentFileEntry>,
}

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FormatSupportPayload {
    model_extensions: Vec<String>,
    texture_extensions: Vec<String>,
    motion_extensions: Vec<String>,
    preview_implemented: Vec<String>,
}

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssetInspection {
    path: String,
    file_name: String,
    extension: String,
    kind: String,
    // JSON IPC uses number; keep TS aligned with serde wire shape.
    #[cfg_attr(test, ts(type = "number"))]
    file_size_bytes: u64,
    modified_at: Option<String>,
    created_at: Option<String>,
    preview_implemented: bool,
    image_dimensions: Option<ImageDimensions>,
}

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageDimensions {
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
        return Err(AppError::Internal(format!(
            "unsupported file extension: {extension}"
        )));
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

fn list_supported_files_in_directory(
    directory: &Path,
) -> Result<Vec<SelectedFilePayload>, AppError> {
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

fn collect_supported_files(paths: Vec<PathBuf>) -> Result<Vec<SelectedFilePayload>, AppError> {
    let mut pending = VecDeque::from(paths);
    let mut files = Vec::new();
    let mut seen_paths = HashSet::new();

    while let Some(path) = pending.pop_front() {
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            AppError::Io(format!("failed to inspect '{}': {error}", path.display()))
        })?;

        if metadata.file_type().is_symlink() {
            let target_metadata = fs::metadata(&path).map_err(|error| {
                AppError::Io(format!("failed to inspect '{}': {error}", path.display()))
            })?;
            if target_metadata.is_dir() {
                continue;
            }
        }
        if metadata.is_dir() {
            let mut entries = fs::read_dir(&path)
                .map_err(|error| {
                    AppError::Io(format!(
                        "failed to read directory '{}': {error}",
                        path.display()
                    ))
                })?
                .map(|entry| {
                    entry.map(|entry| entry.path()).map_err(|error| {
                        AppError::Io(format!("failed to read directory entry: {error}"))
                    })
                })
                .collect::<Result<Vec<_>, _>>()?;
            entries.sort_by(|left, right| {
                left.to_string_lossy()
                    .to_ascii_lowercase()
                    .cmp(&right.to_string_lossy().to_ascii_lowercase())
                    .then_with(|| left.cmp(right))
            });
            pending.extend(entries);
            continue;
        }

        if let Ok(file) = build_selected_file_payload(path) {
            if seen_paths.insert(file.path.clone()) {
                files.push(file);
            }
        }
    }
    Ok(files)
}

fn recent_files_path_from_dir(dir: &Path) -> PathBuf {
    dir.join(RECENT_FILES_FILE_NAME)
}

fn load_recent_file_entries_from_path(
    dir: &Path,
) -> Result<(PathBuf, Vec<RecentFileEntry>), AppError> {
    let recent_files_path = recent_files_path_from_dir(dir);

    if !recent_files_path.exists() {
        write_json_file(&recent_files_path, &Vec::<RecentFileEntry>::new())?;
    }

    let entries = match read_json_file::<Vec<RecentFileEntry>>(&recent_files_path) {
        Ok(entries) => entries,
        Err(AppError::Serde(message)) => {
            let backup_path = recent_files_path.with_file_name(format!(
                "{RECENT_FILES_FILE_NAME}.corrupt-{}.bak",
                current_timestamp()
            ));
            fs::copy(&recent_files_path, &backup_path).map_err(|error| {
                AppError::Io(format!(
                    "failed to back up corrupt recent files '{}': {error}",
                    recent_files_path.display()
                ))
            })?;
            log::warn!(
                "recent files JSON was corrupt and has been reset: {}; backup={}",
                message,
                backup_path.display()
            );
            let entries = Vec::<RecentFileEntry>::new();
            write_json_file(&recent_files_path, &entries)?;
            entries
        }
        Err(error) => return Err(error),
    };
    Ok((recent_files_path, entries))
}

fn save_recent_file_entries(path: &Path, entries: &[RecentFileEntry]) -> Result<(), AppError> {
    write_json_file(path, &entries.to_vec())
}

fn load_clean_recent_file_entries_from_path(
    dir: &Path,
    recent_files_limit: usize,
) -> Result<(PathBuf, Vec<RecentFileEntry>), AppError> {
    let (recent_files_path, mut entries) = load_recent_file_entries_from_path(dir)?;
    let original_len = entries.len();

    entries.retain(|entry| Path::new(&entry.path).exists());
    entries.truncate(recent_files_limit);

    if entries.len() != original_len {
        save_recent_file_entries(&recent_files_path, &entries)?;
    }

    Ok((recent_files_path, entries))
}

fn load_clean_recent_file_entries(
    app: &tauri::AppHandle,
) -> Result<(PathBuf, Vec<RecentFileEntry>), AppError> {
    let (_, settings) = load_or_initialize_settings(app)?;
    let app_data_dir = resolve_app_data_dir(app)?;
    load_clean_recent_file_entries_from_path(&app_data_dir, settings.recent_files_limit)
}

fn sync_recent_file_from_path(
    dir: &Path,
    file: &SelectedFilePayload,
    recent_files_limit: usize,
    last_accessed_at: String,
) -> Result<(), AppError> {
    let (recent_files_path, mut entries) = load_recent_file_entries_from_path(dir)?;

    entries.retain(|entry| entry.path != file.path && Path::new(&entry.path).exists());
    entries.insert(
        0,
        RecentFileEntry {
            path: file.path.clone(),
            kind: file.kind.clone(),
            last_accessed_at,
        },
    );
    entries.truncate(recent_files_limit);

    save_recent_file_entries(&recent_files_path, &entries)?;

    Ok(())
}

fn sync_recent_file(app: &tauri::AppHandle, file: &SelectedFilePayload) -> Result<(), AppError> {
    let (_, settings) = load_or_initialize_settings(app)?;
    let app_data_dir = resolve_app_data_dir(app)?;
    sync_recent_file_from_path(
        &app_data_dir,
        file,
        settings.recent_files_limit,
        current_timestamp(),
    )
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

/// Texture formats accepted by inspect_asset but not header-probed for width/height yet.
/// KTX2 needs a KTX2 header parse; HDR/EXR need Radiance/OpenEXR header reads (tracked R23 gap).
const DIMENSION_PROBE_DEFERRED_EXTENSIONS: &[&str] = &["ktx2", "hdr", "exr"];

fn dimension_probe_deferred(extension: &str) -> bool {
    DIMENSION_PROBE_DEFERRED_EXTENSIONS.contains(&extension)
}

fn read_image_dimensions(path: &Path, extension: &str) -> Option<ImageDimensions> {
    if dimension_probe_deferred(extension) {
        return None;
    }
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

    let metadata = fs::metadata(&normalized)
        .map_err(|e| AppError::Io(format!("failed to read file metadata: {e}")))?;

    let modified_at = metadata
        .modified()
        .ok()
        .and_then(system_time_to_unix_string);
    let created_at = metadata.created().ok().and_then(system_time_to_unix_string);
    let preview_implemented = preview_implemented_extensions()
        .iter()
        .any(|value| value == &extension);
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
        model_extensions: model_extensions().to_vec(),
        texture_extensions: texture_extensions().to_vec(),
        motion_extensions: motion_extensions().to_vec(),
        preview_implemented: preview_implemented_extensions().to_vec(),
    }
}

#[tauri::command]
pub(crate) fn open_file_dialog(
    _app: tauri::AppHandle,
) -> Result<Option<Vec<SelectedFilePayload>>, AppError> {
    let dialog_extensions = dialog_filter_extensions();
    let dialog_extension_refs: Vec<&str> = dialog_extensions
        .iter()
        .map(|extension| extension.as_str())
        .collect();
    let file_paths = rfd::FileDialog::new()
        .set_title("Open asset file")
        .add_filter("Supported assets", &dialog_extension_refs)
        .pick_files();

    file_paths.map(collect_supported_files).transpose()
}

#[tauri::command]
pub(crate) fn resolve_selected_files(
    paths: Vec<String>,
) -> Result<Vec<SelectedFilePayload>, AppError> {
    collect_supported_files(paths.into_iter().map(PathBuf::from).collect())
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
pub(crate) fn read_binary_file(path: String) -> Result<tauri::ipc::Response, AppError> {
    Ok(tauri::ipc::Response::new(read_binary_file_impl(path)?))
}

fn ensure_readable_asset_path(path: &Path) -> Result<(), AppError> {
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default();
    if !is_readable_asset_extension(extension) {
        return Err(AppError::Io(format!(
            "refusing to read unsupported file type: {}",
            path.display()
        )));
    }
    Ok(())
}

fn read_binary_file_impl(path: String) -> Result<Vec<u8>, AppError> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    ensure_readable_asset_path(&normalized)?;
    let bytes = fs::read(normalized)
        .map_err(|error| AppError::Io(format!("failed to read file bytes: {error}")))?;
    // Return raw bytes via `tauri::ipc::Response` (→ ArrayBuffer on the JS
    // side) instead of a JSON number array. The number-array path balloons
    // memory and stalls on large assets (e.g. 100-260 MB Gaussian splats),
    // which is why big `.splat`/`.ply` files failed to open.
    Ok(bytes)
}

#[tauri::command]
pub(crate) fn read_binary_file_prefix(
    path: String,
    max_bytes: usize,
) -> Result<tauri::ipc::Response, AppError> {
    Ok(tauri::ipc::Response::new(read_binary_file_prefix_impl(
        path, max_bytes,
    )?))
}

fn read_binary_file_prefix_impl(path: String, max_bytes: usize) -> Result<Vec<u8>, AppError> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    ensure_readable_asset_path(&normalized)?;
    let file = fs::File::open(normalized)
        .map_err(|error| AppError::Io(format!("failed to open file bytes: {error}")))?;
    let mut bytes = Vec::with_capacity(max_bytes);
    file.take(max_bytes as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| AppError::Io(format!("failed to read file prefix: {error}")))?;
    Ok(bytes)
}

#[tauri::command]
pub(crate) fn get_startup_file(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingOpenFiles>,
) -> Result<Option<SelectedFilePayload>, AppError> {
    let queued: Vec<PathBuf> = {
        let mut guard = lock_or_recover(&pending.0, "pending open files");
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn recent_files_path(dir: &Path) -> PathBuf {
        dir.join(RECENT_FILES_FILE_NAME)
    }

    fn create_file(dir: &Path, file_name: &str) -> PathBuf {
        let path = dir.join(file_name);
        fs::write(&path, b"fixture").expect("write fixture");
        path
    }

    fn selected_file(dir: &Path, file_name: &str) -> SelectedFilePayload {
        build_selected_file_payload(create_file(dir, file_name)).expect("selected file")
    }

    #[test]
    fn collect_supported_files_recurses_and_keeps_asset_paths() {
        let dir = tempdir().expect("tempdir");
        let layers = dir.path().join("layers");
        let payloads = dir.path().join("payloads");
        let textures = dir.path().join("textures");
        fs::create_dir_all(&layers).expect("layers directory");
        fs::create_dir_all(&payloads).expect("payloads directory");
        fs::create_dir_all(&textures).expect("textures directory");
        create_file(dir.path(), "scene.usda");
        create_file(&layers, "geometry.usdc");
        create_file(&payloads, "hero.usda");
        create_file(&textures, "albedo.png");
        create_file(dir.path(), "notes.txt");

        let files = collect_supported_files(vec![dir.path().to_path_buf()])
            .expect("collect supported files");
        let relative_paths = files
            .iter()
            .map(|file| {
                Path::new(&file.path)
                    .strip_prefix(dir.path())
                    .expect("relative path")
                    .to_path_buf()
            })
            .collect::<Vec<_>>();

        assert_eq!(relative_paths.len(), 4);
        assert!(relative_paths.contains(&PathBuf::from("scene.usda")));
        assert!(relative_paths.contains(&PathBuf::from("layers/geometry.usdc")));
        assert!(relative_paths.contains(&PathBuf::from("payloads/hero.usda")));
        assert!(relative_paths.contains(&PathBuf::from("textures/albedo.png")));
    }

    #[test]
    fn collect_supported_files_deduplicates_overlapping_inputs() {
        let dir = tempdir().expect("tempdir");
        let root = create_file(dir.path(), "scene.usda");

        let files = collect_supported_files(vec![dir.path().to_path_buf(), root])
            .expect("collect supported files");

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].file_name, "scene.usda");
    }

    #[test]
    fn collect_supported_files_preserves_explicit_file_order() {
        let dir = tempdir().expect("tempdir");
        let second = create_file(dir.path(), "second.glb");
        let first = create_file(dir.path(), "first.glb");

        let files = collect_supported_files(vec![second, first]).expect("collect supported files");

        assert_eq!(files.len(), 2);
        assert_eq!(files[0].file_name, "second.glb");
        assert_eq!(files[1].file_name, "first.glb");
    }

    fn entry_for_path(path: &Path, kind: &str, last_accessed_at: &str) -> RecentFileEntry {
        RecentFileEntry {
            path: path.display().to_string(),
            kind: kind.to_string(),
            last_accessed_at: last_accessed_at.to_string(),
        }
    }

    fn read_entries(dir: &Path) -> Vec<RecentFileEntry> {
        read_json_file(&recent_files_path(dir)).expect("read recent files")
    }

    fn write_entries(dir: &Path, entries: &[RecentFileEntry]) {
        save_recent_file_entries(&recent_files_path(dir), entries).expect("write recent files");
    }

    #[test]
    fn raw_binary_reads_allow_supported_and_sidecar_extensions_case_insensitively() {
        let dir = tempdir().expect("tempdir");
        for file_name in [
            "model.glb",
            "texture.PNG",
            "buffer.bin",
            "toon.bmp",
            "material.mtl",
            "sphere.sph",
            "sphere.spa",
            "animation.vrma",
        ] {
            let path = create_file(dir.path(), file_name);
            assert_eq!(
                read_binary_file_impl(path.display().to_string()).expect("read allowed file"),
                b"fixture"
            );
        }
    }

    #[test]
    fn raw_binary_reads_reject_unsupported_and_extensionless_paths() {
        let dir = tempdir().expect("tempdir");
        for file_name in ["secrets.txt", "id_rsa"] {
            let path = create_file(dir.path(), file_name);
            let path = path.display().to_string();

            let full_error = read_binary_file_impl(path.clone()).expect_err("reject full read");
            assert!(full_error.to_string().contains("unsupported file type"));

            let prefix_error =
                read_binary_file_prefix_impl(path, 2).expect_err("reject prefix read");
            assert!(prefix_error.to_string().contains("unsupported file type"));
        }
    }

    #[test]
    fn load_recent_files_creates_empty_file_when_missing() {
        let dir = tempdir().expect("tempdir");

        let (path, entries) =
            load_recent_file_entries_from_path(dir.path()).expect("load recent files");

        assert_eq!(path, recent_files_path(dir.path()));
        assert!(entries.is_empty());
        assert_eq!(fs::read_to_string(path).expect("recent files json"), "[]");
    }

    #[test]
    fn cleanup_removes_entries_for_missing_paths() {
        let dir = tempdir().expect("tempdir");
        let keep = create_file(dir.path(), "keep.glb");
        let missing = dir.path().join("missing.glb");
        write_entries(
            dir.path(),
            &[
                entry_for_path(&missing, "model", "1"),
                entry_for_path(&keep, "model", "2"),
            ],
        );

        let (_, entries) =
            load_clean_recent_file_entries_from_path(dir.path(), 20).expect("clean entries");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, keep.display().to_string());
    }

    #[test]
    fn cleanup_truncates_entries_to_recent_files_limit() {
        let dir = tempdir().expect("tempdir");
        let first = create_file(dir.path(), "first.glb");
        let second = create_file(dir.path(), "second.png");
        let third = create_file(dir.path(), "third.vmd");
        write_entries(
            dir.path(),
            &[
                entry_for_path(&first, "model", "1"),
                entry_for_path(&second, "texture", "2"),
                entry_for_path(&third, "motion", "3"),
            ],
        );

        let (_, entries) =
            load_clean_recent_file_entries_from_path(dir.path(), 2).expect("clean entries");

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, first.display().to_string());
        assert_eq!(entries[1].path, second.display().to_string());
    }

    #[test]
    fn sync_recent_file_adds_new_file_to_front() {
        let dir = tempdir().expect("tempdir");
        let file = selected_file(dir.path(), "asset.glb");

        sync_recent_file_from_path(dir.path(), &file, 20, "12345".to_string())
            .expect("sync recent file");
        let entries = read_entries(dir.path());

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, file.path);
        assert_eq!(entries[0].kind, "model");
        assert_eq!(entries[0].last_accessed_at, "12345");
    }

    #[test]
    fn sync_recent_file_deduplicates_and_moves_existing_entry_to_front() {
        let dir = tempdir().expect("tempdir");
        let first = selected_file(dir.path(), "first.glb");
        let second = selected_file(dir.path(), "second.png");
        write_entries(
            dir.path(),
            &[
                RecentFileEntry {
                    path: first.path.clone(),
                    kind: first.kind.clone(),
                    last_accessed_at: "1".to_string(),
                },
                RecentFileEntry {
                    path: second.path.clone(),
                    kind: second.kind.clone(),
                    last_accessed_at: "2".to_string(),
                },
            ],
        );

        sync_recent_file_from_path(dir.path(), &second, 20, "99".to_string())
            .expect("sync recent file");
        let entries = read_entries(dir.path());

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, second.path);
        assert_eq!(entries[0].last_accessed_at, "99");
        assert_eq!(entries[1].path, first.path);
    }

    #[test]
    fn sync_recent_file_cleans_missing_entries() {
        let dir = tempdir().expect("tempdir");
        let existing = selected_file(dir.path(), "existing.glb");
        let incoming = selected_file(dir.path(), "incoming.png");
        let missing = dir.path().join("missing.vmd");
        write_entries(
            dir.path(),
            &[
                entry_for_path(&missing, "motion", "1"),
                RecentFileEntry {
                    path: existing.path.clone(),
                    kind: existing.kind.clone(),
                    last_accessed_at: "2".to_string(),
                },
            ],
        );

        sync_recent_file_from_path(dir.path(), &incoming, 20, "3".to_string())
            .expect("sync recent file");
        let entries = read_entries(dir.path());

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, incoming.path);
        assert_eq!(entries[1].path, existing.path);
    }

    #[test]
    fn sync_recent_file_applies_limit_after_insert() {
        let dir = tempdir().expect("tempdir");
        let first = selected_file(dir.path(), "first.glb");
        let second = selected_file(dir.path(), "second.png");
        let incoming = selected_file(dir.path(), "incoming.vmd");
        write_entries(
            dir.path(),
            &[
                RecentFileEntry {
                    path: first.path.clone(),
                    kind: first.kind.clone(),
                    last_accessed_at: "1".to_string(),
                },
                RecentFileEntry {
                    path: second.path.clone(),
                    kind: second.kind.clone(),
                    last_accessed_at: "2".to_string(),
                },
            ],
        );

        sync_recent_file_from_path(dir.path(), &incoming, 2, "3".to_string())
            .expect("sync recent file");
        let entries = read_entries(dir.path());

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, incoming.path);
        assert_eq!(entries[1].path, first.path);
    }

    #[test]
    fn load_recent_files_recovers_invalid_json_with_backup() {
        let dir = tempdir().expect("tempdir");
        fs::write(recent_files_path(dir.path()), "{ invalid json").expect("write recent files");

        let (_path, entries) =
            load_recent_file_entries_from_path(dir.path()).expect("recover invalid json");
        let backups = fs::read_dir(dir.path())
            .expect("read tempdir")
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("recent-files.json.corrupt-")
            })
            .collect::<Vec<_>>();

        assert!(entries.is_empty());
        assert_eq!(backups.len(), 1);
        assert!(read_entries(dir.path()).is_empty());
    }

    fn texture_fixtures_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/textures")
    }

    #[test]
    fn dimension_probe_deferred_extensions_record_ktx2_hdr_exr_gap() {
        assert_eq!(DIMENSION_PROBE_DEFERRED_EXTENSIONS, &["ktx2", "hdr", "exr"]);
        for extension in DIMENSION_PROBE_DEFERRED_EXTENSIONS {
            assert!(dimension_probe_deferred(extension));
        }
        assert!(!dimension_probe_deferred("png"));
    }

    #[test]
    fn read_image_dimensions_defers_ktx2_hdr_exr_without_header_probe() {
        let fixtures = texture_fixtures_dir();
        let ktx2 = fixtures.join("2d-uastc.ktx2");
        assert!(ktx2.is_file(), "missing ktx2 fixture at {}", ktx2.display());

        assert!(read_image_dimensions(&ktx2, "ktx2").is_none());
        assert!(read_image_dimensions(Path::new("unused.hdr"), "hdr").is_none());
        assert!(read_image_dimensions(Path::new("unused.exr"), "exr").is_none());
    }

    #[test]
    fn load_format_support_matches_manifest_groups() {
        let support = load_format_support();

        assert_eq!(support.model_extensions, model_extensions().to_vec());
        assert_eq!(support.texture_extensions, texture_extensions().to_vec());
        assert_eq!(support.motion_extensions, motion_extensions().to_vec());
        assert_eq!(
            support.preview_implemented,
            preview_implemented_extensions().to_vec()
        );
    }

    #[test]
    fn read_image_dimensions_reads_supported_texture_headers() {
        let fixtures = texture_fixtures_dir();

        let png = read_image_dimensions(&fixtures.join("1x1.png"), "png").expect("png dimensions");
        assert_eq!(png.width, 1);
        assert_eq!(png.height, 1);
        assert_eq!(png.source, "png-header");

        let jpg = read_image_dimensions(&fixtures.join("1x1.jpg"), "jpg").expect("jpg dimensions");
        assert_eq!(jpg.width, 1);
        assert_eq!(jpg.height, 1);
        assert_eq!(jpg.source, "jpeg-header");

        let dds = read_image_dimensions(&fixtures.join("disturb-dxt1-nomip.dds"), "dds")
            .expect("dds dimensions");
        assert_eq!(dds.width, 512);
        assert_eq!(dds.height, 512);
        assert_eq!(dds.source, "dds-header");

        let tga = read_image_dimensions(&fixtures.join("crate-grey8.tga"), "tga")
            .expect("tga dimensions");
        assert_eq!(tga.width, 256);
        assert_eq!(tga.height, 256);
        assert_eq!(tga.source, "tga-header");
    }
}
