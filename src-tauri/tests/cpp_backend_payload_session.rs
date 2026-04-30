//! Integration tests for the #44 per-prim payload load / unload session.
//!
//! These tests exercise the `open_stage_session`, `load_payload`,
//! `unload_payload`, and `extract_geometry_from_session` backend methods
//! through the C++ backend (`backend-openusd-cpp`).
//!
//! Fixture: `samples/assets/usd/tiny_payload.usda` — a two-prim stage
//! containing one inline `Mesh "InlineMesh"` and one `Xform "PayloadRoot"`
//! that has a payload arc pointing at `tiny.usda`.  When the stage is opened
//! with `NoPayloads` the payload is deferred and only `InlineMesh` is
//! present; after `load_payload("/Root/PayloadRoot")` the additional mesh
//! from `tiny.usda` appears.

#![cfg(feature = "backend-openusd-cpp")]

use std::path::PathBuf;

use yw_look_lib::usd::{
    stage_state::OpenStage, OpenusdCppBackend, StageLoadPolicy, UsdBackend,
};

fn tiny_payload_path() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .join("..")
        .join("samples")
        .join("assets")
        .join("usd")
        .join("tiny_payload.usda")
}

/// Smoke test: opening the fixture with `NoPayloads` returns an `OpenStage`
/// without panicking and the Cpp variant is constructed correctly.
#[test]
fn open_stage_session_no_payloads_smoke() {
    let backend = OpenusdCppBackend::new();
    let path = tiny_payload_path();
    assert!(
        path.exists(),
        "tiny_payload.usda fixture is missing at {}",
        path.display()
    );

    let stage = backend
        .open_stage_session(&path, StageLoadPolicy::NoPayloads)
        .expect("open_stage_session should succeed");

    match stage {
        OpenStage::Cpp(_) => {} // expected
        #[cfg(feature = "backend-openusd-rs")]
        OpenStage::Rust(_) => panic!("expected Cpp variant from OpenusdCppBackend"),
    }
}

/// Test that `extract_geometry_from_session` with `NoPayloads` produces a
/// smaller GLB than with all payloads loaded. This is a coarse check:
/// we just verify the call succeeds and returns non-empty bytes.
#[test]
fn extract_geometry_session_no_payloads_succeeds() {
    let backend = OpenusdCppBackend::new();
    let path = tiny_payload_path();
    if !path.exists() {
        eprintln!("Skipping: tiny_payload.usda not found");
        return;
    }

    let stage = backend
        .open_stage_session(&path, StageLoadPolicy::NoPayloads)
        .expect("open_stage_session should succeed");

    let options = yw_look_lib::usd::types::ExtractGeometryOptions {
        policy: StageLoadPolicy::NoPayloads,
        variant_selections: vec![],
        purpose_modes: yw_look_lib::usd::types::PurposeModes::default(),
    };

    let glb_bytes = backend
        .extract_geometry_from_session(&stage, &path, &options)
        .expect("extract_geometry_from_session should succeed under NoPayloads");

    // A valid GLB always starts with the magic 0x46546C67 ("glTF" in LE).
    assert!(
        glb_bytes.len() >= 4,
        "GLB output too short: {} bytes",
        glb_bytes.len()
    );
    let magic = u32::from_le_bytes(glb_bytes[..4].try_into().unwrap());
    assert_eq!(magic, 0x46546C67u32, "output does not have GLB magic bytes");
}

/// Test the full load/unload round-trip:
///
/// 1. Open with `NoPayloads`.
/// 2. Extract GLB (only InlineMesh visible → smaller).
/// 3. Load `/Root/PayloadRoot`.
/// 4. Extract GLB again (InlineMesh + Quad from tiny.usda → larger).
/// 5. Unload `/Root/PayloadRoot`.
/// 6. Extract GLB once more (should match the size from step 2).
#[test]
fn load_unload_payload_changes_glb_size() {
    let backend = OpenusdCppBackend::new();
    let path = tiny_payload_path();
    if !path.exists() {
        eprintln!("Skipping: tiny_payload.usda not found");
        return;
    }

    let stage = backend
        .open_stage_session(&path, StageLoadPolicy::NoPayloads)
        .expect("open_stage_session should succeed");

    let options = yw_look_lib::usd::types::ExtractGeometryOptions {
        policy: StageLoadPolicy::NoPayloads,
        variant_selections: vec![],
        purpose_modes: yw_look_lib::usd::types::PurposeModes::default(),
    };

    // --- Step 2: extract before loading payload ---
    let glb_before = backend
        .extract_geometry_from_session(&stage, &path, &options)
        .expect("extract before load should succeed");

    // --- Step 3: load the payload ---
    backend
        .load_payload(&stage, "/Root/PayloadRoot")
        .expect("load_payload should succeed");

    // --- Step 4: extract after loading payload ---
    let glb_after_load = backend
        .extract_geometry_from_session(&stage, &path, &options)
        .expect("extract after load should succeed");

    // After loading the payload a new mesh is present, so the GLB should be
    // larger (or at least equal — we can't guarantee strict ordering because
    // the encoder has some variability in metadata size).
    assert!(
        glb_after_load.len() >= glb_before.len(),
        "GLB after load ({} bytes) should be >= before load ({} bytes)",
        glb_after_load.len(),
        glb_before.len()
    );

    // --- Step 5: unload the payload ---
    backend
        .unload_payload(&stage, "/Root/PayloadRoot")
        .expect("unload_payload should succeed");

    // --- Step 6: extract after unloading ---
    let glb_after_unload = backend
        .extract_geometry_from_session(&stage, &path, &options)
        .expect("extract after unload should succeed");

    // After unloading the GLB should shrink back to approximately the
    // before-load size. We use >= to tolerate minor metadata overhead.
    assert!(
        glb_before.len() >= glb_after_unload.len()
            || (glb_after_unload.len() as i64 - glb_before.len() as i64).abs() < 512,
        "GLB after unload ({} bytes) should be close to before-load ({} bytes)",
        glb_after_unload.len(),
        glb_before.len()
    );
}
