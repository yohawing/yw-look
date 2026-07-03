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

use yw_look_lib::usd::{OpenusdCppBackend, StageLoadPolicy, UsdGeometryBackend, UsdInspectBackend};

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

fn glb_bin_chunk(bytes: &[u8]) -> &[u8] {
    assert_valid_glb_header(bytes);
    let json_len = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    let bin_header = 20 + json_len;
    assert!(
        bytes.len() >= bin_header + 8,
        "GLB must contain a BIN chunk after JSON"
    );
    let bin_len =
        u32::from_le_bytes(bytes[bin_header..bin_header + 4].try_into().unwrap()) as usize;
    let bin_type = u32::from_le_bytes(bytes[bin_header + 4..bin_header + 8].try_into().unwrap());
    assert_eq!(bin_type, 0x004E4942, "second GLB chunk must be BIN");
    let bin_start = bin_header + 8;
    let bin_end = bin_start + bin_len;
    assert!(bytes.len() >= bin_end, "BIN chunk extends past GLB end");
    &bytes[bin_start..bin_end]
}

fn read_f32_accessor(bytes: &[u8], gltf: &serde_json::Value, accessor_idx: usize) -> Vec<f32> {
    let accessor = &gltf["accessors"][accessor_idx];
    assert_eq!(accessor["componentType"], 5126, "accessor must be FLOAT");
    let component_count = match accessor["type"].as_str().expect("accessor type") {
        "SCALAR" => 1,
        "VEC2" => 2,
        "VEC3" => 3,
        "VEC4" => 4,
        other => panic!("unsupported accessor type {other}"),
    };
    let count = accessor["count"].as_u64().expect("accessor count") as usize;
    let view_idx = accessor["bufferView"].as_u64().expect("bufferView") as usize;
    let view = &gltf["bufferViews"][view_idx];
    let view_offset = view["byteOffset"].as_u64().unwrap_or(0) as usize;
    let accessor_offset = accessor["byteOffset"].as_u64().unwrap_or(0) as usize;
    let byte_offset = view_offset + accessor_offset;
    let float_count = count * component_count;
    let byte_len = float_count * std::mem::size_of::<f32>();
    let bin = glb_bin_chunk(bytes);
    assert!(
        bin.len() >= byte_offset + byte_len,
        "accessor range extends past BIN chunk"
    );
    bin[byte_offset..byte_offset + byte_len]
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
        .collect()
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
fn display_opacity_emits_rgba_vertex_colors_and_blend_mode() -> std::io::Result<()> {
    let tmp_dir = std::env::temp_dir().join("yw_look_cpp_display_opacity");
    std::fs::create_dir_all(&tmp_dir)?;
    let usda_path = tmp_dir.join("display_opacity.usda");
    std::fs::write(
        &usda_path,
        r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri"
    {
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        uniform token subdivisionScheme = "none"
        color3f[] primvars:displayColor = [(1, 0, 0), (0, 1, 0), (0, 0, 1)] (
            interpolation = "vertex"
        )
        float[] primvars:displayOpacity = [1, 0.5, 0.25] (
            interpolation = "vertex"
        )
    }
}
"#,
    )?;

    let backend = OpenusdCppBackend::new();
    let bytes = backend
        .extract_geometry_glb(&usda_path, StageLoadPolicy::LoadAll)
        .expect("extract_geometry_glb must carry displayOpacity through C++ backend");
    let gltf = parse_glb_json(&bytes);

    let primitive = &gltf["meshes"][0]["primitives"][0];
    let color_accessor_idx = primitive["attributes"]["COLOR_0"]
        .as_u64()
        .expect("COLOR_0 accessor index") as usize;
    let color_acc = &gltf["accessors"][color_accessor_idx];
    assert_eq!(color_acc["type"], "VEC4", "COLOR_0 must be RGBA");
    assert_eq!(color_acc["componentType"], 5126, "COLOR_0 must be FLOAT");
    assert_eq!(color_acc["count"], 3, "triangle expands to three colors");

    let material_idx = primitive["material"]
        .as_u64()
        .expect("primitive material index") as usize;
    assert_eq!(
        gltf["materials"][material_idx]["alphaMode"], "BLEND",
        "partial displayOpacity alpha must enable material blending"
    );

    Ok(())
}

