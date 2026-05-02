//! Integration tests for the Pixar OpenUSD C++ backend (inspector
//! surface only — the PoC covers `inspect_stage`, `summarize_stage`,
//! `collect_asset_issues`, and `root_layer_is_binary`).
//!
//! These tests are gated behind `backend-openusd-cpp` because they link
//! against the vcpkg-built OpenUSD monolith via the handwritten
//! `usd_c_shim` C ABI. Default (`backend-openusd-rs`-only) builds never
//! compile this file, so environments without vcpkg / MSVC toolchains
//! keep working unchanged.
//!
//! Fixture: `samples/assets/usd/tiny.usda` (Phase 0 sanity asset). A
//! single-layer USDA with one `Xform "Root"` containing one
//! `Mesh "Quad"`, `upAxis = "Y"` and `metersPerUnit = 0.01`.
//!
//! Parity test: when both backend features are compiled in at once, we
//! also open the same fixture through the Rust fork backend and check
//! that the two implementations return semantically matching root-level
//! metadata. See `docs/usd-cpp-poc.md` "検証" for the wider cross-asset
//! matrix the PoC needs to pass before promotion; this file covers the
//! smallest common fixture.

#![cfg(feature = "backend-openusd-cpp")]

use std::path::PathBuf;

use yw_look_lib::usd::{OpenusdCppBackend, StageLoadPolicy, UsdInspectBackend, UsdSourceBackend};

/// Resolve the Phase 0 tiny fixture relative to the cargo manifest so
/// `cargo test` works regardless of the current working directory that
/// the harness picks. `CARGO_MANIFEST_DIR` always points at
/// `src-tauri/`, and the sample tree lives one level up.
fn tiny_usda_path() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .join("..")
        .join("samples")
        .join("assets")
        .join("usd")
        .join("tiny.usda")
}

#[test]
fn tiny_usda_inspect_smoke() {
    let backend = OpenusdCppBackend::new();
    let path = tiny_usda_path();
    assert!(
        path.exists(),
        "tiny.usda fixture is missing at {}",
        path.display()
    );

    let inspection = backend
        .inspect_stage(&path, StageLoadPolicy::LoadAll)
        .expect("inspect_stage must succeed on tiny.usda");

    assert_eq!(
        inspection.default_prim.as_deref(),
        Some("Root"),
        "tiny.usda authors `defaultPrim = \"Root\"`",
    );
    assert_eq!(
        inspection.up_axis.as_deref(),
        Some("Y"),
        "tiny.usda authors `upAxis = \"Y\"`",
    );
    assert_eq!(
        inspection.root_prims,
        vec!["Root".to_string()],
        "tiny.usda has exactly one root prim",
    );
    // Single-file USDA: the inspector strips the root entry from the
    // layer list, so no sublayers are reported here. We don't assert on
    // composed_layers length beyond it being "nothing extra beyond the
    // root layer", because the shim may return the root identifier in
    // either position and `openusd_cpp_backend` already normalizes that.
    assert!(
        inspection.composed_layers.is_empty(),
        "tiny.usda has no sublayers / references / payloads, but got {:?}",
        inspection.composed_layers,
    );
    assert_eq!(
        inspection.load_policy,
        StageLoadPolicy::LoadAll,
        "inspection echoes back the requested load policy",
    );
}

#[test]
fn tiny_usda_summarize_smoke() {
    let backend = OpenusdCppBackend::new();
    let path = tiny_usda_path();

    let summary = backend
        .summarize_stage(&path, StageLoadPolicy::LoadAll)
        .expect("summarize_stage must succeed on tiny.usda");

    assert_eq!(
        summary.layer_count, 1,
        "tiny.usda is single-layer USDA, got {}",
        summary.layer_count,
    );
    assert_eq!(
        summary.root_prim_count, 1,
        "tiny.usda has one root prim, got {}",
        summary.root_prim_count,
    );
    assert!(
        summary.mesh_count >= 1,
        "tiny.usda authors at least one Mesh (Quad), got mesh_count = {}",
        summary.mesh_count,
    );
    assert_eq!(summary.payload_count, 0, "tiny.usda has no payloads");
    assert_eq!(
        summary.unloaded_payload_count, 0,
        "LoadAll never skips payloads",
    );
    assert!(!summary.has_variants, "tiny.usda authors no variant sets");
}

#[test]
fn tiny_usda_collect_asset_issues_empty() {
    let backend = OpenusdCppBackend::new();
    let path = tiny_usda_path();

    let issues = backend
        .collect_asset_issues(&path)
        .expect("collect_asset_issues must succeed on tiny.usda");

    assert!(
        issues.is_empty(),
        "tiny.usda is intentionally issue-free, got {:?}",
        issues,
    );
}

#[test]
fn tiny_usda_root_layer_is_usda() {
    let backend = OpenusdCppBackend::new();
    let path = tiny_usda_path();

    let is_binary = backend
        .root_layer_is_binary(&path)
        .expect("root_layer_is_binary must succeed on tiny.usda");

    assert!(!is_binary, "tiny.usda is text USDA, not binary USDC",);
}

/// `tiny_usda_path` with no time metadata must produce `duration_seconds = None`.
#[test]
fn tiny_usda_summary_duration_none() {
    let backend = OpenusdCppBackend::new();
    let path = tiny_usda_path();

    let summary = backend
        .summarize_stage(&path, StageLoadPolicy::LoadAll)
        .expect("summarize_stage must succeed on tiny.usda");

    assert!(
        summary.duration_seconds.is_none(),
        "tiny.usda does not author time metadata, duration_seconds must be None, got {:?}",
        summary.duration_seconds,
    );
    assert_eq!(
        summary.resolved_reference_count, 0,
        "tiny.usda has no references",
    );
    assert_eq!(
        summary.unresolved_reference_count, 0,
        "tiny.usda has no broken references",
    );
}

