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

use yw_look_lib::usd::{OpenusdCppBackend, StageLoadPolicy, UsdGeometryBackend};

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

fn first_instanced_translation_count(gltf: &serde_json::Value) -> u64 {
    let nodes = gltf["nodes"].as_array().expect("nodes array");
    let node = nodes
        .iter()
        .find(|n| {
            n.get("extensions")
                .and_then(|e| e.get("EXT_mesh_gpu_instancing"))
                .is_some()
        })
        .expect("at least one node must have EXT_mesh_gpu_instancing");

    let translation_acc_idx = node["extensions"]["EXT_mesh_gpu_instancing"]["attributes"]
        ["TRANSLATION"]
        .as_u64()
        .expect("TRANSLATION accessor index") as usize;

    let accessors = gltf["accessors"].as_array().expect("accessors array");
    accessors[translation_acc_idx]["count"]
        .as_u64()
        .expect("accessor count")
}

fn first_instanced_primitive_material_index(gltf: &serde_json::Value) -> usize {
    let nodes = gltf["nodes"].as_array().expect("nodes array");
    let node = nodes
        .iter()
        .find(|n| {
            n.get("extensions")
                .and_then(|e| e.get("EXT_mesh_gpu_instancing"))
                .is_some()
        })
        .expect("at least one node must have EXT_mesh_gpu_instancing");
    let mesh_idx = node["mesh"].as_u64().expect("instanced node mesh index") as usize;
    let meshes = gltf["meshes"].as_array().expect("meshes array");
    let primitives = meshes[mesh_idx]["primitives"]
        .as_array()
        .expect("mesh primitives array");
    primitives[0]["material"]
        .as_u64()
        .expect("primitive material index") as usize
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

    // 2. The TRANSLATION accessor for the instanced node must have count == 5.
    let count = first_instanced_translation_count(&gltf);
    assert_eq!(
        count, 5,
        "TRANSLATION accessor count must equal the instance count (5); got {count}"
    );
}

#[test]
fn point_instancer_invisible_ids_match_authored_ids() {
    let temp = tempfile::tempdir().expect("tempdir");
    let path = temp.path().join("point_instancer_authored_ids.usda");
    std::fs::write(
        &path,
        r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
    metersPerUnit = 1
)

def Xform "Root"
{
    def PointInstancer "Instancer"
    {
        rel prototypes = [</Root/Instancer/PrototypeCube>]

        int64[] ids = [10, 20, 30]
        int64[] invisibleIds = [20]
        int[] protoIndices = [0, 0, 0]
        point3f[] positions = [(0, 0, 0), (2, 0, 0), (4, 0, 0)]
        quath[] orientations = [(1, 0, 0, 0), (1, 0, 0, 0), (1, 0, 0, 0)]
        float3[] scales = [(1, 1, 1), (1, 1, 1), (1, 1, 1)]

        def Mesh "PrototypeCube"
        {
            int[] faceVertexCounts = [4, 4, 4, 4, 4, 4]
            int[] faceVertexIndices = [0, 1, 3, 2, 2, 3, 5, 4, 4, 5, 7, 6, 6, 7, 1, 0, 1, 7, 5, 3, 6, 0, 2, 4]
            point3f[] points = [
                (-0.5, -0.5,  0.5),
                ( 0.5, -0.5,  0.5),
                (-0.5,  0.5,  0.5),
                ( 0.5,  0.5,  0.5),
                (-0.5,  0.5, -0.5),
                ( 0.5,  0.5, -0.5),
                (-0.5, -0.5, -0.5),
                ( 0.5, -0.5, -0.5)
            ]
        }
    }
}
"#,
    )
    .expect("write USDA fixture");

    let backend = OpenusdCppBackend::new();
    let bytes = backend
        .extract_geometry_glb(&path, StageLoadPolicy::LoadAll)
        .expect("extract_geometry_glb must succeed");

    let gltf = parse_glb_json(&bytes);
    let count = first_instanced_translation_count(&gltf);
    assert_eq!(
        count, 2,
        "invisibleIds must match authored ids, hiding only id=20; got {count}"
    );
}

#[test]
fn point_instancer_prototype_mesh_direct_material_binding_is_used() {
    let temp = tempfile::tempdir().expect("tempdir");
    let path = temp.path().join("point_instancer_material.usda");
    std::fs::write(
        &path,
        r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
    metersPerUnit = 1
)

def Xform "Root"
{
    def Scope "Looks"
    {
        def Material "Red"
        {
            token outputs:surface.connect = </Root/Looks/Red/Preview.outputs:surface>

            def Shader "Preview"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = (1, 0, 0)
                float inputs:roughness = 0.25
                token outputs:surface
            }
        }
    }

    def PointInstancer "Instancer"
    {
        rel prototypes = [</Root/Instancer/PrototypeCube>]

        int[] protoIndices = [0]
        point3f[] positions = [(0, 0, 0)]
        quath[] orientations = [(1, 0, 0, 0)]
        float3[] scales = [(1, 1, 1)]

        def Mesh "PrototypeCube"
        (
            prepend apiSchemas = ["MaterialBindingAPI"]
        )
        {
            rel material:binding = </Root/Looks/Red>
            int[] faceVertexCounts = [4, 4, 4, 4, 4, 4]
            int[] faceVertexIndices = [0, 1, 3, 2, 2, 3, 5, 4, 4, 5, 7, 6, 6, 7, 1, 0, 1, 7, 5, 3, 6, 0, 2, 4]
            point3f[] points = [
                (-0.5, -0.5,  0.5),
                ( 0.5, -0.5,  0.5),
                (-0.5,  0.5,  0.5),
                ( 0.5,  0.5,  0.5),
                (-0.5,  0.5, -0.5),
                ( 0.5,  0.5, -0.5),
                (-0.5, -0.5, -0.5),
                ( 0.5, -0.5, -0.5)
            ]
        }
    }
}
"#,
    )
    .expect("write USDA fixture");

    let backend = OpenusdCppBackend::new();
    let bytes = backend
        .extract_geometry_glb(&path, StageLoadPolicy::LoadAll)
        .expect("extract_geometry_glb must succeed");

    let gltf = parse_glb_json(&bytes);
    let material_idx = first_instanced_primitive_material_index(&gltf);
    let materials = gltf["materials"].as_array().expect("materials array");
    let material = &materials[material_idx];
    assert_eq!(material["name"].as_str(), Some("usd:/Root/Looks/Red"));
    let base_color = material["pbrMetallicRoughness"]["baseColorFactor"]
        .as_array()
        .expect("baseColorFactor");
    assert_eq!(base_color[0].as_f64(), Some(1.0));
    assert_eq!(base_color[1].as_f64(), Some(0.0));
    assert_eq!(base_color[2].as_f64(), Some(0.0));
}
