import { invoke } from "@tauri-apps/api/core";

export type DiagnosticRecordInput = {
  code: string;
  level: string;
  message: string;
  detail?: string | null;
  contextPath?: string | null;
};

export type DiagnosticsPayload = {
  diagnosticsLogPath: string;
  diagnosticsSnapshot: string[];
};

export async function logDiagnosticEvent(record: DiagnosticRecordInput) {
  return invoke<void>("log_diagnostic_event", { record });
}

export async function loadDiagnosticsSnapshot() {
  return invoke<DiagnosticsPayload>("load_diagnostics_snapshot");
}
