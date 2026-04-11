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

/// Heavyweight stage detail. Returned by `inspect_stage`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageInspection {
    pub path: String,
    pub default_prim: Option<String>,
    pub up_axis: Option<String>,
    pub meters_per_unit: Option<f64>,
    pub root_prims: Vec<String>,
    pub composed_layers: Vec<String>,
    pub references: Vec<CompositionArc>,
    pub payloads: Vec<CompositionArc>,
    pub missing_assets: Vec<String>,
    /// Phase 4: which load policy was used to build the inspected stage.
    /// Reflected back to the frontend so UI controls can render their
    /// current state from a single source of truth.
    pub load_policy: StageLoadPolicy,
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
