use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;

use crate::shared::{
    current_timestamp, ensure_parent_dir, resolve_diagnostics_log_path,
};
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

fn append_diagnostic_record(
    app: &tauri::AppHandle,
    record: &DiagnosticRecordInput,
) -> Result<(), String> {
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

#[tauri::command]
pub(crate) fn log_diagnostic_event(
    app: tauri::AppHandle,
    record: DiagnosticRecordInput,
) -> Result<(), String> {
    append_diagnostic_record(&app, &record)
}

#[tauri::command]
pub(crate) fn load_diagnostics_snapshot(
    app: tauri::AppHandle,
) -> Result<DiagnosticsPayload, String> {
    let log_path = resolve_diagnostics_log_path(&app)?;
    ensure_parent_dir(&log_path)?;

    let diagnostics_snapshot = if log_path.exists() {
        let raw = std::fs::read_to_string(&log_path)
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
pub(crate) fn load_process_memory_metrics() -> Result<Option<ProcessMemoryPayload>, String> {
    let pid = Pid::from_u32(std::process::id());
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);

    Ok(system.process(pid).map(|process| ProcessMemoryPayload {
        resident_set_bytes: process.memory(),
        virtual_memory_bytes: process.virtual_memory(),
    }))
}
