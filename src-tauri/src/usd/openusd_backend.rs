//! Concrete `UsdBackend` implementation backed by the `openusd` crate
//! (yohawing fork of `mxpv/openusd`, branch `yw-look-phase1`).
//!
//! This adapter is intentionally thin: it converts paths, calls the
//! parser, and maps the result into `yw-look`'s wire types in
//! [`super::types`]. Anything richer (heuristics, scoring, UI sorting)
//! belongs in the frontend or a higher layer.

use std::cell::RefCell;
use std::path::Path as StdPath;

use openusd::ar::DefaultResolver;
use openusd::sdf::schema::FieldKey;
use openusd::sdf::Value as SdfValue;
use openusd::stage::UpAxis;
use openusd::Stage;

use super::backend::{UsdBackend, UsdError};
use super::types::{
    AssetIssue, AssetIssueCode, AssetIssueLevel, CompositionArc, StageInspection, StageSummary,
};

/// Real backend backed by `openusd`.
pub struct OpenusdBackend;

impl OpenusdBackend {
    pub fn new() -> Self {
        Self
    }

    fn open(path: &StdPath) -> Result<Stage, UsdError> {
        let path_str = path
            .to_str()
            .ok_or_else(|| UsdError::Io(format!("non-UTF8 path: {}", path.display())))?;
        Stage::open(&DefaultResolver::new(), path_str)
            .map_err(|e| UsdError::Parse(e.to_string()))
    }
}

impl Default for OpenusdBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl UsdBackend for OpenusdBackend {
    fn inspect_stage(&self, path: &StdPath) -> Result<StageInspection, UsdError> {
        let stage = Self::open(path)?;

        let default_prim = stage.default_prim();
        let up_axis = stage.up_axis().map(|axis| match axis {
            UpAxis::Y => "Y".to_string(),
            UpAxis::Z => "Z".to_string(),
        });
        let meters_per_unit = stage.meters_per_unit();

        let root_prims = stage
            .root_prims()
            .map_err(|e| UsdError::Parse(e.to_string()))?;

        // We expose every collected layer identifier as a "sub layer" for
        // now. The fork does not yet distinguish authored sublayer specs
        // from references / payloads in this accessor; the frontend treats
        // this list as "all layers in the composed stage".
        let sub_layers: Vec<String> = stage
            .layer_identifiers()
            .iter()
            .skip(1) // index 0 is the root layer itself
            .cloned()
            .collect();

        let references = RefCell::new(Vec::new());
        let payloads = RefCell::new(Vec::new());

        stage
            .traverse(|prim_path| {
                let source = prim_path.to_string();
                for r in stage.references_in(prim_path.clone()) {
                    references.borrow_mut().push(CompositionArc {
                        source_prim: source.clone(),
                        asset_path: r.asset_path,
                        target_prim: Some(r.prim_path.to_string()),
                    });
                }
                for p in stage.payloads_in(prim_path.clone()) {
                    payloads.borrow_mut().push(CompositionArc {
                        source_prim: source.clone(),
                        asset_path: p.asset_path,
                        target_prim: Some(p.prim_path.to_string()),
                    });
                }
            })
            .map_err(|e| UsdError::Parse(e.to_string()))?;

        let missing_assets = stage.unresolved_assets().to_vec();

        Ok(StageInspection {
            path: path.display().to_string(),
            default_prim,
            up_axis,
            meters_per_unit,
            root_prims,
            sub_layers,
            references: references.into_inner(),
            payloads: payloads.into_inner(),
            missing_assets,
        })
    }

    fn summarize_stage(&self, path: &StdPath) -> Result<StageSummary, UsdError> {
        let stage = Self::open(path)?;

        let layer_count = stage.layer_count();
        let root_prim_count = stage
            .root_prims()
            .map_err(|e| UsdError::Parse(e.to_string()))?
            .len();

        let mesh_count = RefCell::new(0usize);
        let payload_count = RefCell::new(0usize);
        let has_variants = RefCell::new(false);

        stage
            .traverse(|prim_path| {
                if let Ok(Some(type_name)) =
                    stage.field::<String>(prim_path.clone(), FieldKey::TypeName)
                {
                    if type_name == "Mesh" {
                        *mesh_count.borrow_mut() += 1;
                    }
                }
                let payloads = stage.payloads_in(prim_path.clone());
                if !payloads.is_empty() {
                    *payload_count.borrow_mut() += payloads.len();
                }
                // VariantSetNames may be authored as several different
                // value types depending on the layer; we only care that
                // *something* is authored, so query as raw Value.
                if let Ok(Some(_)) =
                    stage.field::<SdfValue>(prim_path.clone(), FieldKey::VariantSetNames)
                {
                    *has_variants.borrow_mut() = true;
                }
            })
            .map_err(|e| UsdError::Parse(e.to_string()))?;

        let warnings: Vec<String> = stage
            .unresolved_assets()
            .iter()
            .map(|a| format!("unresolved asset: {a}"))
            .collect();

        Ok(StageSummary {
            path: path.display().to_string(),
            layer_count,
            root_prim_count,
            mesh_count: mesh_count.into_inner(),
            payload_count: payload_count.into_inner(),
            has_variants: has_variants.into_inner(),
            warnings,
        })
    }

