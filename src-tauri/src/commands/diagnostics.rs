use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

use crate::error::AppError;
use crate::shared::{current_timestamp, ensure_parent_dir, resolve_diagnostics_log_path};
use sysinfo::{Pid, ProcessesToUpdate, System};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiagnosticsPayload {
    pub(crate) diagnostics_log_path: String,
    pub(crate) diagnostics_snapshot: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProcessMemoryPayload {
    pub(crate) resident_set_bytes: u64,
    pub(crate) virtual_memory_bytes: u64,
}

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
    ensure_parent_dir(&log_path)?;

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
        diagnostics_log_path: log_path.display().to_string(),
        diagnostics_snapshot,
    })
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
