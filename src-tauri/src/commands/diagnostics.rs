use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

use crate::error::AppError;
use crate::shared::{
    current_timestamp, ensure_parent_dir, resolve_app_data_dir, resolve_diagnostics_log_path,
};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::Manager;

const RUN_MARKER_FILE_NAME: &str = "run-marker.json";

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticsPayload {
    pub(crate) app_version: String,
    pub(crate) platform: String,
    pub(crate) arch: String,
    pub(crate) app_log_dir: String,
    pub(crate) diagnostics_log_path: String,
    pub(crate) diagnostics_snapshot: Vec<String>,
}

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProcessMemoryPayload {
    // JSON IPC uses number; keep TS aligned with serde wire shape.
    #[cfg_attr(test, ts(type = "number"))]
    pub(crate) resident_set_bytes: u64,
    #[cfg_attr(test, ts(type = "number"))]
    pub(crate) virtual_memory_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunMarkerPayload {
    pub(crate) app_version: String,
    pub(crate) pid: u32,
    pub(crate) started_at: String,
}

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CrashRecoveryPayload {
    pub(crate) previous_crash_detected: bool,
    pub(crate) marker_path: String,
    pub(crate) previous_started_at: Option<String>,
    pub(crate) previous_pid: Option<u32>,
}

pub(crate) struct CrashRecoveryState(pub(crate) Mutex<CrashRecoveryPayload>);

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticRecordInput {
    pub(crate) code: String,
    pub(crate) level: String,
    pub(crate) message: String,
    pub(crate) detail: Option<String>,
    pub(crate) context_path: Option<String>,
}

fn redact_context_path(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    if !looks_like_local_path(value) {
        return Some(value.to_string());
    }

    let normalized = value.replace('\\', "/");
    let file_name = normalized
        .rsplit('/')
        .find(|segment| !segment.is_empty())
        .or_else(|| Path::new(value).file_name().and_then(|name| name.to_str()));

    Some(file_name.unwrap_or("<redacted>").to_string())
}

fn looks_like_local_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    let has_drive_prefix =
        bytes.len() >= 3 && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/');
    let has_unc_prefix = value.starts_with("\\\\") || value.starts_with("//");
    let has_windows_separator = value.contains('\\');
    let has_explicit_relative_prefix =
        value.starts_with("./") || value.starts_with("../") || value.starts_with("~/");
    let has_absolute_file_leaf = value.starts_with('/')
        && Path::new(value)
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.contains('.'));

    has_drive_prefix
        || has_unc_prefix
        || has_windows_separator
        || has_explicit_relative_prefix
        || has_absolute_file_leaf
}

fn append_diagnostic_record(
    app: &tauri::AppHandle,
    record: &DiagnosticRecordInput,
) -> Result<(), AppError> {
    let log_path = resolve_diagnostics_log_path(app)?;
    ensure_parent_dir(&log_path)?;

    let line = serde_json::json!({
        "timestamp": current_timestamp(),
        "code": record.code,
        "level": record.level,
        "message": record.message,
        "detail": record.detail,
        "contextPath": redact_context_path(record.context_path.as_deref()),
    })
    .to_string();

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| AppError::Io(format!("failed to open diagnostics log: {error}")))?;

    writeln!(file, "{line}")
        .map_err(|error| AppError::Io(format!("failed to append diagnostics log: {error}")))
}

fn crash_marker_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, AppError> {
    Ok(resolve_app_data_dir(app)?.join(RUN_MARKER_FILE_NAME))
}

pub(crate) fn initialize_crash_marker(
    app: &tauri::AppHandle,
) -> Result<CrashRecoveryState, AppError> {
    let marker_path = crash_marker_path(app)?;
    ensure_parent_dir(&marker_path)?;
    let had_previous_marker = marker_path.exists();
    let previous_marker = if had_previous_marker {
        match std::fs::read_to_string(&marker_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<RunMarkerPayload>(&raw).ok())
        {
            Some(marker) => {
                log::warn!(
                    "previous app run did not clear its marker: pid={} started_at={}",
                    marker.pid,
                    marker.started_at
                );
                Some(marker)
            }
            None => {
                log::warn!("previous app run left an unreadable marker");
                None
            }
        }
    } else {
        None
    };

    let marker = RunMarkerPayload {
        app_version: app.package_info().version.to_string(),
        pid: std::process::id(),
        started_at: current_timestamp(),
    };
    crate::shared::write_json_file(&marker_path, &marker)?;

    Ok(CrashRecoveryState(Mutex::new(CrashRecoveryPayload {
        previous_crash_detected: had_previous_marker,
        marker_path: marker_path.display().to_string(),
        previous_started_at: previous_marker
            .as_ref()
            .map(|marker| marker.started_at.clone()),
        previous_pid: previous_marker.as_ref().map(|marker| marker.pid),
    })))
}

