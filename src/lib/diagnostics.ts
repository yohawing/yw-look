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

export type WebGLResourceMetrics = {
  geometries: number;
  textures: number;
  programs: number | null;
  calls: number;
  triangles: number;
  points: number;
  lines: number;
};

export type RuntimeMemoryMetrics = {
  jsHeapUsedBytes: number | null;
  jsHeapTotalBytes: number | null;
  jsHeapLimitBytes: number | null;
};

export type AssetResourceMetrics = {
  vertices: number;
  triangles: number;
  materials: number;
  textures: number;
};

export type ResourceDiagnosticsSnapshot = {
  sampledAt: number;
  webgl: WebGLResourceMetrics;
  memory: RuntimeMemoryMetrics;
  asset: AssetResourceMetrics | null;
};

export async function logDiagnosticEvent(record: DiagnosticRecordInput) {
  return invoke<void>("log_diagnostic_event", { record });
}

export async function loadDiagnosticsSnapshot() {
  return invoke<DiagnosticsPayload>("load_diagnostics_snapshot");
}
