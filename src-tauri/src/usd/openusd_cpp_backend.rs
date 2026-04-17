//! `UsdBackend` implementation backed by Pixar OpenUSD via the
//! handwritten `usd_c_shim` C ABI.
//!
//! Scope (PoC, Inspector-only):
//!   - `inspect_stage`, `summarize_stage`, `collect_asset_issues`,
//!     `root_layer_is_binary` are implemented against the shim.
//!   - `requires_glb_preview` returns `false` for every file. Until the
//!     C++ backend grows a GLB extraction pipeline, the frontend will
//!     use the Three.js `USDLoader.parse` path for every USD file when
//!     this backend is active. USDC binary files will surface as
//!     explicit errors via the existing loader error path, matching
//!     the pre-Phase-3 behavior.
//!   - `extract_geometry_glb` returns `UsdError::Parse(...)`. The
//!     geometry / material / skel pipeline is explicitly deferred to a
//!     later phase of the C++ backend.
//!
//! This backend is only compiled when the `backend-openusd-cpp` Cargo
//! feature is enabled. `lib.rs` picks between `OpenusdBackend` (pure
//! Rust fork, default) and `OpenusdCppBackend` (this file) via the
//! `DefaultBackend` type alias in `super::mod`.

use std::collections::HashSet;
use std::path::Path as StdPath;

use super::backend::{UsdBackend, UsdError};
use super::cpp_sys::{CStage, LoadPolicy};
use super::types::{
    AssetIssue, AssetIssueCode, AssetIssueLevel, CompositionArc, CompositionArcState,
    StageInspection, StageLoadPolicy, StageSummary, VariantSetInfo,
};

/// Real backend backed by Pixar OpenUSD via the C shim.
pub struct OpenusdCppBackend;

impl OpenusdCppBackend {
    pub fn new() -> Self {
        Self
    }

    fn open(path: &StdPath, policy: StageLoadPolicy) -> Result<CStage, UsdError> {
        CStage::open(path, to_cpp_policy(policy)).map_err(|e| UsdError::Parse(e.0))
    }
}

impl Default for OpenusdCppBackend {
    fn default() -> Self {
        Self::new()
    }
}

fn to_cpp_policy(policy: StageLoadPolicy) -> LoadPolicy {
    match policy {
        StageLoadPolicy::LoadAll => LoadPolicy::All,
        StageLoadPolicy::NoPayloads => LoadPolicy::NoPayloads,
    }
}

/// Matches the Rust-backend `reference_arc_state` rule: an authored
/// arc is `Missing` iff its asset_path literal appears in the set of
/// unresolved assets the shim reported for the stage.
fn classify_reference(
    unresolved: &HashSet<&str>,
    asset_path: &str,
) -> CompositionArcState {
    if unresolved.contains(asset_path) {
        CompositionArcState::Missing
    } else {
        CompositionArcState::Loaded
    }
}

/// Payload classification has three states. Missing trumps Unloaded
/// so a broken payload never reads as "deferred on purpose". Keyed on
/// (asset_path, source_prim) so multiple payloads pointing at the same
/// asset from different prims are classified independently.
fn classify_payload(
    unresolved: &HashSet<&str>,
    skipped_assets: &HashSet<&str>,
    asset_path: &str,
    policy: StageLoadPolicy,
) -> CompositionArcState {
    if unresolved.contains(asset_path) {
        return CompositionArcState::Missing;
    }
    // The C shim currently reports skipped payloads as a flat asset-
    // path list (no source-prim breakdown). When NoPayloads is active,
    // treat every asset in that list as Unloaded; LoadAll never emits
    // skipped entries.
    if policy == StageLoadPolicy::NoPayloads && skipped_assets.contains(asset_path) {
        return CompositionArcState::Unloaded;
    }
    CompositionArcState::Loaded
}

