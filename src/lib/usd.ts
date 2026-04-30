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
 * The Rust backend opens the stage once and inspects `layer_count`, so
 * this is cheap enough to call eagerly during the load pipeline.
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
