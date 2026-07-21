//! Isolated boundary for the small part of yw-look's stage-query surface
//! ([`super::stage_query`]) that has no public upstream (mxpv/openusd)
//! equivalent yet:
//!
//! - [`authored_references_at`] / [`authored_payloads_at`] read the raw
//!   `References` / `Payload` fields directly via `Stage::field`. There
//!   is no public *composed* reference/payload-list accessor: the
//!   composer that would provide one
//!   (`pcp::compose_site::compose_references_in` /
//!   `collect_payloads_in`) is currently private to the prim-index
//!   builder, so this only exposes the strongest authored field for
//!   composition arcs (same limitation the fork's pre-0.5 compatibility
//!   layer carried).
//! - [`resolve_asset`] wraps `Stage::asset_resolves`, a fork-only probe
//!   method with no upstream counterpart.
//!
//! Everything in this file is expected to go away once upstream grows
//! the corresponding public API (tracked as USD-NATIVE-01 Phase 3); keep
//! new call sites out of here unless they hit the same gap.

use openusd::sdf::{self, schema::FieldKey, Value};
use openusd::Stage;

pub(super) fn authored_references_at(stage: &Stage, path: sdf::Path) -> Vec<sdf::Reference> {
    // TODO(openusd-v050-compat): use the same composed reference-list path as
    // `pcp::compose_site::compose_references_in`. That composer currently hangs
    // off the private prim-index builder, so this PoC compatibility surface can
    // only expose the strongest authored field for composition arcs.
    match stage.field::<Value>(path, FieldKey::References) {
        Ok(Some(Value::ReferenceListOp(op))) => op.iter().cloned().collect(),
        _ => Vec::new(),
    }
}

pub(super) fn authored_payloads_at(stage: &Stage, path: sdf::Path) -> Vec<sdf::Payload> {
    // TODO(openusd-v050-compat): replace with composed payload-list extraction
    // via `pcp::compose_site::collect_payloads_in` once Stage exposes a stable
    // direct-arc query. This fallback intentionally stays isolated so callers do
    // not accidentally treat it as a general composed API.
    match stage.field::<Value>(path, FieldKey::Payload) {
        Ok(Some(Value::Payload(payload))) => vec![payload],
        Ok(Some(Value::PayloadListOp(op))) => op.iter().cloned().collect(),
        _ => Vec::new(),
    }
}

pub(super) fn resolve_asset(stage: &Stage, asset_path: &str) -> bool {
    stage.asset_resolves(asset_path)
}

// --- Phase 2b: FieldKey-unit helpers for the remaining raw `Stage::field`
// call sites that have no upstream public equivalent with matching
// semantics. Each function below wraps exactly one `FieldKey`; the calling
// logic (coercion, iteration, fallbacks) stays in the original module.

/// Raw `typeName` value (untyped `sdf::Value`), tolerating a
/// non-conformant `String`-typed authoring in addition to the spec's
/// `Token`. `Prim::type_name()` only recognises the `Token` variant
/// (`Value::try_as_token`), so it cannot serve
/// `stage_fields::read_token_or_string_field`'s deliberately lenient
/// reader.
pub(super) fn prim_type_name_field(stage: &Stage, path: sdf::Path) -> anyhow::Result<Option<Value>> {
    stage.field::<Value>(path, FieldKey::TypeName)
}

/// Raw `targetPaths` list-op value for a relationship. `Stage::field`
/// resolves the strongest opinionated layer only (see
/// `PrimIndex::resolve_field`'s "strongest-opinion-wins" doc); the public
/// `Relationship::targets()` instead folds list-op edits (prepend / append
/// / delete) across every contributing layer via
/// `IndexCache::relationship_targets`. Callers here need the raw
/// (unfolded) list op itself — e.g. to enumerate its items in authored
/// order alongside a parallel array — so they cannot switch to the
/// composed accessor without a behavior change.
pub(super) fn relationship_target_paths_field(
    stage: &Stage,
    path: sdf::Path,
) -> anyhow::Result<Option<Value>> {
    stage.field::<Value>(path, FieldKey::TargetPaths)
}

/// Raw `connectionPaths` list-op value for an attribute. Same
/// strongest-only-vs-composed gap as
/// [`relationship_target_paths_field`]: `Attribute::connections()` folds
/// connection edits across every contributing layer
/// (`IndexCache::connection_paths`), while these call sites want the raw
/// list op to pick e.g. its first authored entry without composition.
pub(super) fn attribute_connection_paths_field(
    stage: &Stage,
    path: sdf::Path,
) -> anyhow::Result<Option<Value>> {
    stage.field::<Value>(path, FieldKey::ConnectionPaths)
}

/// Raw `variantSetNames` list-op / token-vec value on a prim. Upstream
/// exposes composed variant *selections* via `Prim::variant_sets()` /
/// `VariantSets::get_all_variant_selections()`, but not the authored
/// variant-*set-name* list itself, which the inspector UI needs to know
/// which sets exist even before/without a selection.
pub(super) fn variant_set_names_field(stage: &Stage, path: sdf::Path) -> anyhow::Result<Option<Value>> {
    stage.field::<Value>(path, FieldKey::VariantSetNames)
}

/// Raw `variantSelection` dictionary value on a prim (as authored,
/// keyed by set name). `VariantSets::get_all_variant_selections()`
/// returns the *effective* selections after composition, not this raw
/// per-prim dictionary field, which the inspector UI displays alongside
/// the raw set-name list above.
pub(super) fn variant_selection_field(stage: &Stage, path: sdf::Path) -> anyhow::Result<Option<Value>> {
    stage.field::<Value>(path, FieldKey::VariantSelection)
}

/// Raw single-prim `active` field (no ancestor walk). `Prim::is_active()`
/// composes this across the whole ancestor chain internally
/// (`Prim::all_ancestors`), which is the right call when checking one
/// prim in isolation, but yw-look's mesh-visibility walk already performs
/// its own ancestor loop (interleaved with `visibility` / `purpose`
/// checks in the same pass) and would redo the walk quadratically per
/// ancestor if it called `is_active()` at each step instead of reading
/// this single field.
pub(super) fn prim_active_field(stage: &Stage, path: sdf::Path) -> anyhow::Result<Option<bool>> {
    stage.field::<bool>(path, FieldKey::Active)
}