impl UsdBackend for OpenusdCppBackend {
    fn inspect_stage(
        &self,
        path: &StdPath,
        policy: StageLoadPolicy,
    ) -> Result<StageInspection, UsdError> {
        let stage = Self::open(path, policy)?;

        let default_prim = stage.default_prim();
        let up_axis = stage.up_axis().map(|axis| match axis {
            super::cpp_sys::UpAxis::Y => "Y".to_string(),
            super::cpp_sys::UpAxis::Z => "Z".to_string(),
        });
        let meters_per_unit = stage.meters_per_unit();

        // The shim has no first-class "root prims" enumerator — prims
        // under the pseudo-root are emitted by traverse() as paths of
        // depth 1 (e.g. `/Foo`). Filter the traverse result to match
        // the Rust fork's behavior.
        let all_prims = stage.traverse();
        let root_prims: Vec<String> = all_prims
            .iter()
            .filter(|p| is_root_prim_path(p))
            .map(|p| p.trim_start_matches('/').to_string())
            .collect();

        // Layer identifiers: first entry is the root layer, everything
        // after are composed dependencies. The inspector UI only shows
        // the composed set (sublayers, refs, payloads), so skip [0].
        let mut layer_ids = stage.layer_identifiers();
        if !layer_ids.is_empty() {
            layer_ids.remove(0);
        }
        let composed_layers = layer_ids;

        let missing_assets = stage.unresolved_assets();
        let unresolved_set: HashSet<&str> =
            missing_assets.iter().map(String::as_str).collect();

        let skipped_assets_owned = stage.skipped_payloads();
        let skipped_set: HashSet<&str> =
            skipped_assets_owned.iter().map(String::as_str).collect();

        let mut references = Vec::<CompositionArc>::new();
        let mut payloads = Vec::<CompositionArc>::new();
        let mut variant_sets = Vec::<VariantSetInfo>::new();

        for prim_path in &all_prims {
            if stage.prim_has_variants(prim_path) {
                for set_name in stage.variant_set_names(prim_path) {
                    let selection = stage.variant_selection(prim_path, &set_name);
                    variant_sets.push(VariantSetInfo {
                        prim_path: prim_path.clone(),
                        set_name,
                        selection,
                    });
                }
            }

            for r in stage.references_in(prim_path) {
                let state = classify_reference(&unresolved_set, &r.asset_path);
                references.push(CompositionArc {
                    source_prim: r.source_prim,
                    asset_path: r.asset_path,
                    target_prim: r.target_prim.unwrap_or_default(),
                    state,
                });
            }
            for p in stage.payloads_in(prim_path) {
                let state =
                    classify_payload(&unresolved_set, &skipped_set, &p.asset_path, policy);
                payloads.push(CompositionArc {
                    source_prim: p.source_prim,
                    asset_path: p.asset_path,
                    target_prim: p.target_prim.unwrap_or_default(),
                    state,
                });
            }
        }

        Ok(StageInspection {
            path: path.display().to_string(),
            default_prim,
            up_axis,
            meters_per_unit,
            root_prims,
            composed_layers,
            references,
            payloads,
            missing_assets,
            variant_sets,
            load_policy: policy,
        })
    }

    fn summarize_stage(
        &self,
        path: &StdPath,
        policy: StageLoadPolicy,
    ) -> Result<StageSummary, UsdError> {
        let stage = Self::open(path, policy)?;

        let layer_count = stage.layer_count();

        let all_prims = stage.traverse();
        let root_prim_count = all_prims.iter().filter(|p| is_root_prim_path(p)).count();

        let mut mesh_count = 0usize;
        let mut payload_count = 0usize;
        let mut has_variants = false;

        for prim_path in &all_prims {
            if stage.prim_type_is_mesh(prim_path) {
                mesh_count += 1;
            }
            let payloads = stage.payloads_in(prim_path);
            if !payloads.is_empty() {
                payload_count += payloads.len();
            }
            if stage.prim_has_variants(prim_path) {
                has_variants = true;
            }
        }

        let warnings: Vec<String> = stage
            .unresolved_assets()
            .into_iter()
            .map(|a| format!("unresolved asset: {a}"))
            .collect();

        Ok(StageSummary {
            path: path.display().to_string(),
            layer_count,
            root_prim_count,
            mesh_count,
            payload_count,
            unloaded_payload_count: stage.skipped_payloads().len(),
            has_variants,
            warnings,
            load_policy: policy,
        })
    }

