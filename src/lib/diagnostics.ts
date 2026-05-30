import { invoke } from "@tauri-apps/api/core";
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

  return invoke<void>("log_diagnostic_event", { record });
}

export async function loadDiagnosticsSnapshot() {
  if (!isTauriEnvironment()) {
    return {
      diagnosticsLogPath: "",
      diagnosticsSnapshot: [],
    };
  }

  return invoke<DiagnosticsPayload>("load_diagnostics_snapshot");
}

export async function loadProcessMemoryMetrics() {
  if (!isTauriEnvironment()) {
    return null;
  }

  return invoke<ProcessMemoryMetrics | null>("load_process_memory_metrics");
}
