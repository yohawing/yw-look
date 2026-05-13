import { invoke } from "@tauri-apps/api/core";
import { readBinaryFile } from "./files";

/**
 * Phase 4 wire-level load policy. `loadAll` keeps the Phase 3 behavior
 * of composing references and payloads together; `noPayloads` defers
 * every payload, leaving the authored metadata visible in the inspector
 * but not loading the target layers. Omitting the argument to an invoke
 * is equivalent to `loadAll`.
 */
export type StageLoadPolicy = "loadAll" | "noPayloads";

export type BackendCapabilities = {
  inspect: boolean;
  geometry: boolean;
  source: boolean;
  session: boolean;
  light: boolean;
};

/**
 * Resolution state of a composition arc.
 * - `loaded`: the arc is composed into the stage.
 * - `missing`: the resolver could not find the target asset.
 * - `unloaded`: Phase 4 — a payload arc that was deliberately skipped
 *   because the stage was opened with `noPayloads`. The target is
 *   resolvable but has not been composed.
 */
export type CompositionArcState = "loaded" | "missing" | "unloaded";

/**
 * #30 — the kind of composition arc. Ordered from strongest to weakest
 * in LIVRPS strength order (simplified). `variantSelection` arcs have
 * an empty `assetPath`; the selection is encoded in `targetPrim` as
 * `"{setName}={variantName}"`. `inherits` and `specializes` also have
 * an empty `assetPath` since they reference prims within the same stage.
 */
export type CompositionArcKind =
  | "reference"
  | "payload"
  | "inherits"
  | "specializes"
  | "variantSelection"
  | "over";

export type CompositionArc = {
  sourcePrim: string;
  /**
   * For `reference`/`payload`: the external asset file path.
   * For `inherits`/`specializes`/`variantSelection`: empty string.
   */
  assetPath: string;
  /**
   * For `reference`/`payload`/`inherits`/`specializes`: target prim
   * path inside the asset or stage. For `variantSelection`: the
   * selection encoded as `"{setName}={variantName}"`.
   */
  targetPrim: string;
  state: CompositionArcState;
  /**
   * #30 — arc kind. Optional for backwards compatibility: payloads from
   * older backends that omit this field default to `"reference"` on the
   * Rust side via `#[serde(default)]`.
   */
  kind?: CompositionArcKind;
};

export type VariantSetInfo = {
  primPath: string;
  setName: string;
  selection: string | null;
  /**
   * Available variant names in this set. Empty when the backend can
   * not enumerate them (e.g. the openusd Rust fork — only the C++
   * shim populates this for now). UI should disable the switcher
   * pulldown when this list is empty.
   */
  variants: string[];
};

/**
 * Round 1.5 (#31): one variant override applied before geometry
 * extraction. Stateless — every extract call applies the full set of
 * selections from scratch on a fresh stage.
 */
export type VariantSelection = {
  primPath: string;
  setName: string;
  variantName: string;
};

export type UsdInvalidVariantSelectionError = {
  kind: "invalidVariantSelection";
  primPath: string;
  setName: string;
  variantName: string;
};

export type UsdTypedError = UsdInvalidVariantSelectionError;

const INVALID_VARIANT_SELECTION_PREFIX = "USD_INVALID_VARIANT_SELECTION\t";