#[test]
fn negative_face_counts_return_parse_error_before_subset_filter() -> std::io::Result<()> {
    let tmp_dir = std::env::temp_dir().join("yw_look_cpp_negative_face_counts");
    std::fs::create_dir_all(&tmp_dir)?;
    let usda_path = tmp_dir.join("negative_face_counts.usda");
    std::fs::write(
        &usda_path,
        r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Bad"
    {
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        int[] faceVertexCounts = [-1]
        int[] faceVertexIndices = [0, 1, 2]
        uniform token subdivisionScheme = "none"

        def GeomSubset "BadSubset"
        {
            uniform token elementType = "face"
            uniform token familyName = "materialBind"
            int[] indices = [0]
        }
    }
}
"#,
    )?;

    let backend = OpenusdCppBackend::new();
    let err = backend
        .extract_geometry_glb(&usda_path, StageLoadPolicy::LoadAll)
        .expect_err("negative faceVertexCounts must be reported as a parse error");
    let msg = format!("{err:?}");
    assert!(
        msg.contains("negative faceVertexCounts"),
        "unexpected error: {msg}"
    );

    Ok(())
}

#[test]
fn display_opacity_subset_preserves_vertex_interpolation() -> std::io::Result<()> {
    let tmp_dir = std::env::temp_dir().join("yw_look_cpp_display_opacity_subset");
    std::fs::create_dir_all(&tmp_dir)?;
    let usda_path = tmp_dir.join("display_opacity_subset.usda");
    std::fs::write(
        &usda_path,
        r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Mesh"
    {
        point3f[] points = [
            (0, 0, 0), (1, 0, 0), (0, 1, 0),
            (2, 0, 0), (2, 1, 0), (1, 1, 0)
        ]
        int[] faceVertexCounts = [3, 3]
        int[] faceVertexIndices = [0, 1, 2, 5, 4, 3]
        uniform token subdivisionScheme = "none"
        color3f[] primvars:displayColor = [
            (1, 0, 0), (0, 1, 0), (0, 0, 1),
            (1, 1, 0), (0, 1, 1), (1, 0, 1)
        ] (
            interpolation = "vertex"
        )
        float[] primvars:displayOpacity = [1, 0.9, 0.8, 0.6, 0.4, 0.2] (
            interpolation = "vertex"
        )

        def GeomSubset "Second"
        {
            uniform token elementType = "face"
            uniform token familyName = "materialBind"
            int[] indices = [1]
        }
    }
}
"#,
    )?;

    let backend = OpenusdCppBackend::new();
    let bytes = backend
        .extract_geometry_glb(&usda_path, StageLoadPolicy::LoadAll)
        .expect("extract_geometry_glb must preserve vertex opacity on subsets");
    let gltf = parse_glb_json(&bytes);

    let primitive = &gltf["meshes"][0]["primitives"][0];
    let color_accessor_idx = primitive["attributes"]["COLOR_0"]
        .as_u64()
        .expect("COLOR_0 accessor index") as usize;
    let colors = read_f32_accessor(&bytes, &gltf, color_accessor_idx);
    let alphas: Vec<f32> = colors.chunks_exact(4).map(|rgba| rgba[3]).collect();
    assert_eq!(
        alphas.len(),
        3,
        "subset face triangulates to three vertices"
    );
    let expected = [0.2_f32, 0.4, 0.6];
    for (i, (actual, expected)) in alphas.iter().zip(expected).enumerate() {
        assert!(
            (*actual - expected).abs() < 1e-5,
            "alpha[{i}] = {actual}, expected {expected}"
        );
    }

    Ok(())
}

