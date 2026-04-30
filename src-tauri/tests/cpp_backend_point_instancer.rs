//! Integration tests for the #41 PointInstancer preview pipeline.
//!
//! These tests exercise the C++ backend's `extract_geometry_glb` path
//! against the `tiny_point_instancer.usda` fixture, asserting that the
//! resulting GLB contains at least one node with `EXT_mesh_gpu_instancing`
//! and that the TRANSLATION accessor holds exactly 5 entries (one per
//! instance).
//!
//! Gated behind `backend-openusd-cpp` — the Rust fork backend silently
//! skips PointInstancer prims (with a warning) and produces no instancing
//! output.

#![cfg(feature = "backend-openusd-cpp")]

use std::path::PathBuf;

use yw_look_lib::usd::{OpenusdCppBackend, StageLoadPolicy, UsdBackend};

fn tiny_point_instancer_path() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .join("..")
        .join("samples")
        .join("assets")
        .join("usd")
        .join("tiny_point_instancer.usda")
}

/// Parse the JSON chunk of a GLB blob. Panics on malformed input.
fn parse_glb_json(bytes: &[u8]) -> serde_json::Value {
    assert!(bytes.len() >= 12, "GLB too short");
    assert_eq!(&bytes[0..4], b"glTF", "GLB magic");
    let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    assert_eq!(version, 2, "GLB version");
    let chunk_len = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    let chunk_type = u32::from_le_bytes(bytes[16..20].try_into().unwrap());
    assert_eq!(chunk_type, 0x4E4F534A, "first GLB chunk must be JSON");
    let json_bytes = &bytes[20..20 + chunk_len];
    serde_json::from_slice(json_bytes).expect("valid JSON chunk")
}

/// Smoke test: `extract_geometry_glb` succeeds on the PointInstancer fixture
/// and returns a valid GLB blob.
#[test]
fn point_instancer_extract_glb_smoke() {
    let path = tiny_point_instancer_path();
    assert!(
        path.exists(),
        "tiny_point_instancer.usda fixture missing at {}",
        path.display()
    );

    let backend = OpenusdCppBackend::new();
    let bytes = backend
        .extract_geometry_glb(&path, StageLoadPolicy::LoadAll)
        .expect("extract_geometry_glb must succeed on tiny_point_instancer.usda");

    // Minimal GLB sanity.
    assert!(bytes.len() >= 12, "GLB must have at least a header");
    assert_eq!(&bytes[0..4], b"glTF");
}

/// Verify that the GLB contains `EXT_mesh_gpu_instancing` in `extensionsUsed`
/// and that the TRANSLATION accessor for the first instanced node has count 5.
#[test]
fn point_instancer_ext_mesh_gpu_instancing_present() {
    let path = tiny_point_instancer_path();
    if !path.exists() {
        // Skip gracefully when fixture is absent (CI without USD assets).
        eprintln!("Skipping: fixture not found at {}", path.display());
        return;
    }

    let backend = OpenusdCppBackend::new();
    let bytes = backend
        .extract_geometry_glb(&path, StageLoadPolicy::LoadAll)
        .expect("extract_geometry_glb must succeed");

    let gltf = parse_glb_json(&bytes);

    // 1. `extensionsUsed` must list EXT_mesh_gpu_instancing.
    let extensions_used = gltf["extensionsUsed"]
        .as_array()
        .expect("extensionsUsed must be an array");
    let has_instancing_ext = extensions_used
        .iter()
        .any(|v| v.as_str() == Some("EXT_mesh_gpu_instancing"));
    assert!(
        has_instancing_ext,
        "extensionsUsed must contain EXT_mesh_gpu_instancing; got: {extensions_used:?}"
    );

    // 2. At least one node must carry the extension.
    let nodes = gltf["nodes"].as_array().expect("nodes array");
    let instanced_node = nodes.iter().find(|n| {
        n.get("extensions")
            .and_then(|e| e.get("EXT_mesh_gpu_instancing"))
            .is_some()
    });
    assert!(
        instanced_node.is_some(),
        "at least one node must have EXT_mesh_gpu_instancing"
    );

    // 3. The TRANSLATION accessor for the instanced node must have count == 5.
    let node = instanced_node.unwrap();
    let translation_acc_idx = node["extensions"]["EXT_mesh_gpu_instancing"]["attributes"]
        ["TRANSLATION"]
        .as_u64()
        .expect("TRANSLATION accessor index") as usize;

    let accessors = gltf["accessors"].as_array().expect("accessors array");
    let translation_acc = &accessors[translation_acc_idx];
    let count = translation_acc["count"].as_u64().expect("accessor count");
    assert_eq!(
        count, 5,
        "TRANSLATION accessor count must equal the instance count (5); got {count}"
    );
}
