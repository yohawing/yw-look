import { invoke } from "@tauri-apps/api/core";
import { error as logError, warn as logWarn } from "@tauri-apps/plugin-log";
import { isTauriEnvironment } from "./platform";

import type {
  DiagnosticRecordInput,
  DiagnosticsPayload,
  ProcessMemoryMetrics,
} from "../types/ipc";

export type {
  DiagnosticRecordInput,
  DiagnosticsPayload,
  ProcessMemoryMetrics,
  WebGLResourceMetrics,
  RuntimeMemoryMetrics,
  AssetResourceMetrics,
  ResourceDiagnosticsSnapshot,
} from "../types/ipc";

export async function logDiagnosticEvent(record: DiagnosticRecordInput) {
  if (!isTauriEnvironment()) {
    return;
  }

  const logMessage = `[${record.code}] ${record.message}${
    record.detail ? `\n${record.detail}` : ""
  }`;
  const logFn =
    record.level === "warn" || record.level === "warning" ? logWarn : logError;
  await logFn(logMessage, { file: "diagnostics" }).catch(() => {});
  return invoke<void>("log_diagnostic_event", { record });
}

export async function loadDiagnosticsSnapshot() {
  if (!isTauriEnvironment()) {
    return {
      appVersion: "dev",
      platform: "web",
      arch: "unknown",
      appLogDir: "",
      diagnosticsLogPath: "",
      diagnosticsSnapshot: [],
    };
  }

  return invoke<DiagnosticsPayload>("load_diagnostics_snapshot");
}

export async function openAppLogDir() {
  if (!isTauriEnvironment()) {
    return;
  }

  return invoke<void>("open_app_log_dir");
}

export async function loadProcessMemoryMetrics() {
  if (!isTauriEnvironment()) {
    return null;
  }

  return invoke<ProcessMemoryMetrics | null>("load_process_memory_metrics");
}