#[test]
fn display_opacity_uniform_uses_face_alpha_when_counts_match() -> std::io::Result<()> {
    let tmp_dir = std::env::temp_dir().join("yw_look_cpp_display_opacity_uniform");
    std::fs::create_dir_all(&tmp_dir)?;
    let usda_path = tmp_dir.join("display_opacity_uniform.usda");
    std::fs::write(
        &usda_path,
        r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Mesh"
    {
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        int[] faceVertexCounts = [3, 3, 3]
        int[] faceVertexIndices = [0, 1, 2, 0, 1, 2, 0, 1, 2]
        uniform token subdivisionScheme = "none"
        color3f[] primvars:displayColor = [(1, 0, 0), (0, 1, 0), (0, 0, 1)] (
            interpolation = "vertex"
        )
        float[] primvars:displayOpacity = [0.2, 0.4, 0.6] (
            interpolation = "uniform"
        )
    }
}
"#,
    )?;

    let backend = OpenusdCppBackend::new();
    let bytes = backend
        .extract_geometry_glb(&usda_path, StageLoadPolicy::LoadAll)
        .expect("extract_geometry_glb must preserve uniform opacity");
    let gltf = parse_glb_json(&bytes);

    let primitive = &gltf["meshes"][0]["primitives"][0];
    let color_accessor_idx = primitive["attributes"]["COLOR_0"]
        .as_u64()
        .expect("COLOR_0 accessor index") as usize;
    let colors = read_f32_accessor(&bytes, &gltf, color_accessor_idx);
    let alphas: Vec<f32> = colors.chunks_exact(4).map(|rgba| rgba[3]).collect();
    let expected = [0.2_f32, 0.2, 0.2, 0.4, 0.4, 0.4, 0.6, 0.6, 0.6];
    assert_eq!(
        alphas.len(),
        expected.len(),
        "three faces produce nine vertices"
    );
    for (i, (actual, expected)) in alphas.iter().zip(expected).enumerate() {
        assert!(
            (*actual - expected).abs() < 1e-5,
            "alpha[{i}] = {actual}, expected {expected}"
        );
    }

    Ok(())
}

#[test]
fn display_opacity_without_display_color_emits_white_rgba() -> std::io::Result<()> {
    let tmp_dir = std::env::temp_dir().join("yw_look_cpp_opacity_without_color");
    std::fs::create_dir_all(&tmp_dir)?;
    let usda_path = tmp_dir.join("opacity_without_color.usda");
    std::fs::write(
        &usda_path,
        r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri"
    {
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        uniform token subdivisionScheme = "none"
        float[] primvars:displayOpacity = [1, 0.5, 0.25] (
            interpolation = "vertex"
        )
    }
}
"#,
    )?;

    let backend = OpenusdCppBackend::new();
    let bytes = backend
        .extract_geometry_glb(&usda_path, StageLoadPolicy::LoadAll)
        .expect("extract_geometry_glb must emit opacity without displayColor");
    let gltf = parse_glb_json(&bytes);

    let primitive = &gltf["meshes"][0]["primitives"][0];
    let color_accessor_idx = primitive["attributes"]["COLOR_0"]
        .as_u64()
        .expect("COLOR_0 accessor index") as usize;
    let colors = read_f32_accessor(&bytes, &gltf, color_accessor_idx);
    let expected = [
        1.0_f32, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.5, 1.0, 1.0, 1.0, 0.25,
    ];
    assert_eq!(colors.len(), expected.len(), "three RGBA colors");
    for (i, (actual, expected)) in colors.iter().zip(expected).enumerate() {
        assert!(
            (*actual - expected).abs() < 1e-5,
            "COLOR_0[{i}] = {actual}, expected {expected}"
        );
    }
    let material_idx = primitive["material"]
        .as_u64()
        .expect("primitive material index") as usize;
    assert_eq!(gltf["materials"][material_idx]["alphaMode"], "BLEND");

    Ok(())
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

    assert_eq!(
        node_path_signature(&cpp_json),
        node_path_signature(&rs_json),
        "node path/name/parent signatures must agree"
    );
}

