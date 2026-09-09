import type { AppError } from "../types/ipc";
import type { PreviewLoadStats, PreviewWarning } from "../types/viewer";
import { errorMessage } from "./errors";
import { invokeSafe } from "./invokeSafe";
import { isTauriEnvironment, isWindowsEnvironment } from "./platform";

// Keep the format pack off viewer/index.ts: that barrel imports the loader
// registry, which imports packs and would re-enter this loader during startup.
export { parseModelInWorker } from "../viewer/modelParseWorker";

export const RHINO3DM_PREVIEW_COMMAND = "convert_rhino3dm_preview";
export const RHINO3DM_CANCEL_COMMAND = "cancel_rhino3dm_preview";
export const DEFAULT_RHINO3DM_PREVIEW_TIMEOUT_MS = 120_000;

const RHINO3DM_PACKET_MAGIC = new Uint8Array([
  0x59, 0x57, 0x33, 0x44, 0x4d, 0x47, 0x4c, 0x42,
]);
const RHINO3DM_PACKET_VERSION = 1;
const RHINO3DM_SCHEMA_VERSION = 1;
const RHINO3DM_PROTOCOL_VERSION = 1;
const RHINO3DM_PACKET_FIXED_BYTES = RHINO3DM_PACKET_MAGIC.byteLength + 4;
const MAX_RHINO3DM_PACKET_HEADER_BYTES = 1024 * 1024;

/**
 * Bounds the second, in-process step after native conversion. These limits
 * are intentionally independent from the helper's conversion limits: a GLB
 * may be small on disk while its decoded Three.js resources are large.
 */
export const RHINO3DM_STATIC_SCENE_BUDGET = {
  maxNodes: 500_000,
  maxGeometryCount: 250_000,
  maxVertexBytes: 1_073_741_824,
  maxIndexBytes: 1_073_741_824,
  maxTextureDecodedBytes: 1_073_741_824,
} as const;

export type Rhino3dmPreviewResult = {
  bytes: ArrayBuffer;
  warnings: PreviewWarning[];
  stats: PreviewLoadStats | null;
};

export type Rhino3dmPreviewOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  requestId?: string;
};

type NativeWarning = {
  message?: unknown;
  reason?: unknown;
  stage?: unknown;
  limit?: unknown;
  observed?: unknown;
  count?: unknown;
  kind?: unknown;
  category?: unknown;
  details?: unknown;
};

type NativePacketHeader = {
  packetVersion?: unknown;
  schemaVersion?: unknown;
  protocolVersion?: unknown;
  helperRevision?: unknown;
  requestId?: unknown;
  warnings?: unknown;
  stats?: unknown;
  glbBytes?: unknown;
};

type Rhino3dmAppError = AppError & Error;

type StaticSceneBudgetError = Error & {
  reason?: unknown;
  usage?: unknown;
  limit?: unknown;
};

let nextRequestId = 1;

function createAbortError(): Error {
  const error = new Error("Rhino 3DM preview was canceled.");
  error.name = "AbortError";
  return error;
}

function createTimeoutError(timeoutMs: number): Error {
  const error = new Error(
    `Rhino 3DM preview timed out after ${Math.round(timeoutMs / 1000)}s.`,
  );
  error.name = "TimeoutError";
  return error;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asOptionalCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function asOptionalLimit(value: unknown): number | string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return asOptionalString(value);
}

function warningMessageForCategory(category: string | undefined): string {
  switch (category) {
    case "missing_saved_mesh_extrusion":
      return "Extrusion objects without saved meshes were omitted from the preview.";
    case "missing_saved_mesh":
      return "Objects without saved meshes were omitted from the preview.";
    case "unsupported_geometry":
      return "Some geometry types are not supported by the preview.";
    case "missing_instance_member":
    case "missing_instance_definition":
      return "Some instance references could not be resolved for the preview.";
    case "unsupported_textures":
      return "Some textures are not supported by the preview.";
    case "unsupported_full_pbr":
      return "Some material properties are not supported by the preview.";
    case "unsupported_curves":
      return "Some curves were omitted from the preview.";
    case "unsupported_points":
      return "Some points were omitted from the preview.";
    case "unsupported_annotations":
      return "Some annotations were omitted from the preview.";
    case "unsupported_lights":
      return "Some lights were omitted from the preview.";
    case "warningsTruncated":
    case "resultTruncated":
      return "Some preview warnings could not be reported.";
    default:
      return "Some 3DM preview data could not be displayed.";
  }
}

