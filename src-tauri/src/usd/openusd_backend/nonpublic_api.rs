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