#[cfg(all(feature = "backend-openusd-cpp", feature = "backend-openusd-rs"))]
#[test]
fn light_glb_parity_with_rust_backend() -> std::io::Result<()> {
    use yw_look_lib::usd::OpenusdBackend;

    let tmp_dir = std::env::temp_dir().join("yw_look_cpp_rs_light_parity");
    std::fs::create_dir_all(&tmp_dir)?;
    let usda_path = tmp_dir.join("lights.usda");
    std::fs::write(
        &usda_path,
        r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri"
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
    }

    def DistantLight "Sun"
    {
        color3f inputs:color = (1.0, 0.95, 0.8)
        float inputs:intensity = 3.0
        float inputs:exposure = 1.0
    }

    def SphereLight "Fill"
    {
        color3f inputs:color = (0.4, 0.5, 1.0)
        float inputs:intensity = 10.0
    }
}
"#,
    )?;

    let cpp = OpenusdCppBackend::new()
        .extract_geometry_glb(&usda_path, StageLoadPolicy::LoadAll)
        .expect("cpp backend GLB");
    let rs = OpenusdBackend::new()
        .extract_geometry_glb(&usda_path, StageLoadPolicy::LoadAll)
        .expect("rust backend GLB");

    let cpp_json = parse_glb_json(&cpp);
    let rs_json = parse_glb_json(&rs);

    let cpp_signature = light_signature(&cpp_json);
    let rs_signature = light_signature(&rs_json);
    assert_eq!(cpp_signature.len(), 2, "cpp light count");
    assert_eq!(rs_signature.len(), 2, "rust light count");
    assert_eq!(cpp_signature, rs_signature);
    assert_eq!(light_node_count(&cpp_json), 2, "cpp light node count");
    assert_eq!(light_node_count(&rs_json), 2, "rust light node count");
    Ok(())
}

#[cfg(all(feature = "backend-openusd-cpp", feature = "backend-openusd-rs"))]
#[test]
fn normal_wrap_glb_parity_with_rust_backend() -> std::io::Result<()> {
    use yw_look_lib::usd::OpenusdBackend;

    let tmp_dir = std::env::temp_dir().join("yw_look_cpp_rs_normal_wrap_parity");
    std::fs::create_dir_all(&tmp_dir)?;
    let normal_path = tmp_dir.join("normal.png");
    let png_bytes: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
        0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0x99, 0x63, 0xF8,
        0xCF, 0xC0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01, 0x5C, 0xCD, 0xFF, 0x69, 0x00, 0x00, 0x00,
        0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];
    std::fs::write(&normal_path, png_bytes)?;

    let usda_path = tmp_dir.join("normal_wrap.usda");
    std::fs::write(
        &usda_path,
        r#"#usda 1.0
(
    defaultPrim = "Root"
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Tri" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
        texCoord2f[] primvars:st = [(0, 0), (1, 0), (0, 1)] (
            interpolation = "vertex"
        )
        rel material:binding = </Root/Looks/PBRMat>
    }

    def "Looks"
    {
        def Material "PBRMat"
        {
            token outputs:surface.connect = </Root/Looks/PBRMat/Preview.outputs:surface>

            def Shader "Preview"
            {
                uniform token info:id = "UsdPreviewSurface"
                normal3f inputs:normal.connect = </Root/Looks/PBRMat/NormalMap.outputs:out>
                token outputs:surface
            }

            def Shader "NormalMap"
            {
                uniform token info:id = "ND_normalmap"
                vector3f inputs:in.connect = </Root/Looks/PBRMat/NormalImage.outputs:rgb>
                normal3f outputs:out
            }

            def Shader "NormalImage"
            {
                uniform token info:id = "ND_image_vector3"
                asset inputs:file = @./normal.png@
                token inputs:wrapS = "clamp"
                token inputs:wrapT = "mirror"
                token outputs:rgb
            }
        }
    }
}
"#,
    )?;

    let cpp = OpenusdCppBackend::new()
        .extract_geometry_glb(&usda_path, StageLoadPolicy::LoadAll)
        .expect("cpp backend GLB");
    let rs = OpenusdBackend::new()
        .extract_geometry_glb(&usda_path, StageLoadPolicy::LoadAll)
        .expect("rust backend GLB");

    let cpp_json = parse_glb_json(&cpp);
    let rs_json = parse_glb_json(&rs);
    assert_eq!(normal_texture_sampler_wrap(&cpp_json), Some((33071, 33648)));
    assert_eq!(normal_texture_sampler_wrap(&rs_json), Some((33071, 33648)));
    assert_eq!(
        normal_texture_sampler_wrap(&cpp_json),
        normal_texture_sampler_wrap(&rs_json)
    );

    Ok(())
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

