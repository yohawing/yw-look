//! Wire-level types returned by USD inspection commands.
//!
//! These types live on the boundary between the Rust backend and the
//! frontend, so they implement `Serialize`. They are intentionally
//! independent of any specific USD parser crate so the frontend contract
//! does not change when the backend implementation is swapped.

use serde::{Deserialize, Serialize};

/// Phase 4 wire equivalent of `openusd::StageLoadPolicy`. Carried into
/// the backend via Tauri command parameters so the frontend can toggle
/// between "compose every payload" and "defer every payload" without
/// the Rust side needing to understand the crate-level enum.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StageLoadPolicy {
    /// Compose references and payloads (pre-Phase-4 behavior).
    #[default]
    LoadAll,
    /// Compose references but skip payloads. Authored payload metadata
    /// remains queryable for inspector display; the target layers are
    /// never fetched and do not contribute to the composed stage.
    NoPayloads,
}

/// One variant set found on a prim during stage inspection.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantSetInfo {
    /// Prim path where this variant set is authored.
    pub prim_path: String,
    /// Name of the variant set (e.g. `"modelingVariant"`).
    pub set_name: String,
    /// Authored variant selection on this prim, or `None` when the
    /// prim does not explicitly author a selection (the first variant
    /// becomes the implicit default).
    pub selection: Option<String>,
    /// Available variant names in this set. Empty when the backend
    /// cannot enumerate them (e.g. the openusd Rust fork — only the
    /// C++ shim populates this for now). The frontend uses this to
    /// drive a switcher pulldown; an empty list disables the control.
    #[serde(default)]
    pub variants: Vec<String>,
}

/// One variant selection override carried into `extract_geometry_glb`
/// so the frontend can switch a variant set without a full re-open
/// from the user's perspective. Stateless: every extract call applies
/// the full set of selections from scratch on a fresh stage.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantSelection {
    /// Prim path that owns the variant set (`/World/Hero`).
    pub prim_path: String,
    /// Variant set name (`"modelingVariant"`).
    pub set_name: String,
    /// Variant to select within the set (`"red"`).
    pub variant_name: String,
}

/// Per-purpose visibility filter applied when building the GLB. The
/// `default` purpose is always rendered (USD spec). The remaining
/// purposes are toggled independently — when `false`, prims authored
/// with that purpose are skipped during traversal so they never reach
/// the GLB output. Defaults: render on, proxy / guide off (matches the
/// pre-#32 `skip_proxy_guide_purpose` behaviour for backwards
/// compatibility).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurposeModes {
    pub render: bool,
    pub proxy: bool,
    pub guide: bool,
}

impl Default for PurposeModes {
    fn default() -> Self {
        Self {
            render: true,
            proxy: false,
            guide: false,
        }
    }
}

/// Bundled options for `extract_geometry_glb`. Replaces the bare
/// `policy` argument so #31 (variant selections) and #32 (purpose
/// toggle) can plug into the same extract call without proliferating
/// trait methods. Existing call sites construct this from a
/// `StageLoadPolicy` via `From` so the test suite keeps the terse
/// `extract_geometry_glb(&path, policy.into())` shape.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractGeometryOptions {
    /// Stage load policy. Defaults to `LoadAll` when callers send an
    /// options object without this key — matches the TS type's
    /// `policy?` shape so `extractGeometry(path, { variantSelections })`
    /// deserializes cleanly.
    #[serde(default)]
    pub policy: StageLoadPolicy,
    /// #31 variant selections to apply before geometry extraction.
    /// Empty by default — backend uses each prim's authored
    /// selection (or pcp's implicit-first-variant fallback).
    #[serde(default)]
    pub variant_selections: Vec<VariantSelection>,
    /// #32 per-purpose visibility filter. `Default::default()` matches
    /// the pre-#32 behaviour (render on, proxy / guide off).
    #[serde(default)]
    pub purpose_modes: PurposeModes,
}

impl From<StageLoadPolicy> for ExtractGeometryOptions {
    fn from(policy: StageLoadPolicy) -> Self {
        Self {
            policy,
            ..Default::default()
        }
    }
}