function warningFromWire(value: unknown): PreviewWarning | null {
  if (typeof value === "string" && value.trim()) {
    return { message: value };
  }
  if (!value || typeof value !== "object") return null;

  const warning = value as NativeWarning;
  const details =
    warning.details && typeof warning.details === "object"
      ? (warning.details as NativeWarning)
      : undefined;
  const message =
    asOptionalString(warning.message) ??
    asOptionalString(details?.message) ??
    asOptionalString(warning.reason) ??
    asOptionalString(details?.reason) ??
    warningMessageForCategory(
      asOptionalString(warning.category) ??
        asOptionalString(warning.kind) ??
        asOptionalString(details?.category) ??
        asOptionalString(details?.kind),
    );
  const reason =
    asOptionalString(warning.reason) ?? asOptionalString(details?.reason);
  const stage =
    asOptionalString(warning.stage) ?? asOptionalString(details?.stage);
  const limit =
    asOptionalLimit(warning.limit) ?? asOptionalLimit(details?.limit);
  const observed =
    asOptionalLimit(warning.observed) ?? asOptionalLimit(details?.observed);
  const count =
    asOptionalCount(warning.count) ?? asOptionalCount(details?.count);
  const category =
    asOptionalString(warning.category) ??
    asOptionalString(warning.kind) ??
    asOptionalString(details?.category) ??
    asOptionalString(details?.kind);

  return {
    message,
    ...(reason ? { reason } : {}),
    ...(stage ? { stage } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(observed !== undefined ? { observed } : {}),
    ...(count !== undefined ? { count } : {}),
    ...(category ? { category } : {}),
  };
}

function normalizeWarnings(value: unknown): PreviewWarning[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((warning) => {
    const normalized = warningFromWire(warning);
    return normalized ? [normalized] : [];
  });
}

function normalizeStats(value: unknown): PreviewLoadStats | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const stats: PreviewLoadStats = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === "number" ||
      typeof entry === "string" ||
      typeof entry === "boolean" ||
      entry === null
    ) {
      stats[key] = entry;
    }
  }
  return stats;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function assertPacketVersion(
  header: NativePacketHeader,
  key: "packetVersion" | "schemaVersion" | "protocolVersion",
  expected: number,
): void {
  if (header[key] !== expected) {
    throw new Error(`Rhino 3DM preview packet has an unsupported ${key}.`);
  }
}

function decodePreviewPacket(
  value: unknown,
  expectedRequestId: string,
): Rhino3dmPreviewResult {
  if (!(value instanceof ArrayBuffer)) {
    throw new Error("Rhino 3DM preview returned a non-binary packet.");
  }
  const packet = new Uint8Array(value);
  if (packet.byteLength < RHINO3DM_PACKET_FIXED_BYTES) {
    throw new Error("Rhino 3DM preview packet is truncated.");
  }
  for (let index = 0; index < RHINO3DM_PACKET_MAGIC.byteLength; index += 1) {
    if (packet[index] !== RHINO3DM_PACKET_MAGIC[index]) {
      throw new Error("Rhino 3DM preview packet has an invalid magic.");
    }
  }

  const headerLength = new DataView(value).getUint32(8, true);
  if (
    headerLength === 0 ||
    headerLength > MAX_RHINO3DM_PACKET_HEADER_BYTES ||
    headerLength > packet.byteLength - RHINO3DM_PACKET_FIXED_BYTES
  ) {
    throw new Error("Rhino 3DM preview packet has an invalid header length.");
  }
  const headerStart = RHINO3DM_PACKET_FIXED_BYTES;
  const headerEnd = headerStart + headerLength;
  let headerText: string;
  try {
    headerText = new TextDecoder("utf-8", { fatal: true }).decode(
      packet.subarray(headerStart, headerEnd),
    );
  } catch {
    throw new Error("Rhino 3DM preview packet header is not valid UTF-8.");
  }

  let parsedHeader: unknown;
  try {
    parsedHeader = JSON.parse(headerText);
  } catch {
    throw new Error("Rhino 3DM preview packet header is not valid JSON.");
  }
  if (!isRecord(parsedHeader)) {
    throw new Error("Rhino 3DM preview packet header is not an object.");
  }
  const header = parsedHeader as NativePacketHeader;
  assertPacketVersion(header, "packetVersion", RHINO3DM_PACKET_VERSION);
  assertPacketVersion(header, "schemaVersion", RHINO3DM_SCHEMA_VERSION);
  assertPacketVersion(header, "protocolVersion", RHINO3DM_PROTOCOL_VERSION);
  if (
    typeof header.helperRevision !== "string" ||
    header.helperRevision.trim().length === 0
  ) {
    throw new Error("Rhino 3DM preview packet has no helper revision.");
  }
  if (
    header.requestId !== undefined &&
    (typeof header.requestId !== "string" ||
      header.requestId !== expectedRequestId)
  ) {
    throw new Error("Rhino 3DM preview packet request does not match.");
  }
  if (!Array.isArray(header.warnings) || !isRecord(header.stats)) {
    throw new Error("Rhino 3DM preview packet has invalid metadata.");
  }
  if (!isSafeInteger(header.glbBytes) || header.glbBytes < 4) {
    throw new Error("Rhino 3DM preview packet has an invalid GLB length.");
  }
  const glbBytes = packet.byteLength - headerEnd;
  if (header.glbBytes !== glbBytes) {
    throw new Error("Rhino 3DM preview packet GLB length does not match.");
  }
  if (
    packet[headerEnd] !== 0x67 ||
    packet[headerEnd + 1] !== 0x6c ||
    packet[headerEnd + 2] !== 0x54 ||
    packet[headerEnd + 3] !== 0x46
  ) {
    throw new Error("Rhino 3DM preview packet does not contain a GLB payload.");
  }

  return {
    bytes: value.slice(headerEnd),
    warnings: normalizeWarnings(header.warnings),
    stats: normalizeStats(header.stats),
  };
}

