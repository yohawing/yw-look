import { readBinaryFile, readBinaryFilePrefix } from "./files";
import { errorMessage } from "./errors";
import { invokeSafe } from "./invokeSafe";
import { isTauriEnvironment } from "./platform";

import type {
  StageLoadPolicy,
  BackendCapabilities,
  StageInspection,
  StageSummary,
  AssetIssue,
  UsdTypedError,
  UsdInvalidVariantSelectionError,
  UsdLightInfo,
  VariantSelection,
  PrimInspection,
  AttributeTimeSamples,
  ExtractGeometryOptions,
  StageSessionHandle,
  UsdSourcePayload,
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
const USD_TASK_BUSY_MESSAGE = "USD_TASK_BUSY";
const USD_FAST_DECISION_SCAN_BYTES = 64 * 1024;
const USDC_MAGIC = new TextEncoder().encode("PXR-USDC");
const USD_GLTF_BACKEND_KEYWORDS = [
  "subLayers",
  "references",
  "payload",
  "PointInstancer",
  "variantSet",
  "Skeleton",
  "SkelRoot",
  "SkelAnimation",
  "BlendShape",
].map((keyword) => new TextEncoder().encode(keyword));
// A time-sampled xform must be composed by the USD backend before the GLB
// route can expose it to the viewer. This is only a candidate marker: the
// backend confirms that the samples belong to a supported xform op.
const USD_XFORM_TIME_SAMPLES_MARKER = new TextEncoder().encode(".timeSamples");

type UsdInvokeOptions = {
  background?: boolean;
};

function withVariantSelections(
  args: Record<string, unknown>,
  variantSelections?: VariantSelection[],
): Record<string, unknown> {
  return variantSelections === undefined
    ? args
    : { ...args, variantSelections };
}

async function invokeUsd<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const result = await invokeSafe<T>(cmd, args);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

export function isInvalidVariantSelectionError(
  error: UsdTypedError | null,
): error is UsdInvalidVariantSelectionError {
  return error?.kind === "invalidVariantSelection";
}

export function parseUsdError(error: unknown): UsdTypedError | null {
  const message = errorMessage(error, "");
  if (!message.startsWith(INVALID_VARIANT_SELECTION_PREFIX)) {
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

  return errorMessage(error, fallback);
}

export function isUsdTaskBusyError(error: unknown): boolean {
  return errorMessage(error, "") === USD_TASK_BUSY_MESSAGE;
}

export async function inspectUsdLights(
  path: string,
  invokeOptions?: UsdInvokeOptions,
  variantSelections?: VariantSelection[],
): Promise<UsdLightInfo[]> {
  return invokeUsd<UsdLightInfo[]>(
    "inspect_usd_lights",
    withVariantSelections(
      {
        path,
        background: invokeOptions?.background,
      },
      variantSelections,
    ),
  );
}

/**
 * #28 — inspect the attributes, relationships, and metadata for the
 * prim at `primPath` inside the USD file at `path`.
 *
 * The Rust backend returns authored attributes, relationships, and metadata
 * for the selected prim. Backend errors are propagated to the caller.
 */
export async function inspectPrim(
  path: string,
  primPath: string,
): Promise<PrimInspection> {
  return invokeUsd<PrimInspection>("inspect_prim", { path, primPath });
}

/**
 * #37 — fetch up to `maxSamples` time samples for the named attribute
 * on the prim at `primPath` inside the USD file at `path`.
 *
 * `maxSamples` defaults to 100 on the Rust side when omitted. The backend
 * also returns truncation metadata and numeric summary statistics.
 */
export async function inspectAttributeTimeSamples(
  path: string,
  primPath: string,
  attrName: string,
  maxSamples?: number,
): Promise<AttributeTimeSamples> {
  return invokeUsd<AttributeTimeSamples>("inspect_attribute_time_samples", {
    path,
    primPath,
    attrName,
    maxSamples,
  });
}

export async function inspectStage(
  path: string,
  policy?: StageLoadPolicy,
  invokeOptions?: UsdInvokeOptions,
  variantSelections?: VariantSelection[],
) {
  return invokeUsd<StageInspection>(
    "inspect_stage",
    withVariantSelections(
      {
        path,
        policy,
        background: invokeOptions?.background,
      },
      variantSelections,
    ),
  );
}

export async function summarizeStage(
  path: string,
  policy?: StageLoadPolicy,
  invokeOptions?: UsdInvokeOptions,
  variantSelections?: VariantSelection[],
) {
  return invokeUsd<StageSummary>(
    "summarize_stage",
    withVariantSelections(
      {
        path,
        policy,
        background: invokeOptions?.background,
      },
      variantSelections,
    ),
  );
}

export function inspectionHasDeferredPayloads(
  inspection: Pick<StageInspection, "payloads">,
): boolean {
  return inspection.payloads.some((arc) => arc.state === "unloaded");
}

export function deferredSummaryHasNoRenderableGeometry(
  summary: Pick<StageSummary, "totalVertices" | "unloadedPayloadCount">,
): boolean {
  return summary.unloadedPayloadCount > 0 && summary.totalVertices === 0;
}

export async function collectAssetIssues(
  path: string,
  invokeOptions?: UsdInvokeOptions,
  variantSelections?: VariantSelection[],
) {
  return invokeUsd<AssetIssue[]>(
    "collect_asset_issues",
    withVariantSelections(
      {
        path,
        background: invokeOptions?.background,
      },
      variantSelections,
    ),
  );
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

function bytesStartWith(bytes: Uint8Array, prefix: Uint8Array) {
  if (bytes.byteLength < prefix.byteLength) {
    return false;
  }
  return prefix.every((value, index) => bytes[index] === value);
}

function bytesInclude(bytes: Uint8Array, needle: Uint8Array) {
  if (needle.byteLength === 0 || needle.byteLength > bytes.byteLength) {
    return false;
  }

  const lastStart = bytes.byteLength - needle.byteLength;
  for (let start = 0; start <= lastStart; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.byteLength; offset += 1) {
      if (bytes[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }
  return false;
}

function bytesRequireUsdGltfBackend(bytes: Uint8Array) {
  return USD_GLTF_BACKEND_KEYWORDS.some((keyword) =>
    bytesInclude(bytes, keyword),
  );
}

function bytesMayContainUsdXformAnimation(bytes: Uint8Array) {
  return bytesInclude(bytes, USD_XFORM_TIME_SAMPLES_MARKER);
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
    const prefix = new Uint8Array(
      await readBinaryFilePrefix(path, USD_FAST_DECISION_SCAN_BYTES),
    );
    if (bytesStartWith(prefix, USDC_MAGIC)) {
      return true;
    }
    if (bytesRequireUsdGltfBackend(prefix)) {
      return true;
    }
    if (bytesMayContainUsdXformAnimation(prefix)) {
      // JS USDLoader can still handle ordinary single-layer static USDA. A
      // sampled candidate needs the backend's authored-xform confirmation.
      return isTauriEnvironment() ? null : false;
    }
    if (prefix.byteLength < USD_FAST_DECISION_SCAN_BYTES) {
      return false;
    }
    if (isTauriEnvironment()) {
      return null;
    }

    const buffer = new Uint8Array(await readBinaryFile(path));
    return bytesRequireUsdGltfBackend(buffer);
  } catch {
    return null;
  }
}

export async function requiresGlbPreview(path: string) {
  const fastDecision = await fastTextUsdRequiresGlbPreview(path);
  if (fastDecision !== null) {
    return fastDecision;
  }
  return invokeUsd<boolean>("requires_glb_preview", { path });
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
  return invokeUsd<BackendCapabilities>("backend_capabilities");
}

/**
 * #39 — returns the fully flattened USDA text for the stage at `path`,
 * equivalent to `usdcat --flatten`. Every reference, payload, and sublayer
 * is composed and inlined into the returned string.
 *
 * The current Rust backend does not implement source flattening, so the
 * promise rejects with a descriptive error. Callers should keep the "Binary
 * stage" placeholder in that case.
 */
export async function flattenStage(path: string): Promise<string> {
  return invokeUsd<string>("flatten_stage", { path });
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
  invokeOptions?: UsdInvokeOptions,
) {
  // Backwards compatible: callers can still pass a bare policy string.
  // When an options object is supplied it goes through to the Tauri
  // command's `options` arg, which takes precedence over `policy`.
  if (typeof policyOrOptions === "object" && policyOrOptions !== null) {
    return invokeUsd<ArrayBuffer>("extract_geometry", {
      path,
      options: policyOrOptions,
      background: invokeOptions?.background,
    });
  }
  return invokeUsd<ArrayBuffer>("extract_geometry", {
    path,
    policy: policyOrOptions,
    background: invokeOptions?.background,
  });
}

// #44 — Stateful per-prim payload session API

export async function openStageSession(
  path: string,
  policy?: StageLoadPolicy,
  invokeOptions?: UsdInvokeOptions,
): Promise<StageSessionHandle> {
  return invokeUsd<StageSessionHandle>("open_stage_session", {
    path,
    policy,
    background: invokeOptions?.background,
  });
}

/**
 * Releases the stage session associated with `handle`. After this call
 * the handle is invalid and all further operations on it will fail.
 */
export async function closeStageSession(
  handle: StageSessionHandle,
): Promise<void> {
  return invokeUsd<void>("close_stage_session", { handle });
}

/**
 * Loads the payload arc at `primPath` in the open stage identified by
 * `handle`. Descendants are loaded as well (`UsdLoadWithDescendants`).
 *
 * The current Rust backend applies this request by reopening its session
 * stage with the requested payload roots loaded.
 */
export async function loadPayload(
  handle: StageSessionHandle,
  primPath: string,
): Promise<void> {
  return invokeUsd<void>("load_payload", { handle, primPath });
}

/**
 * Unloads the payload arc at `primPath` in the open stage identified by
 * `handle`.
 *
 * The current Rust backend applies this request by reopening its session
 * stage without the requested payload roots.
 */
export async function unloadPayload(
  handle: StageSessionHandle,
  primPath: string,
): Promise<void> {
  return invokeUsd<void>("unload_payload", { handle, primPath });
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
  return invokeUsd<ArrayBuffer>("extract_geometry_session", {
    handle,
    options,
  });
}