    fn collect_asset_issues(&self, path: &StdPath) -> Result<Vec<AssetIssue>, UsdError> {
        let stage = Self::open(path)?;
        let mut issues = Vec::new();

        for missing in stage.unresolved_assets() {
            issues.push(AssetIssue {
                code: AssetIssueCode::BrokenReference,
                level: AssetIssueLevel::Error,
                message: format!("Unresolved asset: {missing}"),
                detail: None,
                context_path: None,
            });
        }

        if let Some(UpAxis::Z) = stage.up_axis() {
            issues.push(AssetIssue {
                code: AssetIssueCode::ZUpAxis,
                level: AssetIssueLevel::Warning,
                message: "Stage uses Z-up axis; verify viewer orientation.".to_string(),
                detail: None,
                context_path: None,
            });
        }

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

        // Walk references / payloads and flag any whose asset path is in
        // the unresolved set so that the frontend can show *which* prim
        // owns the broken arc.
        let unresolved: std::collections::HashSet<&str> = stage
            .unresolved_assets()
            .iter()
            .map(|s| s.as_str())
            .collect();

        let collected: RefCell<Vec<AssetIssue>> = RefCell::new(Vec::new());
        stage
            .traverse(|prim_path| {
                let source = prim_path.to_string();
                for r in stage.references_in(prim_path.clone()) {
                    if unresolved.contains(r.asset_path.as_str()) {
                        collected.borrow_mut().push(AssetIssue {
                            code: AssetIssueCode::BrokenReference,
                            level: AssetIssueLevel::Error,
                            message: format!("Broken reference: {}", r.asset_path),
                            detail: None,
                            context_path: Some(source.clone()),
                        });
                    }
                }
                for p in stage.payloads_in(prim_path.clone()) {
                    if unresolved.contains(p.asset_path.as_str()) {
                        collected.borrow_mut().push(AssetIssue {
                            code: AssetIssueCode::MissingPayload,
                            level: AssetIssueLevel::Error,
                            message: format!("Missing payload: {}", p.asset_path),
                            detail: None,
                            context_path: Some(source.clone()),
                        });
                    }
                }
            })
            .map_err(|e| UsdError::Parse(e.to_string()))?;
        issues.extend(collected.into_inner());

        Ok(issues)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tiny_usda() -> PathBuf {
        // tests run with CWD = src-tauri
        PathBuf::from("../samples/assets/usd/tiny.usda")
    }

    #[test]
    fn summarize_tiny_usda() {
        let backend = OpenusdBackend::new();
        let summary = backend
            .summarize_stage(&tiny_usda())
            .expect("summarize tiny.usda");
        assert_eq!(summary.layer_count, 1);
        assert_eq!(summary.root_prim_count, 1);
        assert_eq!(summary.mesh_count, 1, "tiny.usda has one Mesh");
        assert_eq!(summary.payload_count, 0);
        assert!(summary.warnings.is_empty());
    }

    #[test]
    fn inspect_tiny_usda() {
        let backend = OpenusdBackend::new();
        let inspection = backend
            .inspect_stage(&tiny_usda())
            .expect("inspect tiny.usda");
        assert_eq!(inspection.default_prim.as_deref(), Some("Root"));
        assert_eq!(inspection.up_axis.as_deref(), Some("Y"));
        assert_eq!(inspection.meters_per_unit, Some(0.01));
        assert_eq!(inspection.root_prims, vec!["Root".to_string()]);
        assert!(inspection.references.is_empty());
        assert!(inspection.payloads.is_empty());
        assert!(inspection.missing_assets.is_empty());
    }

    #[test]
    fn collect_issues_tiny_usda_is_clean() {
        let backend = OpenusdBackend::new();
        let issues = backend
            .collect_asset_issues(&tiny_usda())
            .expect("collect issues");
        // tiny.usda is Y-up, metersPerUnit=0.01, no missing assets → no issues
        assert!(issues.is_empty(), "expected no issues, got {issues:?}");
    }

    // ----- Phase 0 production-asset parity tests --------------------------
    //
    // These tests reproduce the numbers we observed in `experiments/usd-poc`
    // (see docs/usd-phase0.md) but through `OpenusdBackend` instead of the
    // raw `openusd` API. They confirm the adapter does not lose information
    // for real-world USD scenes.
    //
    // The assets live under `samples/private/` (license-restricted), so the
    // tests are `#[ignore]`d by default and skipped automatically when the
    // file is missing. Run them locally with:
    //
    //     cargo test --lib usd:: -- --ignored
    //
    // ---------------------------------------------------------------------

    fn skip_if_missing(path: &PathBuf, name: &str) -> bool {
        if !path.exists() {
            eprintln!("SKIP {name}: not present at {}", path.display());
            return true;
        }
        false
    }

    #[test]
    #[ignore = "needs samples/private (Pixar license)"]
    fn summarize_kitchen_set() {
        let path = PathBuf::from(
            "../samples/private/usd/Kitchen_set/Kitchen_set/Kitchen_set.usd",
        );
        if skip_if_missing(&path, "kitchen_set") {
            return;
        }
        let backend = OpenusdBackend::new();
        let summary = backend.summarize_stage(&path).expect("summarize kitchen_set");
        // Phase 0 observation: 229 layers, 77 root prims, 2048 traversed prims.
        assert_eq!(summary.layer_count, 229, "kitchen_set layer count");
        assert_eq!(summary.root_prim_count, 77, "kitchen_set root prim count");
    }

    #[test]
    #[ignore = "needs samples/private (Pixar license)"]
    fn inspect_kitchen_set() {
        let path = PathBuf::from(
            "../samples/private/usd/Kitchen_set/Kitchen_set/Kitchen_set.usd",
        );
        if skip_if_missing(&path, "kitchen_set") {
            return;
        }
        let backend = OpenusdBackend::new();
        let inspection = backend.inspect_stage(&path).expect("inspect kitchen_set");
        assert_eq!(inspection.default_prim.as_deref(), Some("Kitchen_set"));
        assert_eq!(inspection.up_axis.as_deref(), Some("Z"));
        // Phase 0 says references and payloads are heavily used.
        assert!(
            !inspection.references.is_empty(),
            "kitchen_set should expose references"
        );
        assert!(
            !inspection.payloads.is_empty(),
            "kitchen_set should expose payloads"
        );
    }

    #[test]
    #[ignore = "needs samples/private (Pixar license) — depends on PR #41 fix"]
    fn inspect_kitchen_set_instanced() {
        // Phase 0 PoC: this file failed with `Unsupported prim metadata: instanceable`.
        // The fork's `feature/instanceable-metadata` branch (upstream PR #41) is
        // supposed to fix it. This test verifies the fix is wired into the
        // git dependency.
        let path = PathBuf::from(
            "../samples/private/usd/Kitchen_set/Kitchen_set/Kitchen_set_instanced.usd",
        );
        if skip_if_missing(&path, "kitchen_set_instanced") {
            return;
        }
        let backend = OpenusdBackend::new();
        let inspection = backend
            .inspect_stage(&path)
            .expect("instanceable metadata regression: should now parse");
        assert_eq!(inspection.default_prim.as_deref(), Some("Kitchen_set"));
    }

    #[test]
    #[ignore = "needs samples/private (Apple AR Quick Look)"]
    fn inspect_chameleon_usdz() {
        let path = PathBuf::from(
            "../samples/private/usd/chameleon_anim_mtl_variant.usdz",
        );
        if skip_if_missing(&path, "chameleon_usdz") {
            return;
        }
        let backend = OpenusdBackend::new();
        let summary = backend.summarize_stage(&path).expect("summarize chameleon");
        assert_eq!(summary.layer_count, 1, "usdz reports as a single layer");
        assert_eq!(summary.root_prim_count, 1);

        let inspection = backend.inspect_stage(&path).expect("inspect chameleon");
        assert_eq!(inspection.default_prim.as_deref(), Some("Root"));
    }

    #[test]
    #[ignore = "needs samples/private (Apple AR Quick Look)"]
    fn inspect_glove_usdz() {
        let path = PathBuf::from(
            "../samples/private/usd/glove_baseball_mtl_variant.usdz",
        );
        if skip_if_missing(&path, "glove_usdz") {
            return;
        }
        let backend = OpenusdBackend::new();
        let summary = backend.summarize_stage(&path).expect("summarize glove");
        assert_eq!(summary.layer_count, 1);
        assert_eq!(summary.root_prim_count, 1);

        let inspection = backend.inspect_stage(&path).expect("inspect glove");
        assert_eq!(inspection.default_prim.as_deref(), Some("glove_baseball"));
    }
}
