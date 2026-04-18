//! Integration tests for the C++ backend's geometry pipeline
//! (`extract_geometry_glb` / `requires_glb_preview`). Gated behind
//! `backend-openusd-cpp` so default builds on machines without vcpkg
//! and the C++ toolchain keep working untouched.
//!
//! Phase 2.D: these cover the minimal surface landed in Phase 2.B–2.C
//! (raw mesh readers + xform + visibility + default material). Later
//! phases will bolt on material / skin / animation / light / camera
//! parity as the shim grows.

#![cfg(feature = "backend-openusd-cpp")]

use std::path::PathBuf;

use yw_look_lib::usd::{OpenusdCppBackend, StageLoadPolicy, UsdBackend};

/// Fixture resolver shared with `cpp_backend_inspector.rs`.
fn tiny_usda_path() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .join("..")
        .join("samples")
        .join("assets")
        .join("usd")
        .join("tiny.usda")
}

/// Phase 2.E.1 fixture: one Mesh with a bound UsdPreviewSurface that
/// authors only scalar inputs. Exercises the cpp backend's material-
/// resolve path from `prim_bound_material` through
/// `material_surface_shader` and the scalar readers.
fn tiny_material_usda_path() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir)
        .join("..")
        .join("samples")
        .join("assets")
        .join("usd")
        .join("tiny_material.usda")
}

/// Every valid GLB blob begins with this 12-byte header: magic `glTF`
/// (`0x46546C67` little-endian), version `2`, followed by a total
/// length field we cross-check against the actual byte count to catch
/// truncated blobs early.
fn assert_valid_glb_header(bytes: &[u8]) {
    assert!(
        bytes.len() >= 12,
        "GLB blob too short to hold a header: {} bytes",
        bytes.len()
    );
    assert_eq!(&bytes[..4], b"glTF", "GLB magic must be 'glTF'");
    let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    assert_eq!(version, 2, "GLB version must be 2");
    let total_len = u32::from_le_bytes(bytes[8..12].try_into().unwrap());
    assert_eq!(
        total_len as usize,
        bytes.len(),
        "GLB header length field ({}) must match byte length ({})",
        total_len,
        bytes.len()
    );
}

/// Extracts the JSON chunk (chunk #0 in a glTF 2.0 GLB) and parses it
/// as a serde_json::Value so the tests can peek at the gltf structure
/// without linking an external glTF parser.
fn parse_glb_json(bytes: &[u8]) -> serde_json::Value {
    assert_valid_glb_header(bytes);
    // First chunk follows immediately after the 12-byte header.
    let chunk_len = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    let chunk_type = u32::from_le_bytes(bytes[16..20].try_into().unwrap());
    // Chunk type `JSON` = 0x4E4F534A (little-endian ASCII "JSON").
    assert_eq!(chunk_type, 0x4E4F534A, "first GLB chunk must be JSON");
    let json_start = 20usize;
    let json_end = json_start + chunk_len;
    assert!(
        bytes.len() >= json_end,
        "JSON chunk extends past GLB end: chunk_len={chunk_len}, blob={}",
        bytes.len()
    );
    let json_bytes = &bytes[json_start..json_end];
    serde_json::from_slice(json_bytes).expect("JSON chunk must be valid glTF JSON")
}

#[test]
fn tiny_usda_extract_glb_smoke() {
    let backend = OpenusdCppBackend::new();
    let path = tiny_usda_path();
    assert!(path.exists(), "tiny.usda missing at {}", path.display());

    let bytes = backend
        .extract_geometry_glb(&path, StageLoadPolicy::LoadAll)
        .expect("extract_geometry_glb must succeed on tiny.usda");
    let gltf = parse_glb_json(&bytes);

    // tiny.usda has exactly one Mesh "Quad" under /Root, so the GLB
    // must have one mesh in the `meshes` array.
    let meshes = gltf["meshes"].as_array().expect("meshes array");
    assert_eq!(meshes.len(), 1, "tiny.usda produces exactly one mesh");
    // Default material fallback: slot 0 is always emitted by the
    // Phase 2.C minimal backend, even when no USD material is bound.
    let materials = gltf["materials"].as_array().expect("materials array");
    assert!(
        !materials.is_empty(),
        "default material slot must be present"
    );
}

