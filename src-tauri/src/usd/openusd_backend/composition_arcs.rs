use std::collections::HashSet;

use crate::usd::types::CompositionArcState;

/// Classify a reference arc. References are always composed, so the
/// only two possible states are `Loaded` (asset resolves) and
/// `Missing` (appears in `unresolved_assets`). Shared by `inspect_stage`
/// and `collect_asset_issues` to keep the exact-string match rule in
/// one place.
pub(crate) fn reference_arc_state(
    unresolved: &HashSet<&str>,
    asset_path: &str,
) -> CompositionArcState {
    if unresolved.contains(asset_path) {
        CompositionArcState::Missing
    } else {
        CompositionArcState::Loaded
    }
}

/// Classify a payload arc. Unlike references, payloads have three
/// states: `Missing` (unresolved), `Unloaded` (deliberately skipped by
/// `StageLoadPolicy::NoPayloads`), and `Loaded` (composed). We check
/// `Missing` first because a payload that cannot be resolved at all
/// trumps any deferred-load intent.
///
/// The skip set is keyed on `(asset_path, source_prim)`; the prim
/// that authored the payload, because `Stage::skipped_payloads`
/// records the declaring prim, not the payload's target. A layer can
/// host multiple payload arcs pointing at the same asset from
/// different prims and each must map to its own `Unloaded` result.
pub(crate) fn payload_arc_state(
    unresolved: &HashSet<&str>,
    skipped: &HashSet<(String, String)>,
    asset_path: &str,
    source_prim: &str,
) -> CompositionArcState {
    if unresolved.contains(asset_path) {
        return CompositionArcState::Missing;
    }
    if skipped.contains(&(asset_path.to_string(), source_prim.to_string())) {
        return CompositionArcState::Unloaded;
    }
    CompositionArcState::Loaded
}