pub(crate) fn clear_crash_marker(app: &tauri::AppHandle) {
    let Ok(marker_path) = crash_marker_path(app) else {
        return;
    };
    if marker_path.exists() {
        if let Err(error) = std::fs::remove_file(&marker_path) {
            log::warn!(
                "failed to clear app run marker '{}': {error}",
                marker_path.display()
            );
        }
    }
}

fn open_path(path: &Path) -> Result<(), AppError> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("explorer");
        command.arg(path);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = std::process::Command::new("open");
        command.arg(path);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(path);
        command
    };

    command
        .spawn()
        .map_err(|error| AppError::Io(format!("failed to open log directory: {error}")))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn log_diagnostic_event(
    app: tauri::AppHandle,
    record: DiagnosticRecordInput,
) -> Result<(), AppError> {
    append_diagnostic_record(&app, &record)
}

#[tauri::command]
pub(crate) fn load_diagnostics_snapshot(
    app: tauri::AppHandle,
) -> Result<DiagnosticsPayload, AppError> {
    let log_path = resolve_diagnostics_log_path(&app)?;
    let app_log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| AppError::Io(format!("failed to resolve app log directory: {error}")))?;
    ensure_parent_dir(&log_path)?;
    std::fs::create_dir_all(&app_log_dir)
        .map_err(|error| AppError::Io(format!("failed to create app log directory: {error}")))?;

    let diagnostics_snapshot = if log_path.exists() {
        let raw = std::fs::read_to_string(&log_path)
            .map_err(|error| AppError::Io(format!("failed to read diagnostics log: {error}")))?;

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
        app_version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        app_log_dir: app_log_dir.display().to_string(),
        diagnostics_log_path: log_path.display().to_string(),
        diagnostics_snapshot,
    })
}

#[tauri::command]
pub(crate) fn open_app_log_dir(app: tauri::AppHandle) -> Result<(), AppError> {
    let app_log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| AppError::Io(format!("failed to resolve app log directory: {error}")))?;
    std::fs::create_dir_all(&app_log_dir)
        .map_err(|error| AppError::Io(format!("failed to create app log directory: {error}")))?;
    open_path(&app_log_dir)
}

#[tauri::command]
pub(crate) fn load_crash_recovery_status(
    state: tauri::State<'_, CrashRecoveryState>,
) -> CrashRecoveryPayload {
    match state.0.lock() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => {
            log::warn!("crash recovery state mutex was poisoned; recovering");
            poisoned.into_inner().clone()
        }
    }
}

#[tauri::command]
pub(crate) fn load_process_memory_metrics() -> Result<Option<ProcessMemoryPayload>, AppError> {
    let pid = Pid::from_u32(std::process::id());
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);

    Ok(system.process(pid).map(|process| ProcessMemoryPayload {
        resident_set_bytes: process.memory(),
        virtual_memory_bytes: process.virtual_memory(),
    }))
}

#[cfg(test)]
mod tests {
    use super::redact_context_path;

    #[test]
    fn redact_context_path_keeps_only_file_name_for_local_paths() {
        assert_eq!(
            redact_context_path(Some(r#"F:\MMD\pmx\model.pmx"#)),
            Some("model.pmx".to_string())
        );
        assert_eq!(
            redact_context_path(Some("C:/Users/yohaw/private/model.usd")),
            Some("model.usd".to_string())
        );
    }

    #[test]
    fn redact_context_path_keeps_non_file_contexts() {
        assert_eq!(
            redact_context_path(Some("/World/Character/Body")),
            Some("/World/Character/Body".to_string())
        );
        assert_eq!(
            redact_context_path(Some("MMD warning context")),
            Some("MMD warning context".to_string())
        );
        assert_eq!(redact_context_path(Some("   ")), None);
    }
}