#[test]
fn tiny_material_usda_resolves_preview_surface_scalars() {
    let backend = OpenusdCppBackend::new();
    let path = tiny_material_usda_path();
    assert!(
        path.exists(),
        "tiny_material.usda missing at {}",
        path.display()
    );

    let bytes = backend
        .extract_geometry_glb(&path, StageLoadPolicy::LoadAll)
        .expect("extract_geometry_glb must succeed on tiny_material.usda");
    let gltf = parse_glb_json(&bytes);

    // Expect two materials: slot 0 (yw-look default, carried for
    // meshes without a binding) + slot 1 (resolved from RedMat).
    let materials = gltf["materials"].as_array().expect("materials array");
    assert_eq!(
        materials.len(),
        2,
        "default + one resolved UsdPreviewSurface slot"
    );

    // The mesh must point at the resolved material (index 1).
    let mat_idx = gltf["meshes"][0]["primitives"][0]["material"]
        .as_u64()
        .expect("primitive material index");
    assert_eq!(mat_idx, 1, "bound UsdPreviewSurface lands in slot 1");

    let mat = &materials[1];
    let name = mat["name"].as_str().expect("material name");
    assert!(
        name.contains("RedMat"),
        "material name retains bound path: {name}"
    );

    // Phase 2.E.1 carries the USD authoring through sRGB → linear
    // conversion. diffuseColor=(0.8, 0.1, 0.05) linearizes to about
    // (0.603, 0.010, 0.004). Check loose tolerances so minor
    // floating-point differences between shim and reference don't
    // make the test flaky.
    let bcf = mat["pbrMetallicRoughness"]["baseColorFactor"]
        .as_array()
        .expect("baseColorFactor");
    let r = bcf[0].as_f64().unwrap();
    let g = bcf[1].as_f64().unwrap();
    let b = bcf[2].as_f64().unwrap();
    let a = bcf[3].as_f64().unwrap();
    assert!((r - 0.603).abs() < 0.02, "red channel linearized: {r}");
    assert!((g - 0.010).abs() < 0.01, "green channel linearized: {g}");
    assert!((b - 0.004).abs() < 0.01, "blue channel linearized: {b}");
    assert!((a - 1.0).abs() < 1e-6, "alpha = opacity = 1.0: {a}");

    let mf = mat["pbrMetallicRoughness"]["metallicFactor"]
        .as_f64()
        .expect("metallicFactor");
    let rf = mat["pbrMetallicRoughness"]["roughnessFactor"]
        .as_f64()
        .expect("roughnessFactor");
    assert!((mf - 0.2).abs() < 1e-5, "metallic: {mf}");
    assert!((rf - 0.4).abs() < 1e-5, "roughness: {rf}");
}

#[test]
fn tiny_usda_requires_glb_preview_false() {
    // Single-layer USDA with no references/payloads → the Three.js
    // USDLoader path handles it, and the C++ backend should agree.
    let backend = OpenusdCppBackend::new();
    let path = tiny_usda_path();
    let requires = backend
        .requires_glb_preview(&path)
        .expect("requires_glb_preview on tiny.usda");
    assert!(!requires, "tiny.usda does not require GLB preview");
}

/// Cross-backend parity: when both feature flags are on the same build
/// we open the same fixture through both backends and check that they
/// agree on the shape of the produced GLB. We compare structural
/// fields (mesh count, primitive count, vertex count) rather than
/// bytes, because each backend controls its own accessor layout /
/// buffer packing. Semantic parity is what matters for the preview.
#[cfg(all(feature = "backend-openusd-cpp", feature = "backend-openusd-rs"))]
#[test]
fn tiny_usda_glb_parity_with_rust_backend() {
    use yw_look_lib::usd::OpenusdBackend;

    let path = tiny_usda_path();
    let cpp = OpenusdCppBackend::new()
        .extract_geometry_glb(&path, StageLoadPolicy::LoadAll)
        .expect("cpp backend GLB");
    let rs = OpenusdBackend::new()
        .extract_geometry_glb(&path, StageLoadPolicy::LoadAll)
        .expect("rust backend GLB");

    let cpp_json = parse_glb_json(&cpp);
    let rs_json = parse_glb_json(&rs);

    assert_eq!(
        cpp_json["meshes"].as_array().map(|a| a.len()),
        rs_json["meshes"].as_array().map(|a| a.len()),
        "mesh counts must agree"
    );

    // Compare per-mesh primitive counts. USD's Mesh `Quad` is one
    // primitive on both backends; this guards against one backend
    // accidentally splitting a mesh into subsets.
    let cpp_prim_counts = mesh_primitive_counts(&cpp_json);
    let rs_prim_counts = mesh_primitive_counts(&rs_json);
    assert_eq!(
        cpp_prim_counts, rs_prim_counts,
        "per-mesh primitive counts must agree"
    );

    // Vertex count parity: look up the POSITION accessor count for
    // the first primitive of the first mesh on each side. Both
    // backends triangulate the same Quad, so they must report the
    // same POSITION count regardless of the accessor layout strategy.
    let cpp_vc = first_primitive_position_count(&cpp_json);
    let rs_vc = first_primitive_position_count(&rs_json);
    assert_eq!(
        cpp_vc, rs_vc,
        "vertex count on Quad's first primitive must match: cpp={cpp_vc}, rs={rs_vc}"
    );
}

#[cfg(all(feature = "backend-openusd-cpp", feature = "backend-openusd-rs"))]
fn mesh_primitive_counts(gltf: &serde_json::Value) -> Vec<usize> {
    gltf["meshes"]
        .as_array()
        .map(|meshes| {
            meshes
                .iter()
                .map(|m| m["primitives"].as_array().map(|p| p.len()).unwrap_or(0))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(all(feature = "backend-openusd-cpp", feature = "backend-openusd-rs"))]
fn first_primitive_position_count(gltf: &serde_json::Value) -> u64 {
    let accessor_idx = gltf["meshes"][0]["primitives"][0]["attributes"]["POSITION"]
        .as_u64()
        .expect("first primitive POSITION accessor");
    gltf["accessors"][accessor_idx as usize]["count"]
        .as_u64()
        .expect("POSITION accessor count")
}