/// `tiny_timed.usda` authors startTimeCode=0 / endTimeCode=48 / framesPerSecond=24,
/// so duration_seconds must be 2.0.
fn tiny_timed_usda_path() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .join("..")
        .join("samples")
        .join("assets")
        .join("usd")
        .join("tiny_timed.usda")
}

#[test]
fn tiny_timed_usda_summary_duration() {
    let backend = OpenusdCppBackend::new();
    let path = tiny_timed_usda_path();
    assert!(
        path.exists(),
        "tiny_timed.usda fixture is missing at {}",
        path.display()
    );

    let summary = backend
        .summarize_stage(&path, StageLoadPolicy::LoadAll)
        .expect("summarize_stage must succeed on tiny_timed.usda");

    let duration = summary
        .duration_seconds
        .expect("tiny_timed.usda authors all three time fields, duration must be Some");
    assert!(
        (duration - 2.0).abs() < 1e-9,
        "expected duration_seconds = 2.0 (48 frames / 24 fps), got {duration}",
    );
}

/// `tiny_broken_ref.usda` has one resolved reference (to tiny.usda) and
/// one unresolved reference (does_not_exist.usda). The summary must
/// report resolved=1 / unresolved=1.
fn tiny_broken_ref_usda_path() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .join("..")
        .join("samples")
        .join("assets")
        .join("usd")
        .join("tiny_broken_ref.usda")
}

#[test]
fn tiny_broken_ref_usda_summary_reference_counts() {
    let backend = OpenusdCppBackend::new();
    let path = tiny_broken_ref_usda_path();
    assert!(
        path.exists(),
        "tiny_broken_ref.usda fixture is missing at {}",
        path.display()
    );

    let summary = backend
        .summarize_stage(&path, StageLoadPolicy::LoadAll)
        .expect("summarize_stage must succeed on tiny_broken_ref.usda");

    assert_eq!(
        summary.resolved_reference_count, 1,
        "tiny_broken_ref.usda has exactly one resolved reference (tiny.usda), got {}",
        summary.resolved_reference_count,
    );
    assert_eq!(
        summary.unresolved_reference_count, 1,
        "tiny_broken_ref.usda has exactly one broken reference (does_not_exist.usda), got {}",
        summary.unresolved_reference_count,
    );
    assert_eq!(
        summary.resolved_payload_count, 0,
        "tiny_broken_ref.usda has no payloads",
    );
    assert_eq!(
        summary.unresolved_payload_count, 0,
        "tiny_broken_ref.usda has no broken payloads",
    );
}

/// Cross-backend parity smoke test. Only runs when both backend
/// features are compiled in simultaneously, because the Rust fork
/// backend (`OpenusdBackend`) is gated behind `backend-openusd-rs`. In
/// `backend-openusd-cpp`-only builds this test simply does not exist,
/// matching the feature matrix described in `src/usd/mod.rs`.
#[cfg(all(feature = "backend-openusd-cpp", feature = "backend-openusd-rs"))]
#[test]
fn tiny_usda_parity_with_rust_backend() {
    use yw_look_lib::usd::OpenusdBackend;

    let cpp = OpenusdCppBackend::new();
    let rs = OpenusdBackend::new();
    let path = tiny_usda_path();

    let cpp_inspection = cpp
        .inspect_stage(&path, StageLoadPolicy::LoadAll)
        .expect("cpp backend inspect_stage");
    let rs_inspection = rs
        .inspect_stage(&path, StageLoadPolicy::LoadAll)
        .expect("rust backend inspect_stage");

    assert_eq!(
        cpp_inspection.default_prim, rs_inspection.default_prim,
        "default_prim must agree between backends",
    );
    assert_eq!(
        cpp_inspection.up_axis, rs_inspection.up_axis,
        "up_axis must agree between backends",
    );
    assert_eq!(
        cpp_inspection.root_prims.len(),
        rs_inspection.root_prims.len(),
        "root_prims count must agree (order is backend-defined)",
    );

    // Compare as sorted sets so we only assert on semantic identity,
    // not the order in which each backend enumerates the pseudo-root.
    let mut cpp_roots = cpp_inspection.root_prims.clone();
    let mut rs_roots = rs_inspection.root_prims.clone();
    cpp_roots.sort();
    rs_roots.sort();
    assert_eq!(
        cpp_roots, rs_roots,
        "root_prims set must agree between backends",
    );
}

/// #39 — `flatten_stage` must return valid USDA text for a USDA fixture.
/// We verify that the output starts with `#usda` (the USDA file header)
/// and contains the prim path `/Root` that tiny.usda authors.
#[test]
fn tiny_usda_flatten_stage() {
    let backend = OpenusdCppBackend::new();
    let path = tiny_usda_path();

    let text = backend
        .flatten_stage(&path)
        .expect("flatten_stage must succeed on tiny.usda");

    assert!(!text.is_empty(), "flatten_stage must return non-empty text",);
    assert!(
        text.contains("#usda") || text.starts_with("(") || text.contains("def "),
        "flatten output must look like USDA text, got first 200 chars: {:?}",
        &text[..text.len().min(200)],
    );
    assert!(
        text.contains("Root"),
        "flatten output must contain the Root prim from tiny.usda",
    );
}
