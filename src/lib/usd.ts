import { invoke } from "@tauri-apps/api/core";
import { readBinaryFile } from "./files";

import type {
  StageLoadPolicy,
  BackendCapabilities,
  StageInspection,
  StageSummary,
  AssetIssue,
  UsdTypedError,
  UsdInvalidVariantSelectionError,
  UsdLightInfo,
  PrimInspection,
  AttributeTimeSamples,
  ExtractGeometryOptions,
  StageSessionHandle,
  UsdSourcePayload,
  AppError,
} from "../types/ipc";

export type {
  StageLoadPolicy,
  BackendCapabilities,
  CompositionArcState,
  CompositionArcKind,
  CompositionArc,
  VariantSetInfo,
  VariantSelection,
  UsdInvalidVariantSelectionError,
  UsdTypedError,
  PurposeModes,
  ExtractGeometryOptions,
  LayerInfo,
  StageInspection,
  PrimTypeCount,
  StageSummary,
  AssetIssueCode,
  AssetIssueLevel,
  AssetIssue,
  AttributeInfo,
  RelationshipInfo,
  MetadataEntry,
  PrimInspection,
  ShapingCone,
  UsdLightInfo,
  TimeSampleEntry,
  AttributeTimeSamples,
  UsdSourcePayload,
  StageSessionHandle,
} from "../types/ipc";

const INVALID_VARIANT_SELECTION_PREFIX = "USD_INVALID_VARIANT_SELECTION\t";

function tauriErrorMessage(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (isAppError(error)) return error.message;
  return null;
}

function isAppError(error: unknown): error is AppError {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    "message" in error &&
    typeof (error as Record<string, unknown>).kind === "string" &&
    typeof (error as Record<string, unknown>).message === "string"
  );
}

export function isInvalidVariantSelectionError(
  error: UsdTypedError | null,
): error is UsdInvalidVariantSelectionError {
  return error?.kind === "invalidVariantSelection";
}

export function parseUsdError(error: unknown): UsdTypedError | null {
  const message = tauriErrorMessage(error);
  if (!message?.startsWith(INVALID_VARIANT_SELECTION_PREFIX)) {
    return null;
  }

  const fields = new Map<string, string>();
  const body = message.slice(INVALID_VARIANT_SELECTION_PREFIX.length);
  for (const part of body.split("\t")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    fields.set(part.slice(0, separator), part.slice(separator + 1));
  }

  const primPath = fields.get("primPath");
  const setName = fields.get("setName");
  const variantName = fields.get("variantName");
  if (!primPath || !setName || !variantName) {
    return null;
  }

  return {
    kind: "invalidVariantSelection",
    primPath,
    setName,
    variantName,
  };
}

export function formatUsdErrorForDisplay(
  error: unknown,
  fallback: string,
): string {
  const parsed = parseUsdError(error);
  if (isInvalidVariantSelectionError(parsed)) {
    return `Variant selection failed: ${parsed.setName}=${parsed.variantName} on ${parsed.primPath}`;
  }

  return tauriErrorMessage(error) ?? fallback;
}

export async function inspectUsdLights(path: string): Promise<UsdLightInfo[]> {
  return invoke<UsdLightInfo[]>("inspect_usd_lights", { path });
}

/**
 * #28 — inspect the attributes, relationships, and metadata for the
 * prim at `primPath` inside the USD file at `path`.
 *
 * Only available on the C++ backend; the Rust fork backend returns an
 * error, which this wrapper re-throws so callers can handle gracefully.
 */
export async function inspectPrim(
  path: string,
  primPath: string,
): Promise<PrimInspection> {
  return invoke<PrimInspection>("inspect_prim", { path, primPath });
}

/**
 * #37 — fetch up to `maxSamples` time samples for the named attribute
 * on the prim at `primPath` inside the USD file at `path`.
 *
 * `maxSamples` defaults to 100 on the Rust side when omitted.
 * Only available on the C++ backend; the Rust fork returns an error.
 */
export async function inspectAttributeTimeSamples(
  path: string,
  primPath: string,
  attrName: string,
  maxSamples?: number,
): Promise<AttributeTimeSamples> {
  return invoke<AttributeTimeSamples>("inspect_attribute_time_samples", {
    path,
    primPath,
    attrName,
    maxSamples,
  });
}

export async function inspectStage(path: string, policy?: StageLoadPolicy) {
  return invoke<StageInspection>("inspect_stage", { path, policy });
}

export async function summarizeStage(path: string, policy?: StageLoadPolicy) {
  return invoke<StageSummary>("summarize_stage", { path, policy });
}

export async function collectAssetIssues(path: string) {
  return invoke<AssetIssue[]>("collect_asset_issues", { path });
}

/**
 * Phase 3: decides whether the frontend should route this USD file through
 * the Rust GLB extraction pipeline instead of Three.js `USDLoader.parse`.
 *
 * Returns `true` when:
 *   - the root layer is binary USDC (`USDLoader` cannot read it at all), or
 *   - the stage composes more than one layer (references, payloads,
 *     sublayers) — yw-look only hands USDLoader a single text buffer, so
 *     any external composition is invisible on the JS side.
 *
 * The backend opens the stage with payloads deferred and inspects
 * `layer_count` / skipped payloads, so this is cheap enough to call
 * eagerly during the load pipeline.
 */
