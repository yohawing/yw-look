import type { DiagnosticsPayload } from "./diagnostics";
import type { BackendCapabilities } from "./usd";
import type { OptionalLoaderPackStatus } from "../types/viewer";

export const ISSUE_REPORT_URL =
  "https://github.com/yohawing/yw-look/issues/new";

export function collectGpuRenderer(): string {
  if (typeof document === "undefined") {
    return "unknown";
  }

  const canvas = document.createElement("canvas");
  const gl =
    canvas.getContext("webgl2") ??
    canvas.getContext("webgl") ??
    canvas.getContext("experimental-webgl");
  if (!gl || !("getExtension" in gl)) {
    return "unavailable";
  }

  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  if (!debugInfo) {
    return "unavailable";
  }

  return String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
}

export function formatUsdBackend(capabilities: BackendCapabilities | null) {
  if (!capabilities) {
    return "unknown";
  }
  if (capabilities.geometry && capabilities.session && capabilities.light) {
    return "openusd-cpp";
  }
  if (capabilities.inspect) {
    return "openusd-rs";
  }
  return "unavailable";
}

export function summarizeLoaderPacks(
  packs: readonly OptionalLoaderPackStatus[] = [],
) {
  if (packs.length === 0) {
    return "none registered";
  }

  return packs
    .map((pack) => {
      const state = pack.installed && pack.enabled ? "enabled" : "disabled";
      const version = pack.version ? ` ${pack.version}` : "";
      return `${pack.id}${version}: ${state}, ${pack.compatibility.state}`;
    })
    .join("\n");
}

export function buildDiagnosticsReport({
  capabilities,
  diagnostics,
  errorDetail,
  loaderPacks,
  viewerState,
}: {
  capabilities: BackendCapabilities | null;
  diagnostics: DiagnosticsPayload;
  errorDetail?: string | null;
  loaderPacks?: readonly OptionalLoaderPackStatus[];
  viewerState?: string | null;
}) {
  const lines = [
    "yw-look diagnostic report",
    "",
    `App version: ${diagnostics.appVersion}`,
    `Platform: ${diagnostics.platform} ${diagnostics.arch}`,
    `User agent: ${typeof navigator === "undefined" ? "unknown" : navigator.userAgent}`,
    `GPU renderer: ${collectGpuRenderer()}`,
    `USD backend: ${formatUsdBackend(capabilities)}`,
    `App log dir: ${diagnostics.appLogDir || "(unavailable)"}`,
    `Diagnostics log: ${diagnostics.diagnosticsLogPath || "(unavailable)"}`,
    "",
    "Loader packs:",
    summarizeLoaderPacks(loaderPacks),
  ];

  if (viewerState) {
    lines.push("", "Viewer state:", viewerState);
  }

  if (errorDetail) {
    lines.push("", "Error detail:", errorDetail);
  }

  if (diagnostics.diagnosticsSnapshot.length > 0) {
    lines.push("", "Recent diagnostics:", ...diagnostics.diagnosticsSnapshot);
  }

  return lines.join("\n");
}
