use serde::{de::DeserializeOwned, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};
use std::{env, fs};
use tauri::Manager;

use crate::error::AppError;
use crate::state::AppSettings;

pub(crate) const SETTINGS_FILE_NAME: &str = "settings.json";
pub(crate) const RECENT_FILES_FILE_NAME: &str = "recent-files.json";
pub(crate) const DIAGNOSTICS_LOG_FILE_NAME: &str = "diagnostics.log";
pub(crate) static USD_TASK_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn lock_or_recover<'a, T>(mutex: &'a Mutex<T>, label: &str) -> MutexGuard<'a, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poison) => {
            eprintln!("[yw-look] {label} lock was poisoned; continuing with recovered lock");
            poison.into_inner()
        }
    }
}

pub(crate) const DEFAULT_UPDATER_ENDPOINT: Option<&str> = option_env!("YW_LOOK_UPDATER_ENDPOINT");
pub(crate) const DEFAULT_UPDATER_PUBLIC_KEY: Option<&str> = option_env!("YW_LOOK_UPDATER_PUBLIC_KEY");

pub(crate) const MODEL_EXTENSIONS: &[&str] = &[
    "glb", "gltf", "fbx", "obj", "ply", "stl", "usd", "usda", "usdc", "usdz", "dae", "vrm", "abc",
    "pmx", "pmd", "splat", "spz", "ksplat", "sog",
];
pub(crate) const TEXTURE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "tga", "dds", "ktx2", "hdr", "exr"];
pub(crate) const MOTION_EXTENSIONS: &[&str] = &["vmd"];
pub(crate) const FILE_ASSOCIATION_EXTENSIONS: &[&str] = &[
    "glb", "gltf", "fbx", "obj", "ply", "stl", "dae", "usd", "usda", "usdc", "usdz", "png", "jpg",
    "jpeg", "tga", "dds", "ktx2", "hdr", "exr", "pmx", "pmd", "vmd", "splat", "spz", "ksplat",
    "sog",
];
pub(crate) const PREVIEW_IMPLEMENTED_EXTENSIONS: &[&str] = &[
    "glb", "gltf", "vrm", "abc", "fbx", "obj", "ply", "stl", "dae", "png", "jpg", "jpeg", "tga",
    "dds", "ktx2", "hdr", "exr", "pmx", "pmd", "vmd", "splat", "spz", "ksplat", "sog",
];

pub(crate) fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let s = path.display().to_string();
        if s.starts_with(r"\\?\") {
            return PathBuf::from(&s[4..]);
        }
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
    path.to_path_buf()
}

pub(crate) fn current_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    seconds.to_string()
}

pub(crate) fn system_time_to_unix_string(time: SystemTime) -> Option<String> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs().to_string())
}

pub(crate) fn infer_file_kind(extension: &str) -> String {
    if MODEL_EXTENSIONS.contains(&extension) {
        "model".to_string()
    } else if TEXTURE_EXTENSIONS.contains(&extension) {
        "texture".to_string()
    } else if MOTION_EXTENSIONS.contains(&extension) {
        "motion".to_string()
    } else {
        "unknown".to_string()
    }
}

pub(crate) fn is_supported_extension(extension: &str) -> bool {
    MODEL_EXTENSIONS.contains(&extension)
        || TEXTURE_EXTENSIONS.contains(&extension)
        || MOTION_EXTENSIONS.contains(&extension)
}

pub(crate) fn normalize_file_path(path: PathBuf) -> Result<PathBuf, AppError> {
    if !path.exists() {
        return Err(AppError::Io(format!("file does not exist: {}", path.display())));
    }
    if !path.is_file() {
        return Err(AppError::Io(format!("path is not a file: {}", path.display())));
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| AppError::Io(format!("failed to normalize file path: {error}")))?;
    Ok(strip_verbatim_prefix(&canonical))
}

pub(crate) fn canonicalize_existing_path(path: &Path) -> Result<PathBuf, AppError> {
    path.canonicalize()
        .map(|path| strip_verbatim_prefix(&path))
        .map_err(|error| AppError::Io(format!("failed to normalize path '{}': {error}", path.display())))
}

pub(crate) fn canonicalize_existing_parent(path: &Path) -> Result<PathBuf, AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Io(format!("path has no parent: {}", path.display())))?;
    canonicalize_existing_path(parent)
}

