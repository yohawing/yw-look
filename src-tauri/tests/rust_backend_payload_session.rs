//! Integration tests for the Rust OpenUSD fallback payload session.

#![cfg(feature = "backend-openusd-rs")]

use std::path::PathBuf;

use yw_look_lib::usd::{
    types::{ExtractGeometryOptions, PurposeModes},
    OpenusdBackend, StageLoadPolicy, UsdSessionBackend,
};

fn tiny_payload_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("samples")
        .join("assets")
        .join("usd")
        .join("tiny_payload.usda")
}

fn extract_options() -> ExtractGeometryOptions {
    ExtractGeometryOptions {
        policy: StageLoadPolicy::NoPayloads,
        variant_selections: vec![],
        purpose_modes: PurposeModes::default(),
    }
}

#[test]
fn rust_session_load_unload_payload_changes_glb_size() {
    let backend = OpenusdBackend::new();
    let path = tiny_payload_path();
    assert!(
        path.exists(),
        "tiny_payload.usda fixture is missing at {}",
        path.display()
    );

    let stage = backend
        .open_stage_session(&path, StageLoadPolicy::NoPayloads)
        .expect("open_stage_session should succeed");
    let options = extract_options();

    let glb_before = backend
        .extract_geometry_from_session(&stage, &path, &options)
        .expect("extract before load should succeed");

    backend
        .load_payload(&stage, "/Root/PayloadRoot")
        .expect("load_payload should succeed");
    let glb_after_load = backend
        .extract_geometry_from_session(&stage, &path, &options)
        .expect("extract after load should succeed");

    assert!(
        glb_after_load.len() > glb_before.len(),
        "GLB after load ({} bytes) should be larger than before load ({} bytes)",
        glb_after_load.len(),
        glb_before.len()
    );

    backend
        .unload_payload(&stage, "/Root/PayloadRoot")
        .expect("unload_payload should succeed");
    let glb_after_unload = backend
        .extract_geometry_from_session(&stage, &path, &options)
        .expect("extract after unload should succeed");

    assert_eq!(
        glb_after_unload.len(),
        glb_before.len(),
        "unloaded Rust session should return to the no-payload GLB"
    );
}
