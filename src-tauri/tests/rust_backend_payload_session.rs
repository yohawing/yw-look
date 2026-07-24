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

fn glb_mesh_count(glb: &[u8]) -> usize {
    assert_eq!(&glb[0..4], b"glTF", "expected a GLB payload");
    let json_length = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
    let json = std::str::from_utf8(&glb[20..20 + json_length])
        .expect("GLB JSON should be UTF-8")
        .trim_end_matches(' ');
    serde_json::from_str::<serde_json::Value>(json)
        .expect("GLB JSON should parse")
        .get("meshes")
        .and_then(serde_json::Value::as_array)
        .map_or(0, Vec::len)
}

#[test]
fn rust_session_loaded_unloaded_reloaded_is_deterministic() {
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
    let glb_initial = backend
        .extract_geometry_from_session(&stage, &path, &options)
        .expect("initial payload-free extract should succeed");
    assert_eq!(
        glb_mesh_count(&glb_initial),
        1,
        "session starts with only the inline mesh"
    );

    backend
        .load_payload(&stage, "/Root/PayloadRoot")
        .expect("load_payload should succeed");
    let glb_loaded = backend
        .extract_geometry_from_session(&stage, &path, &options)
        .expect("extract after load should succeed");
    assert_eq!(
        glb_mesh_count(&glb_loaded),
        2,
        "inline and loaded payload meshes"
    );

    backend
        .unload_payload(&stage, "/Root/PayloadRoot")
        .expect("unload_payload should succeed");
    let glb_unloaded = backend
        .extract_geometry_from_session(&stage, &path, &options)
        .expect("extract after unload should succeed");
    assert_eq!(
        glb_mesh_count(&glb_unloaded),
        1,
        "only the inline mesh remains after unload"
    );
    assert_eq!(
        glb_unloaded, glb_initial,
        "unload should restore the initial payload-free GLB bytes"
    );

    backend
        .load_payload(&stage, "/Root/PayloadRoot")
        .expect("reload_payload should succeed");
    let glb_reloaded = backend
        .extract_geometry_from_session(&stage, &path, &options)
        .expect("extract after reload should succeed");

    assert_eq!(glb_mesh_count(&glb_reloaded), 2, "reloaded payload mesh");
    assert_eq!(
        glb_reloaded, glb_loaded,
        "reloading the same payload should reproduce identical GLB bytes"
    );
}