function formatNativeError(error: AppError): Rhino3dmAppError {
  const detailParts = Object.entries(error.details ?? {})
    .filter(
      ([key, value]) =>
        ["reason", "stage", "limit", "observed"].includes(key) &&
        (typeof value === "string" || typeof value === "number"),
    )
    .map(([key, value]) => `${key[0].toUpperCase()}${key.slice(1)}: ${value}`);
  const message =
    detailParts.length > 0
      ? `${error.message} (${detailParts.join(", ")})`
      : error.message;
  const displayError = Object.assign(new Error(message), {
    kind: error.kind,
    ...(error.details ? { details: error.details } : {}),
  }) as Rhino3dmAppError;
  displayError.name = "Rhino3dmPreviewError";
  return displayError;
}

function isStaticSceneBudgetError(
  error: unknown,
): error is StaticSceneBudgetError {
  return (
    error instanceof Error && error.name === "StaticScenePayloadBudgetError"
  );
}

function staticSceneBudgetUsage(
  error: StaticSceneBudgetError,
): number | undefined {
  if (!error.usage || typeof error.usage !== "object") return undefined;
  const reason = typeof error.reason === "string" ? error.reason : "";
  const observed = (error.usage as Record<string, unknown>)[reason];
  return typeof observed === "number" && Number.isFinite(observed)
    ? observed
    : undefined;
}

/** Preserve worker expansion-limit details as a user-facing native error. */
export function normalizeRhino3dmStaticSceneError(error: unknown): Error {
  if (!isStaticSceneBudgetError(error)) {
    return error instanceof Error
      ? error
      : new Error(errorMessage(error, "Unknown Rhino 3DM loader error"));
  }

  const reason = "preview data exceeds the display budget";
  const budgetReason =
    typeof error.reason === "string" ? error.reason : undefined;
  const observed = staticSceneBudgetUsage(error);
  const limit =
    typeof error.limit === "number" && Number.isFinite(error.limit)
      ? error.limit
      : undefined;
  const details = {
    reason,
    stage: "scene reconstruction",
    ...(limit !== undefined ? { limit } : {}),
    ...(observed !== undefined ? { observed } : {}),
  };
  const detailParts = [
    `Reason: ${reason}`,
    `Stage: ${details.stage}`,
    limit !== undefined ? `Limit: ${limit}` : null,
    observed !== undefined ? `Observed: ${observed}` : null,
  ].filter((value): value is string => value !== null);
  const displayError = Object.assign(
    new Error(
      `Rhino 3DM preview exceeds the display budget. (${detailParts.join(", ")})`,
    ),
    {
      name: "Rhino3dmPreviewError",
      kind: "outputLimit",
      details: {
        ...details,
        ...(budgetReason ? { budgetReason } : {}),
      },
      cause: error,
    },
  );
  return displayError;
}

function makeRequestId(): string {
  return `rhino3dm-${Date.now().toString(36)}-${nextRequestId++}`;
}

async function cancelRhino3dmPreview(requestId: string): Promise<void> {
  await invokeSafe<boolean>(RHINO3DM_CANCEL_COMMAND, { requestId });
}

export function isRhino3dmNativePreviewEnabled(): boolean {
  return isTauriEnvironment() && isWindowsEnvironment();
}

export async function convertRhino3dmPreview(
  path: string,
  options: Rhino3dmPreviewOptions = {},
): Promise<Rhino3dmPreviewResult> {
  if (!isRhino3dmNativePreviewEnabled()) {
    throw new Error("Native Rhino 3DM preview is only available on desktop.");
  }
  if (options.signal?.aborted) throw createAbortError();

  const timeoutMs = options.timeoutMs ?? DEFAULT_RHINO3DM_PREVIEW_TIMEOUT_MS;
  const requestId = options.requestId ?? makeRequestId();
  return new Promise<Rhino3dmPreviewResult>((resolve, reject) => {
    let settled = false;
    let cancelIssued = false;
    const timeoutId = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      cancelIssued = true;
      void cancelRhino3dmPreview(requestId);
      options.signal?.removeEventListener("abort", handleAbort);
      reject(createTimeoutError(timeoutMs));
    }, timeoutMs);
    const cleanup = () => {
      globalThis.clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", handleAbort);
    };
    const handleAbort = () => {
      if (settled) return;
      settled = true;
      if (!cancelIssued) {
        cancelIssued = true;
        void cancelRhino3dmPreview(requestId);
      }
      cleanup();
      reject(createAbortError());
    };
    options.signal?.addEventListener("abort", handleAbort, { once: true });

    void invokeSafe<ArrayBuffer>(RHINO3DM_PREVIEW_COMMAND, {
      path,
      requestId,
    }).then((result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!result.ok) {
        reject(formatNativeError(result.error));
        return;
      }
      try {
        resolve(decodePreviewPacket(result.value, requestId));
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error(
                errorMessage(error, "Invalid Rhino 3DM preview result."),
              ),
        );
      }
    });
  });
}