/// Heavyweight stage detail. Returned by `inspect_stage`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageInspection {
    pub path: String,
    pub default_prim: Option<String>,
    pub up_axis: Option<String>,
    pub meters_per_unit: Option<f64>,
    /// Stage-level time metadata. `time_codes_per_second` is the
    /// authoring frame-rate USD applies to time-sampled data; the
    /// remaining fields define the playback range and authoring
    /// frame-rate for tooling. Each is `None` when the stage's root
    /// layer does not author the metadatum (USD spec defaults
    /// kick in elsewhere — `timeCodesPerSecond` defaults to 24.0,
    /// `framesPerSecond` to 24.0, `startTimeCode`/`endTimeCode`
    /// to 0.0). The inspector surfaces the authored value, not the
    /// implicit default, so users can tell when a stage relies on
    /// the spec defaults.
    pub time_codes_per_second: Option<f64>,
    pub frames_per_second: Option<f64>,
    pub start_time_code: Option<f64>,
    pub end_time_code: Option<f64>,
    /// Stage-level `comment` metadata authored on the root layer.
    /// Free-form text; rendered as-is in the inspector.
    pub comment: Option<String>,
    /// `true` when the stage's root layer is binary USDC, `false`
    /// when it is text USDA. Used by the Metadata panel to show the
    /// layer format and by the GLB-preview decision elsewhere.
    pub root_layer_is_binary: bool,
    pub root_prims: Vec<String>,
    pub composed_layers: Vec<String>,
    pub references: Vec<CompositionArc>,
    pub payloads: Vec<CompositionArc>,
    pub missing_assets: Vec<String>,
    /// Variant sets found across all prims (read-only for now;
    /// interactive switching needs a fork API for session-layer
    /// variant selection override).
    pub variant_sets: Vec<VariantSetInfo>,
    /// Phase 4: which load policy was used to build the inspected stage.
    /// Reflected back to the frontend so UI controls can render their
    /// current state from a single source of truth.
    pub load_policy: StageLoadPolicy,
}

/// One entry in the prim-type histogram exposed by `StageSummary`.
/// Stored as a Vec so the wire payload preserves authored ordering
/// without forcing the frontend to sort. Frontend renders each entry
/// directly, so an ordered list of `(typeName, count)` pairs is the
/// most ergonomic shape on both sides.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrimTypeCount {
    /// USD `typeName` token authored on the prim (e.g. `"Mesh"`,
    /// `"Xform"`, `"Camera"`, `"DistantLight"`, `"GeomSubset"`).
    pub type_name: String,
    pub count: usize,
}

/// Lightweight stage header. Returned by `summarize_stage` for the
/// "show something instantly" UX path.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageSummary {
    pub path: String,
    pub layer_count: usize,
    pub root_prim_count: usize,
    pub mesh_count: usize,
    pub payload_count: usize,
    /// Phase 4: payload arcs that the `NoPayloads` policy skipped. In
    /// `LoadAll` mode this is always 0.
    pub unloaded_payload_count: usize,
    pub has_variants: bool,
    /// USD-view-style stage statistics (#38). Populated alongside the
    /// existing scalar counters during the summary traversal.
    /// `prim_type_counts` is a histogram keyed by USD `typeName`;
    /// `total_vertices` / `total_triangles` are the post-fan-
    /// triangulation totals across every authored Mesh prim, regardless
    /// of visibility / purpose (so unrendered helper geometry still
    /// contributes to the budget — matching how usdview's stats panel
    /// reports authored-data totals, not render budget).
    pub prim_type_counts: Vec<PrimTypeCount>,
    pub total_vertices: usize,
    pub total_triangles: usize,
    /// Total number of variant sets across every prim (each set is
    /// counted once per prim that authors it). Distinct from
    /// `has_variants` which is just the boolean.
    pub variant_set_count: usize,
    pub warnings: Vec<String>,
    /// Phase 4: the load policy used when summarizing.
    pub load_policy: StageLoadPolicy,
}

/// One issue surfaced by `collect_asset_issues`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetIssue {
    pub code: AssetIssueCode,
    pub level: AssetIssueLevel,
    pub message: String,
    pub detail: Option<String>,
    pub context_path: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssetIssueCode {
    BrokenReference,
    MissingSubLayer,
    MissingPayload,
    SuspiciousMetersPerUnit,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetIssueLevel {
    Warning,
    Error,
}

/// One composition arc (`reference` or `payload`) declared in a layer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompositionArc {
    pub source_prim: String,
    pub asset_path: String,
    pub target_prim: String,
    pub state: CompositionArcState,
}

/// Resolution state of a composition arc.
/// - `Loaded`: asset was successfully composed into the stage.
/// - `Missing`: resolver could not locate the asset (the arc appears in
///   `Stage::unresolved_assets`).
/// - `Unloaded`: Phase 4 — the arc is a payload that was deliberately
///   skipped because the stage was opened with
///   `StageLoadPolicy::NoPayloads`. The target is resolvable but has
///   not been composed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CompositionArcState {
    Loaded,
    Missing,
    Unloaded,
}