function tauriErrorMessage(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return null;
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

/**
 * Round 1.5 (#32): per-purpose visibility. `default` is always
 * rendered. The remaining purposes default to render-on, proxy/guide
 * off, matching the pre-#32 `skipProxyGuidePurpose` filter.
 */
export type PurposeModes = {
  render: boolean;
  proxy: boolean;
  guide: boolean;
};

/**
 * Round 1.5: bundled options for the `extract_geometry` Tauri
 * command. Replaces the bare `policy` arg so #31 (variant) and #32
 * (purpose) can plug in without proliferating commands.
 */
export type ExtractGeometryOptions = {
  policy?: StageLoadPolicy;
  variantSelections?: VariantSelection[];
  purposeModes?: PurposeModes;
};

/**
 * #29 — detailed information about one layer in the subLayers hierarchy.
 * The C++ backend populates all fields; the Rust-fork backend provides
 * degraded entries (muted=false, timeOffset=0, timeScale=1, comment=null).
 */
export type LayerInfo = {
  /** Layer identifier (absolute file path or anonymous tag). */
  identifier: string;
  /** Nesting depth: root layer = 0, first sublayer level = 1, etc. */
  depth: number;
  /** `true` when the stage has muted this layer. */
  muted: boolean;
  /** `offset` from the SdfLayerOffset on the sublayer arc. 0 for root. */
  timeOffset: number;
  /** `scale` from the SdfLayerOffset on the sublayer arc. 1 for root. */
  timeScale: number;
  /** Authored `comment` on this layer, or `null`. */
  comment: string | null;
};

export type StageInspection = {
  path: string;
  defaultPrim: string | null;
  upAxis: string | null;
  metersPerUnit: number | null;
  /**
   * Stage-level time metadata authored on the root layer. Each
   * field is `null` when the metadatum is unauthored — the
   * inspector surfaces "(default)" in that case so users can tell
   * implicit defaults apart from authored values. Spec defaults:
   * `timeCodesPerSecond=24`, `framesPerSecond=24`,
   * `startTimeCode=0`, `endTimeCode=0`.
   */
  timeCodesPerSecond: number | null;
  framesPerSecond: number | null;
  startTimeCode: number | null;
  endTimeCode: number | null;
  /** `comment` metadata authored on the root layer. */
  comment: string | null;
  /** `true` when the root layer is binary USDC, `false` for text USDA. */
  rootLayerIsBinary: boolean;
  rootPrims: string[];
  composedLayers: string[];
  /**
   * #29 — subLayers hierarchy with per-layer muted/offset/comment info.
   * Falls back to an empty array for backends that don't populate it
   * (should not happen in practice — both backends populate this now).
   */
  layers?: LayerInfo[];
  references: CompositionArc[];
  payloads: CompositionArc[];
  /**
   * #30 — inherits arcs (always stage-internal, `assetPath` empty).
   * Populated by the C++ backend; empty array for the Rust-fork backend.
   */
  inherits?: CompositionArc[];
  /**
   * #30 — specializes arcs. Same shape as `inherits`.
   */
  specializes?: CompositionArc[];
  /**
   * #30 — variant selections that have an authored value. `assetPath`
   * is empty; `targetPrim` encodes the selection as
   * `"{setName}={variantName}"`.
   */
  variantSelectionArcs?: CompositionArc[];
  missingAssets: string[];
  variantSets: VariantSetInfo[];
  loadPolicy: StageLoadPolicy;
};

export type PrimTypeCount = {
  typeName: string;
  count: number;
};

export type StageSummary = {
  path: string;
  layerCount: number;
  rootPrimCount: number;
  meshCount: number;
  payloadCount: number;
  unloadedPayloadCount: number;
  hasVariants: boolean;
  /** Histogram of prim `typeName` → count, in first-seen order. */
  primTypeCounts: PrimTypeCount[];
  /** Sum of `points.length` across every authored Mesh prim. */
  totalVertices: number;
  /** Sum of post-fan-triangulation triangle counts across all Meshes. */
  totalTriangles: number;
  /** Total variant sets across every prim that authors at least one. */
  variantSetCount: number;
  /**
   * #38 — wall-clock playback duration in seconds, derived from
   * `(endTimeCode - startTimeCode) / framesPerSecond` when all three are
   * authored. `null` when any of the three is missing so callers can
   * distinguish "authored zero-length range" from "not authored".
   */
  durationSeconds: number | null;
  /** #38 — reference arcs that resolved successfully. */
  resolvedReferenceCount: number;
  /** #38 — reference arcs whose asset path could not be resolved. */
  unresolvedReferenceCount: number;
  /** #38 — payload arcs that resolved and were composed. */
  resolvedPayloadCount: number;
  /**
   * #38 — payload arcs whose asset path could not be resolved (Missing).
   * Distinct from `unloadedPayloadCount` which tracks arcs deliberately
   * skipped via the `noPayloads` policy.
   */
  unresolvedPayloadCount: number;
  warnings: string[];
  loadPolicy: StageLoadPolicy;
};

export type AssetIssueCode =
  | "broken-reference"
  | "missing-sub-layer"
  | "missing-payload"
  | "suspicious-meters-per-unit";

export type AssetIssueLevel = "warning" | "error";

export type AssetIssue = {
  code: AssetIssueCode;
  level: AssetIssueLevel;
  message: string;
  detail: string | null;
  contextPath: string | null;
};

/** #28 — one attribute on a prim. */
export type AttributeInfo = {
  name: string;
  typeName: string;
  valueSummary: string;
  variability: string;
  custom: boolean;
  timeSampleCount: number;
};

/** #28 — one relationship on a prim. */
export type RelationshipInfo = {
  name: string;
  targets: string[];
};

/** #28 — one metadata entry on a prim. */
export type MetadataEntry = {
  key: string;
  valueSummary: string;
};

/** #28 — per-prim inspection result. */
export type PrimInspection = {
  primPath: string;
  attributes: AttributeInfo[];
  relationships: RelationshipInfo[];
  metadata: MetadataEntry[];
};

/**
 * #35 — Shaping cone parameters on a UsdLux light prim that applies
 * `UsdLuxShapingAPI`.
 */
export type ShapingCone = {
  /** `shaping:cone:angle` in degrees. */
  angle: number;
  /** `shaping:cone:softness` in [0, 1]. */
  softness: number;
};

/**
 * #35 — Detailed information about one UsdLux light prim, returned by
 * `inspectUsdLights`.
 *
 * The C++ backend populates every field. The Rust-fork backend returns an
 * error so callers should ignore failures gracefully.
 */
export type UsdLightInfo = {
  /** SdfPath of the light prim (e.g. `"/World/Sun"`). */
  primPath: string;
  /**
   * USD `typeName` token: `"DistantLight"`, `"SphereLight"`, `"RectLight"`,
   * `"DiskLight"`, `"DomeLight"`, `"CylinderLight"`, etc.
   */
  lightKind: string;
  /** `inputs:color` as linearized RGB floats. Default is `[1, 1, 1]`. */
  color: [number, number, number];
  /** `inputs:intensity`. Default 1.0. */
  intensity: number;
  /** `inputs:exposure` in stops. Default 0.0. */
  exposure: number;
  /**
   * Color temperature in Kelvin when `enableColorTemperature` is true and
   * `colorTemperature` is authored. `null` when disabled or missing.
   */
  colorTemperature: number | null;
  /** `inputs:specular` multiplier. Default 1.0. */
  specular: number;
  /** `inputs:diffuse` multiplier. Default 1.0. */
  diffuse: number;
  /**
   * `inputs:texture:file` asset path for `DomeLight` prims.
   * `null` for all other light types or when unauthored.
   */
  domeTextureFile: string | null;
  /**
   * Cone shaping parameters when `UsdLuxShapingAPI` is applied.
   * `null` for lights without explicit cone shaping.
   */
  shapingCone: ShapingCone | null;
};

/** #37 — one time sample on an attribute. */
export type TimeSampleEntry = {
  /** USD time code (double precision). */
  time: number;
  /**
   * Human-readable value at this time code. Scalar types are
   * stringified; arrays are reported as "[N elements]".
   */
  valueSummary: string;
};

/**
 * #37 — result of `inspectAttributeTimeSamples`. Up to `maxSamples`
 * samples are returned together with optional numeric statistics
 * (available only for scalar-float attributes). `totalCount` is the
 * actual authored count before any truncation.
 */
export type AttributeTimeSamples = {
  primPath: string;
  attributeName: string;
  /** Up to `maxSamples` samples in ascending time-code order. */
  samples: TimeSampleEntry[];
  /** Full authored sample count before truncation. */
  totalCount: number;
  /** Minimum scalar value across the returned samples, or `null`. */
  numericMin: number | null;
  /** Maximum scalar value across the returned samples, or `null`. */
  numericMax: number | null;
  /** Arithmetic mean of the returned samples, or `null`. */
  numericMean: number | null;
};

/**
 * #35 — enumerates all UsdLux light prims in the stage at `path` and
 * returns their detailed attributes (intensity, color, exposure, color
 * temperature, specular / diffuse multipliers, dome texture, shaping cone).
 *
 * Only available on the C++ backend. The Rust-fork backend returns an error
 * that this wrapper re-throws. Callers should catch the error and fall back
 * to the Three.js-derived `LightEntry` list gracefully.
 */
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
export async function requiresGlbPreview(path: string) {
  return invoke<boolean>("requires_glb_preview", { path });
}

/**
 * #39 — initial: pull the USDA text for `path` directly from disk so
 * the inspector can show the authored source. Resolves to:
 *
 *   - `{ kind: "text", source: "..." }` for `.usda`, `.usd` whose root
 *     is text USDA, or `.usdz` whose first archive entry is a USDA
 *     layer.
 *   - `{ kind: "binary" }` for `.usdc`, `.usd` with a USDC root, or
 *     `.usdz` whose first entry is binary. The Rust backend will need
 *     a real `flatten_stage` API before these can be surfaced — issue
 *     #39 captures that follow-up.
 *
 * Note that this is **not** a true `usdcat --flatten`. References,
 * payloads, and sublayers are NOT composed in; the user only sees the
 * authored root layer. We name the helper `loadUsdSource` rather than
 * `flattenUsd` to keep the distinction honest until the fork API
 * lands.
 */
export type UsdSourcePayload =
  | { kind: "text"; source: string }
  | { kind: "binary" };

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
  const bytes = await readBinaryFile(path);
  // `read_binary_file` ships the payload as a JSON number array; copy
  // into a typed buffer once so the fflate USDZ path receives the
  // same shape it gets through the regular load pipeline.
  const buffer = Uint8Array.from(bytes).buffer;
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

// ---------------------------------------------------------------------------
// #44 — Stateful per-prim payload session API
// ---------------------------------------------------------------------------

/**
 * Opaque session handle returned by `openStageSession`. Pass it to
 * `loadPayload`, `unloadPayload`, `extractGeometrySession`, and
 * `closeStageSession`.
 */
export type StageSessionHandle = number;

/**
 * Opens a USD stage and keeps it alive in the Tauri process for the
 * duration of the session. Returns an opaque `StageSessionHandle` integer.
 *
 * The stage is opened with the given `policy`. When `policy` is
 * `"noPayloads"` every payload is deferred; individual prims can then be
 * loaded on demand with `loadPayload`.
 *
 * Call `closeStageSession` when you are done to free the backing stage.
 *
 * Note: per-prim load/unload is only supported when the C++ backend is
 * active (`backend-openusd-cpp` Cargo feature). The Rust-fork backend
 * accepts the call but returns an error from `loadPayload`/`unloadPayload`.
 */
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
