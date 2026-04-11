import { invoke } from "@tauri-apps/api/core";

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

export type CompositionArc = {
  sourcePrim: string;
  assetPath: string;
  targetPrim: string;
  state: CompositionArcState;
};

export type StageInspection = {
  path: string;
  defaultPrim: string | null;
  upAxis: string | null;
  metersPerUnit: number | null;
  rootPrims: string[];
  composedLayers: string[];
  references: CompositionArc[];
  payloads: CompositionArc[];
  missingAssets: string[];
  loadPolicy: StageLoadPolicy;
};

export type StageSummary = {
  path: string;
  layerCount: number;
  rootPrimCount: number;
  meshCount: number;
  payloadCount: number;
  unloadedPayloadCount: number;
  hasVariants: boolean;
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
export async function extractGeometry(path: string, policy?: StageLoadPolicy) {
  return invoke<ArrayBuffer>("extract_geometry", { path, policy });
}