    fn collect_asset_issues(&self, path: &StdPath) -> Result<Vec<AssetIssue>, UsdError> {
        // Asset issues always inspect the fully-loaded stage.
        let stage = Self::open(path, StageLoadPolicy::LoadAll)?;
        let mut issues = Vec::new();

        if let Some(mpu) = stage.meters_per_unit() {
            if mpu <= 0.0 || mpu > 100.0 {
                issues.push(AssetIssue {
                    code: AssetIssueCode::SuspiciousMetersPerUnit,
                    level: AssetIssueLevel::Warning,
                    message: format!("metersPerUnit = {mpu} is outside the typical range."),
                    detail: None,
                    context_path: None,
                });
            }
        }

        let unresolved_owned = stage.unresolved_assets();
        let unresolved_set: HashSet<&str> =
            unresolved_owned.iter().map(String::as_str).collect();

        // Walk arcs and emit one contextualized issue per missing
        // reference / payload, tracking which asset paths we've
        // already attributed so the generic fallback below doesn't
        // double-report them.
        let mut covered = HashSet::<String>::new();

        for prim_path in stage.traverse() {
            for r in stage.references_in(&prim_path) {
                if unresolved_set.contains(r.asset_path.as_str()) {
                    covered.insert(r.asset_path.clone());
                    issues.push(AssetIssue {
                        code: AssetIssueCode::BrokenReference,
                        level: AssetIssueLevel::Error,
                        message: format!("Broken reference: {}", r.asset_path),
                        detail: None,
                        context_path: Some(r.source_prim),
                    });
                }
            }
            for p in stage.payloads_in(&prim_path) {
                if unresolved_set.contains(p.asset_path.as_str()) {
                    covered.insert(p.asset_path.clone());
                    issues.push(AssetIssue {
                        code: AssetIssueCode::MissingPayload,
                        level: AssetIssueLevel::Error,
                        message: format!("Missing payload: {}", p.asset_path),
                        detail: None,
                        context_path: Some(p.source_prim),
                    });
                }
            }
        }

        // Fallback for unresolved assets we couldn't attribute to any
        // specific arc (e.g. sublayers, which the shim doesn't expose
        // as arc-shaped data yet).
        for missing in &unresolved_owned {
            if !covered.contains(missing.as_str()) {
                issues.push(AssetIssue {
                    code: AssetIssueCode::MissingSubLayer,
                    level: AssetIssueLevel::Error,
                    message: format!("Unresolved asset: {missing}"),
                    detail: None,
                    context_path: None,
                });
            }
        }

        Ok(issues)
    }

    fn root_layer_is_binary(&self, path: &StdPath) -> Result<bool, UsdError> {
        let stage = Self::open(path, StageLoadPolicy::LoadAll)?;
        Ok(stage.root_layer_is_binary().unwrap_or(false))
    }

    fn requires_glb_preview(&self, _path: &StdPath) -> Result<bool, UsdError> {
        // PoC scope: the C++ backend does not yet own the GLB
        // extraction pipeline. Returning false keeps every USD file on
        // the Three.js USDLoader path; USDC roots will fail there with
        // the existing "cannot parse binary USDC" error rather than
        // producing silent empty scenes. Revisit when the geometry
        // pipeline lands on this backend.
        Ok(false)
    }

    fn extract_geometry_glb(
        &self,
        _path: &StdPath,
        _policy: StageLoadPolicy,
    ) -> Result<Vec<u8>, UsdError> {
        Err(UsdError::Parse(
            "geometry pipeline is not implemented for the C++ backend (PoC covers \
             inspector surface only)"
                .to_string(),
        ))
    }
}

/// A root-level prim has exactly one `/` and no further separator. We
/// use an explicit character count instead of `split('/').count()` to
/// avoid allocating iterators on the hot traverse loop.
fn is_root_prim_path(p: &str) -> bool {
    let mut saw_leading_slash = false;
    for ch in p.chars() {
        if ch == '/' {
            if saw_leading_slash {
                return false;
            }
            saw_leading_slash = true;
        }
    }
    // Must have a leading '/' and at least one character after it.
    saw_leading_slash && p.len() > 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_root_prim_path_rules() {
        assert!(is_root_prim_path("/Root"));
        assert!(is_root_prim_path("/Foo"));
        assert!(!is_root_prim_path("/Foo/Bar"));
        assert!(!is_root_prim_path("/"));
        assert!(!is_root_prim_path(""));
        assert!(!is_root_prim_path("NoLeadingSlash"));
    }
}