function extensionFromPath(path: string) {
  return path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
}

async function fastTextUsdRequiresGlbPreview(path: string) {
  const extension = extensionFromPath(path);
  if (extension === "usdc") {
    return true;
  }
  if (extension === "usd") {
    return true;
  }
  if (extension !== "usda") {
    return null;
  }

  try {
    const buffer = new Uint8Array(await readBinaryFile(path));
    if (new TextDecoder().decode(buffer.slice(0, 8)) === "PXR-USDC") {
      return true;
    }
    const source = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return (
      source.includes("subLayers") ||
      source.includes("references") ||
      source.includes("payload")
    );
  } catch {
    return null;
  }
}

export async function requiresGlbPreview(path: string) {
  const fastDecision = await fastTextUsdRequiresGlbPreview(path);
  if (fastDecision !== null) {
    return fastDecision;
  }
  return invoke<boolean>("requires_glb_preview", { path });
}

export async function loadUsdSource(
  path: string,
  extension: string,
): Promise<UsdSourcePayload> {
  // Short-circuit on extensions that are guaranteed binary so we
  // never round-trip a multi-MB `.usdc` (or other future binary
  // formats) through the JS number-array IPC just to discard it.
  // Other extensions still need a content sniff: `.usd` may be
  // either USDA or USDC, and `.usdz` is a zip whose first layer
  // could be either.
  if (extension === "usdc") {
    return { kind: "binary" };
  }
  const { tryExtractUsdaText } = await import("../viewer");
  const buffer = await readBinaryFile(path);
  const text = await tryExtractUsdaText(extension, buffer);
  return text === null ? { kind: "binary" } : { kind: "text", source: text };
}

export async function backendCapabilities(): Promise<BackendCapabilities> {
  return invoke<BackendCapabilities>("backendCapabilities");
}

/**
 * #39 — returns the fully flattened USDA text for the stage at `path`,
 * equivalent to `usdcat --flatten`. Every reference, payload, and sublayer
 * is composed and inlined into the returned string.
 *
 * Only implemented on the C++ backend. On the Rust backend the promise
 * rejects with a descriptive error — callers should handle that case
 * gracefully (e.g. keep the "Binary stage" placeholder).
 */
export async function flattenStage(path: string): Promise<string> {
  return invoke<string>("flatten_stage", { path });
}

/**
 * Phase 3: extracts every Mesh prim from the USD stage at `path` and
 * returns a self-contained GLB binary as an `ArrayBuffer`. Feed the result
 * to `GLTFLoader.parseAsync(buffer, "")` on the frontend. Only call this
 * when `isRootLayerBinary(path)` returned `true` — for USDA stages the
 * existing Three.js `USDLoader` is faster and more accurate.
 *
 * Phase 4: pass `policy = "noPayloads"` to build a GLB that only
 * contains meshes from payload-free composition. Under deferred mode
 * the backend may throw if the stage has no renderable meshes without
 * its payloads, so callers should guard against that.
 */
export async function extractGeometry(
  path: string,
  policyOrOptions?: StageLoadPolicy | ExtractGeometryOptions,
) {
  // Backwards compatible: callers can still pass a bare policy string.
  // When an options object is supplied it goes through to the Tauri
  // command's `options` arg, which takes precedence over `policy`.
  if (typeof policyOrOptions === "object" && policyOrOptions !== null) {
    return invoke<ArrayBuffer>("extract_geometry", {
      path,
      options: policyOrOptions,
    });
  }
  return invoke<ArrayBuffer>("extract_geometry", {
    path,
    policy: policyOrOptions,
  });
}

// #44 — Stateful per-prim payload session API

export async function openStageSession(
  path: string,
  policy?: StageLoadPolicy,
): Promise<StageSessionHandle> {
  return invoke<StageSessionHandle>("open_stage_session", { path, policy });
}

/**
 * Releases the stage session associated with `handle`. After this call
 * the handle is invalid and all further operations on it will fail.
 */
export async function closeStageSession(
  handle: StageSessionHandle,
): Promise<void> {
  return invoke<void>("close_stage_session", { handle });
}

/**
 * Loads the payload arc at `primPath` in the open stage identified by
 * `handle`. Descendants are loaded as well (`UsdLoadWithDescendants`).
 *
 * Only supported on the C++ backend; throws on the Rust-fork backend.
 */
export async function loadPayload(
  handle: StageSessionHandle,
  primPath: string,
): Promise<void> {
  return invoke<void>("load_payload", { handle, primPath });
}

/**
 * Unloads the payload arc at `primPath` in the open stage identified by
 * `handle`.
 *
 * Only supported on the C++ backend; throws on the Rust-fork backend.
 */
export async function unloadPayload(
  handle: StageSessionHandle,
  primPath: string,
): Promise<void> {
  return invoke<void>("unload_payload", { handle, primPath });
}

/**
 * Extracts GLB geometry from the currently loaded state of the session
 * stage. Use after calling `loadPayload` / `unloadPayload` to get a
 * mesh that reflects the current payload state.
 */
export async function extractGeometrySession(
  handle: StageSessionHandle,
  options?: ExtractGeometryOptions,
): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("extract_geometry_session", { handle, options });
}