#[cfg(all(feature = "backend-openusd-cpp", feature = "backend-openusd-rs"))]
fn node_path_signature(gltf: &serde_json::Value) -> Vec<(String, String, Option<String>, bool)> {
    let nodes = gltf["nodes"].as_array().expect("nodes array");
    let mut parent_by_child: std::collections::HashMap<usize, usize> =
        std::collections::HashMap::new();
    for (parent_idx, node) in nodes.iter().enumerate() {
        let Some(children) = node["children"].as_array() else {
            continue;
        };
        for child in children {
            parent_by_child.insert(child.as_u64().expect("child index") as usize, parent_idx);
        }
    }

    let mut signature: Vec<(String, String, Option<String>, bool)> = nodes
        .iter()
        .enumerate()
        .filter_map(|(idx, node)| {
            let prim_path = node["extras"]["primPath"].as_str()?;
            let parent_prim_path = parent_by_child
                .get(&idx)
                .and_then(|parent_idx| nodes[*parent_idx]["extras"]["primPath"].as_str())
                .map(str::to_string);
            Some((
                prim_path.to_string(),
                node["name"].as_str().unwrap_or_default().to_string(),
                parent_prim_path,
                node.get("mesh").is_some(),
            ))
        })
        .collect();
    signature.sort();
    signature
}

#[cfg(all(feature = "backend-openusd-cpp", feature = "backend-openusd-rs"))]
fn normal_texture_sampler_wrap(gltf: &serde_json::Value) -> Option<(u64, u64)> {
    let materials = gltf["materials"].as_array()?;
    let material = materials.iter().find(|m| {
        m.get("normalTexture")
            .and_then(|t| t.get("index"))
            .is_some()
    })?;
    let texture_idx = material["normalTexture"]["index"].as_u64()? as usize;
    let sampler_idx = gltf["textures"][texture_idx]["sampler"].as_u64()? as usize;
    let sampler = &gltf["samplers"][sampler_idx];
    Some((sampler["wrapS"].as_u64()?, sampler["wrapT"].as_u64()?))
}

#[cfg(all(feature = "backend-openusd-cpp", feature = "backend-openusd-rs"))]
fn light_signature(gltf: &serde_json::Value) -> Vec<(String, i64, [i64; 3])> {
    let mut signature: Vec<(String, i64, [i64; 3])> = gltf["extensions"]
        .get("KHR_lights_punctual")
        .and_then(|ext| ext.get("lights"))
        .and_then(|lights| lights.as_array())
        .expect("KHR_lights_punctual.lights")
        .iter()
        .map(|light| {
            let color = light["color"].as_array().expect("light color");
            (
                light["type"].as_str().expect("light type").to_string(),
                ((light["intensity"].as_f64().expect("light intensity")) * 1_000_000.0).round()
                    as i64,
                [
                    (color[0].as_f64().expect("red") * 1_000_000.0).round() as i64,
                    (color[1].as_f64().expect("green") * 1_000_000.0).round() as i64,
                    (color[2].as_f64().expect("blue") * 1_000_000.0).round() as i64,
                ],
            )
        })
        .collect();
    signature.sort();
    signature
}

#[cfg(all(feature = "backend-openusd-cpp", feature = "backend-openusd-rs"))]
fn light_node_count(gltf: &serde_json::Value) -> usize {
    gltf["nodes"]
        .as_array()
        .expect("nodes array")
        .iter()
        .filter(|node| {
            node.get("extensions")
                .and_then(|extensions| extensions.get("KHR_lights_punctual"))
                .is_some()
        })
        .count()
}