pub(crate) fn ensure_path_within(path: &Path, root: &Path, label: &str) -> Result<(), AppError> {
    if path.starts_with(root) {
        return Ok(());
    }
    Err(AppError::Io(format!(
        "{label} path '{}' must be under '{}'",
        path.display(),
        root.display()
    )))
}

pub(crate) fn resolve_app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_config_dir()
        .map_err(|error| AppError::Io(format!("failed to resolve app config directory: {error}")))
}

pub(crate) fn resolve_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    Ok(resolve_app_data_dir(app)?.join(SETTINGS_FILE_NAME))
}

pub(crate) fn resolve_diagnostics_log_path(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    Ok(resolve_app_data_dir(app)?.join(DIAGNOSTICS_LOG_FILE_NAME))
}

pub(crate) fn ensure_parent_dir(path: &Path) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Io("path has no parent directory".into()))?;
    fs::create_dir_all(parent)
        .map_err(|error| AppError::Io(format!("failed to create directory: {error}")))
}

pub(crate) fn write_json_file<T: Serialize>(path: &Path, payload: &T) -> Result<(), AppError> {
    ensure_parent_dir(path)?;
    let json = serde_json::to_string_pretty(payload)
        .map_err(|error| AppError::Serde(format!("failed to serialize json: {error}")))?;
    fs::write(path, json).map_err(|error| AppError::Io(format!("failed to write file: {error}")))
}

pub(crate) fn read_json_file<T: DeserializeOwned + Default>(path: &Path) -> Result<T, AppError> {
    if !path.exists() {
        return Ok(T::default());
    }
    let raw = fs::read_to_string(path)
        .map_err(|error| AppError::Io(format!("failed to read file: {error}")))?;
    serde_json::from_str::<T>(&raw)
        .map_err(|error| AppError::Serde(format!("failed to parse json: {error}")))
}

pub(crate) fn write_settings_file(path: &Path, settings: &AppSettings) -> Result<(), AppError> {
    write_json_file(path, settings)
}

pub(crate) fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub(crate) fn sanitize_settings(settings: AppSettings) -> AppSettings {
    AppSettings {
        version: settings.version.max(5),
        recent_files_limit: settings.recent_files_limit.max(1),
        diagnostics_log_level: if settings.diagnostics_log_level.trim().is_empty() {
            "info".to_string()
        } else {
            settings.diagnostics_log_level
        },
        file_associations_enabled: settings.file_associations_enabled,
        optional_loader_packs: settings.optional_loader_packs,
        update_endpoint_override: normalize_optional_text(settings.update_endpoint_override),
        update_public_key_override: normalize_optional_text(settings.update_public_key_override),
        allow_insecure_update_endpoint: settings.allow_insecure_update_endpoint,
        auto_check_for_updates: settings.auto_check_for_updates,
    }
}

pub(crate) fn load_or_initialize_settings(
    app: &tauri::AppHandle,
) -> Result<(PathBuf, AppSettings), AppError> {
    let settings_path = resolve_settings_path(app)?;
    let settings = if settings_path.exists() {
        let raw = fs::read_to_string(&settings_path)
            .map_err(|error| AppError::Io(format!("failed to read settings file: {error}")))?;
        sanitize_settings(
            serde_json::from_str::<AppSettings>(&raw)
                .map_err(|error| AppError::Serde(format!("failed to parse settings file: {error}")))?,
        )
    } else {
        let defaults = sanitize_settings(AppSettings::default());
        write_settings_file(&settings_path, &defaults)?;
        defaults
    };
    Ok((settings_path, settings))
}

pub(crate) fn current_app_version(app: &tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

pub(crate) fn repo_root() -> Result<PathBuf, AppError> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| AppError::Internal("failed to resolve repository root".into()))
}

pub(crate) fn format_byte_limit(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        format!("{} MiB", bytes / 1024 / 1024)
    } else {
        format!("{} KiB", bytes / 1024)
    }
}

pub(crate) fn read_limited_file(path: &Path, max_bytes: u64, label: &str) -> Result<Vec<u8>, AppError> {
    let metadata = fs::metadata(path)
        .map_err(|error| AppError::Io(format!("failed to inspect {label}: {error}")))?;
    if metadata.len() > max_bytes {
        return Err(AppError::Io(format!(
            "Alembic preview {label} exceeded {}.",
            format_byte_limit(max_bytes)
        )));
    }
    fs::read(path)
        .map_err(|error| AppError::Io(format!("failed to read {label}: {error}")))
}
