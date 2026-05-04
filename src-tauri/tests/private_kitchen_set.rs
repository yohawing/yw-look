//! Private USD regression checks for Pixar Kitchen Set.
//!
//! The fixture lives under `samples/private/`, so these tests skip when the
//! sample has not been fetched. When present, they exercise the inspector RPC
//! backend directly instead of relying on viewport success, which can miss
//! sidebar-only USD inspection failures.

#![cfg(feature = "backend-openusd-rs")]

use std::path::PathBuf;

use yw_look_lib::usd::{OpenusdBackend, StageLoadPolicy, UsdGeometryBackend, UsdInspectBackend};

fn kitchen_set_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("samples")
        .join("private")
        .join("usd")
        .join("Kitchen_set")
        .join("Kitchen_set.usd")
}

fn kitchen_set_or_skip() -> Option<PathBuf> {
    let path = kitchen_set_path();
    if path.exists() {
        Some(path)
    } else {
        eprintln!(
            "Skipping private Kitchen Set regression: {}",
            path.display()
        );
        None
    }
}

#[test]
fn kitchen_set_inspector_rpcs_succeed() {
    let Some(path) = kitchen_set_or_skip() else {
        return;
    };
    let backend = OpenusdBackend::new();

    let summary = backend
        .summarize_stage(&path, StageLoadPolicy::LoadAll)
        .expect("summarize_stage must succeed on Kitchen_set.usd");
    assert!(
        summary.mesh_count >= 10,
        "Kitchen Set should expose composed meshes, got {}",
        summary.mesh_count,
    );
    assert_eq!(
        summary.unresolved_payload_count, 0,
        "Kitchen Set should not report unresolved payloads under LoadAll",
    );

    let inspection = backend
        .inspect_stage(&path, StageLoadPolicy::LoadAll)
        .expect("inspect_stage must succeed on Kitchen_set.usd");
    assert!(
        inspection.missing_assets.is_empty(),
        "Kitchen Set should not report missing composed assets: {:?}",
        inspection.missing_assets,
    );

    let issues = backend
        .collect_asset_issues(&path)
        .expect("collect_asset_issues must succeed on Kitchen_set.usd");
    assert!(
        issues.is_empty(),
        "Kitchen Set should not report asset issues: {:?}",
        issues
    );
}

#[test]
fn kitchen_set_no_payloads_inspection_succeeds() {
    let Some(path) = kitchen_set_or_skip() else {
        return;
    };
    let backend = OpenusdBackend::new();

    let summary = backend
        .summarize_stage(&path, StageLoadPolicy::NoPayloads)
        .expect("summarize_stage must succeed with payloads deferred");
    assert_eq!(
        summary.unresolved_payload_count, 0,
        "Deferred Kitchen Set payloads should not be classified as unresolved",
    );

    let inspection = backend
        .inspect_stage(&path, StageLoadPolicy::NoPayloads)
        .expect("inspect_stage must succeed with payloads deferred");
    assert!(
        inspection.missing_assets.is_empty(),
        "Deferred Kitchen Set inspection should not report missing assets: {:?}",
        inspection.missing_assets,
    );
}

#[test]
fn kitchen_set_geometry_extract_succeeds() {
    let Some(path) = kitchen_set_or_skip() else {
        return;
    };
    let backend = OpenusdBackend::new();

    let glb = backend
        .extract_geometry_glb(&path, StageLoadPolicy::LoadAll)
        .expect("extract_geometry_glb must succeed on Kitchen_set.usd");
    assert!(
        glb.len() > 20,
        "Kitchen Set GLB output should be non-empty, got {} bytes",
        glb.len(),
    );

    let deferred_glb = backend
        .extract_geometry_glb(&path, StageLoadPolicy::NoPayloads)
        .expect("extract_geometry_glb must succeed on Kitchen_set.usd with payloads deferred");
    assert!(
        deferred_glb.len() > 20,
        "Deferred Kitchen Set GLB output should be non-empty, got {} bytes",
        deferred_glb.len(),
    );
}
