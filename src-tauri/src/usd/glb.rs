//! Minimal GLB writer used by Phase 3's USDC → Three.js geometry pipeline.
//!
//! Takes already-triangulated, per-vertex mesh data and produces a self-
//! contained GLB binary that `GLTFLoader.parseAsync` can consume on the
//! frontend. Phase 5a widens the surface to per-mesh PBR materials so the
//! UsdPreviewSurface integration can light scenes correctly; callers pass
//! a flat list of `MaterialInput`s and a `material_index` on each mesh.
//! The legacy "single default material" behavior is a one-element
//! `materials` array with `material_index = 0`.
//!
//! The caller (currently `OpenusdBackend`) is responsible for:
//!   - triangulating quads / n-gons (we only accept triangle indices)
//!   - expanding face-varying normals / UVs to per-vertex form
//!   - composing world-space transforms (the `world_matrix` field is the
//!     final composed transform applied as a node matrix)
//!   - resolving UsdPreviewSurface inputs into `MaterialInput` scalars

use serde_json::{json, Value};

/// PBR material slot referenced from one or more `MeshInput`s. All
/// fields have GLTF-compatible defaults so callers can omit unauthored
/// inputs. Phase 5c adds optional `base_color_texture` so a
/// `UsdPreviewSurface` whose `inputs:diffuseColor` is connected to a
/// `UsdUVTexture` shows up with its actual texture in the preview.
#[derive(Debug, Clone)]
pub struct MaterialInput {
    /// Display name attached to the GLTF material object. Free-form.
    pub name: String,
    /// RGBA base color factor. Default `[0.7, 0.7, 0.7, 1.0]` matches
    /// the pre-Phase-5a default material so unauthored meshes keep
    /// their look.
    pub base_color_factor: [f32; 4],
    /// 0.0 – 1.0. Default `0.0`.
    pub metallic_factor: f32,
    /// 0.0 – 1.0. Default `0.9`.
    pub roughness_factor: f32,
    /// Linear RGB emissive color. Default `[0.0, 0.0, 0.0]`.
    pub emissive_factor: [f32; 3],
    /// GLTF `doubleSided` flag. USD Mesh orientation metadata is baked
    /// into the triangulator winding so the default is `true`.
    pub double_sided: bool,
    /// Phase 5c: optional base color (sRGB) texture to embed in the GLB
    /// BIN chunk. `None` keeps the legacy "no texture, factor only"
    /// behavior. The actual byte payload + MIME type live in
    /// `BuildContext::textures` keyed by the index stored here so the
    /// builder can dedupe textures across materials.
    pub base_color_texture: Option<usize>,
}

impl MaterialInput {
    /// The default material yw-look used before Phase 5a introduced
    /// per-mesh MaterialInput. Kept so simple callers can avoid
    /// threading a materials array through when they only want the
    /// legacy "neutral grey" preview look.
    pub fn default_preview() -> Self {
        Self {
            name: "yw_look_default".to_string(),
            base_color_factor: [0.7, 0.7, 0.7, 1.0],
            metallic_factor: 0.0,
            roughness_factor: 0.9,
            emissive_factor: [0.0, 0.0, 0.0],
            double_sided: true,
            base_color_texture: None,
        }
    }
}

/// One image to embed in the GLB binary chunk and reference from a
/// material as a `baseColorTexture`. The builder pads the BIN chunk
/// for alignment and writes a single `images[i]` + `textures[i]` +
/// `samplers[0]` triple per `TextureInput`.
#[derive(Debug, Clone)]
pub struct TextureInput {
    /// Display name attached to the glTF image / texture. Free-form;
    /// usually the source asset path.
    pub name: String,
    /// glTF MIME type, must be `"image/png"` or `"image/jpeg"`.
    /// Anything else is rejected at validation time.
    pub mime_type: String,
    /// Raw image bytes (PNG or JPEG file content as it would land on
    /// disk).
    pub data: Vec<u8>,
}

/// One mesh ready to be packed into a GLB. Positions / normals / UVs are
/// per-vertex; `indices` describes triangles into those arrays.
#[derive(Debug, Clone)]
pub struct MeshInput {
    /// Display name attached to the GLTF node and mesh. Free-form.
    pub name: String,
    /// Column-major 4x4 world transform applied as a node `matrix`.
    pub world_matrix: [f32; 16],
    /// Vertex positions, length must be a multiple of 3.
    pub positions: Vec<f32>,
    /// Triangle indices into the per-vertex arrays. Length must be a
    /// multiple of 3.
    pub indices: Vec<u32>,
    /// Optional vertex normals, same vertex count as `positions`.
    pub normals: Option<Vec<f32>>,
    /// Optional UV coordinates, length = vertex_count * 2.
    pub uvs: Option<Vec<f32>>,
    /// Index into the `materials` array passed to `build_glb`. Every
    /// mesh must reference a valid material; use `0` when the caller
    /// only supplies a single default material.
    pub material_index: usize,
}

impl MeshInput {
    fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }

    fn validate(&self) -> Result<(), String> {
        if self.positions.is_empty() {
            return Err(format!("mesh '{}' has no positions", self.name));
        }
        if self.positions.len() % 3 != 0 {
            return Err(format!(
                "mesh '{}' positions length {} is not a multiple of 3",
                self.name,
                self.positions.len()
            ));
        }
        if self.indices.len() % 3 != 0 {
            return Err(format!(
                "mesh '{}' index count {} is not a multiple of 3",
                self.name,
                self.indices.len()
            ));
        }
        let vc = self.vertex_count();
        if let Some(n) = &self.normals {
            if n.len() != vc * 3 {
                return Err(format!(
                    "mesh '{}' has {} normal floats but {} are required",
                    self.name,
                    n.len(),
                    vc * 3
                ));
            }
        }
        if let Some(uv) = &self.uvs {
            if uv.len() != vc * 2 {
                return Err(format!(
                    "mesh '{}' has {} uv floats but {} are required",
                    self.name,
                    uv.len(),
                    vc * 2
                ));
            }
        }
        for &i in &self.indices {
            if (i as usize) >= vc {
                return Err(format!(
                    "mesh '{}' index {} out of range (vertex count {})",
                    self.name, i, vc
                ));
            }
        }
        Ok(())
    }

    fn position_bounds(&self) -> ([f32; 3], [f32; 3]) {
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for chunk in self.positions.chunks_exact(3) {
            for axis in 0..3 {
                if chunk[axis] < min[axis] {
                    min[axis] = chunk[axis];
                }
                if chunk[axis] > max[axis] {
                    max[axis] = chunk[axis];
                }
            }
        }
        (min, max)
    }
}

const GLB_MAGIC: u32 = 0x46546C67; // "glTF"
const GLB_VERSION: u32 = 2;
const CHUNK_TYPE_JSON: u32 = 0x4E4F534A; // "JSON"
const CHUNK_TYPE_BIN: u32 = 0x004E4942; // "BIN\0"

const COMPONENT_TYPE_FLOAT: u32 = 5126;
const COMPONENT_TYPE_UNSIGNED_INT: u32 = 5125;

/// Build a GLB binary from a list of meshes, materials, and textures.
/// Returns the GLB byte stream ready to send via
/// `tauri::ipc::Response`.
///
/// `materials` must be non-empty and every `MeshInput.material_index`
/// must point into it. Texture references on `MaterialInput` index
/// into the `textures` slice — `MaterialInput::base_color_texture =
/// Some(i)` means "use `textures[i]` as the sRGB base color sampler".
/// Pass an empty `textures` slice when no material uses one.
pub fn build_glb(
    meshes: &[MeshInput],
    materials: &[MaterialInput],
    textures: &[TextureInput],
) -> Result<Vec<u8>, String> {
    if meshes.is_empty() {
        return Err("no meshes to export".to_string());
    }
    if materials.is_empty() {
        return Err("at least one material is required".to_string());
    }
    for (i, m) in meshes.iter().enumerate() {
        if m.material_index >= materials.len() {
            return Err(format!(
                "mesh[{i}] '{}' references material_index {} but only {} materials were supplied",
                m.name,
                m.material_index,
                materials.len()
            ));
        }
    }
    for (i, m) in materials.iter().enumerate() {
        if let Some(tex_idx) = m.base_color_texture {
            if tex_idx >= textures.len() {
                return Err(format!(
                    "material[{i}] '{}' references base_color_texture {} but only {} textures were supplied",
                    m.name,
                    tex_idx,
                    textures.len()
                ));
            }
        }
    }
    for (i, t) in textures.iter().enumerate() {
        if t.data.is_empty() {
            return Err(format!(
                "texture[{i}] '{}' has empty image data",
                t.name
            ));
        }
        if t.mime_type != "image/png" && t.mime_type != "image/jpeg" {
            return Err(format!(
                "texture[{i}] '{}' has unsupported mimeType '{}'; expected image/png or image/jpeg",
                t.name, t.mime_type
            ));
        }
    }
    for m in meshes {
        m.validate()?;
    }

    // ---- Layout the binary buffer ---------------------------------------
    //
    // GLTF accessors require the underlying buffer view to be aligned to
    // the size of the component. Floats (4 bytes) and u32 indices (4 bytes)
    // both need 4-byte alignment, so we pad each section to 4 bytes.

    let mut bin: Vec<u8> = Vec::new();
    let mut buffer_views: Vec<Value> = Vec::new();
    let mut accessors: Vec<Value> = Vec::new();
    let mut gltf_meshes: Vec<Value> = Vec::new();
    let mut nodes: Vec<Value> = Vec::new();
    let mut scene_nodes: Vec<Value> = Vec::new();

    for (mesh_idx, mesh) in meshes.iter().enumerate() {
        let vertex_count = mesh.vertex_count() as u64;
        let index_count = mesh.indices.len() as u64;

        // -- positions ---------------------------------------------------
        let pos_offset = bin.len() as u64;
        for &v in &mesh.positions {
            bin.extend_from_slice(&v.to_le_bytes());
        }
        let pos_byte_length = (bin.len() as u64) - pos_offset;
        pad_to_4(&mut bin);

        let position_view_idx = buffer_views.len();
        buffer_views.push(json!({
            "buffer": 0,
            "byteOffset": pos_offset,
            "byteLength": pos_byte_length,
            "target": 34962, // ARRAY_BUFFER
        }));

        let (pmin, pmax) = mesh.position_bounds();
        let position_accessor_idx = accessors.len();
        accessors.push(json!({
            "bufferView": position_view_idx,
            "componentType": COMPONENT_TYPE_FLOAT,
            "count": vertex_count,
            "type": "VEC3",
            "min": [pmin[0], pmin[1], pmin[2]],
            "max": [pmax[0], pmax[1], pmax[2]],
        }));

        // -- normals (optional) ------------------------------------------
        let normal_accessor_idx = if let Some(normals) = &mesh.normals {
            let off = bin.len() as u64;
            for &v in normals {
                bin.extend_from_slice(&v.to_le_bytes());
            }
            let len = (bin.len() as u64) - off;
            pad_to_4(&mut bin);

            let view_idx = buffer_views.len();
            buffer_views.push(json!({
                "buffer": 0,
                "byteOffset": off,
                "byteLength": len,
                "target": 34962,
            }));
            let acc_idx = accessors.len();
            accessors.push(json!({
                "bufferView": view_idx,
                "componentType": COMPONENT_TYPE_FLOAT,
                "count": vertex_count,
                "type": "VEC3",
            }));
            Some(acc_idx)
        } else {
            None
        };

        // -- uvs (optional) ----------------------------------------------
        let uv_accessor_idx = if let Some(uvs) = &mesh.uvs {
            let off = bin.len() as u64;
            for &v in uvs {
                bin.extend_from_slice(&v.to_le_bytes());
            }
            let len = (bin.len() as u64) - off;
            pad_to_4(&mut bin);

            let view_idx = buffer_views.len();
            buffer_views.push(json!({
                "buffer": 0,
                "byteOffset": off,
                "byteLength": len,
                "target": 34962,
            }));
            let acc_idx = accessors.len();
            accessors.push(json!({
                "bufferView": view_idx,
                "componentType": COMPONENT_TYPE_FLOAT,
                "count": vertex_count,
                "type": "VEC2",
            }));
            Some(acc_idx)
        } else {
            None
        };

        // -- indices -----------------------------------------------------
        let idx_offset = bin.len() as u64;
        for &i in &mesh.indices {
            bin.extend_from_slice(&i.to_le_bytes());
        }
        let idx_byte_length = (bin.len() as u64) - idx_offset;
        pad_to_4(&mut bin);

        let index_view_idx = buffer_views.len();
        buffer_views.push(json!({
            "buffer": 0,
            "byteOffset": idx_offset,
            "byteLength": idx_byte_length,
            "target": 34963, // ELEMENT_ARRAY_BUFFER
        }));
        let index_accessor_idx = accessors.len();
        accessors.push(json!({
            "bufferView": index_view_idx,
            "componentType": COMPONENT_TYPE_UNSIGNED_INT,
            "count": index_count,
            "type": "SCALAR",
        }));

        // -- mesh primitive ----------------------------------------------
        let mut attributes = serde_json::Map::new();
        attributes.insert("POSITION".to_string(), json!(position_accessor_idx));
        if let Some(idx) = normal_accessor_idx {
            attributes.insert("NORMAL".to_string(), json!(idx));
        }
        if let Some(idx) = uv_accessor_idx {
            attributes.insert("TEXCOORD_0".to_string(), json!(idx));
        }

        let mesh_idx_in_doc = gltf_meshes.len();
        gltf_meshes.push(json!({
            "name": mesh.name,
            "primitives": [{
                "attributes": Value::Object(attributes),
                "indices": index_accessor_idx,
                "material": mesh.material_index,
                "mode": 4, // TRIANGLES
            }],
        }));

        // -- node --------------------------------------------------------
        let node_idx = nodes.len();
        nodes.push(json!({
            "name": format!("{}_node", mesh.name),
            "mesh": mesh_idx_in_doc,
            "matrix": mesh.world_matrix.iter().copied().collect::<Vec<f32>>(),
        }));
        scene_nodes.push(json!(node_idx));

        let _ = mesh_idx; // silence unused if compiler complains
    }

    // ---- Embed textures into the BIN chunk -----------------------------
    //
    // Each TextureInput becomes one bufferView (containing the raw
    // PNG/JPEG bytes), one image (referencing that bufferView with the
    // declared mimeType), and one texture (referencing the image and
    // a single shared sampler with the glTF defaults). Materials then
    // index into the textures array via `pbrMetallicRoughness.baseColorTexture`.
    let mut gltf_images: Vec<Value> = Vec::with_capacity(textures.len());
    let mut gltf_textures: Vec<Value> = Vec::with_capacity(textures.len());
    for tex in textures {
        let off = bin.len() as u64;
        bin.extend_from_slice(&tex.data);
        let len = (bin.len() as u64) - off;
        pad_to_4(&mut bin);

        let view_idx = buffer_views.len();
        buffer_views.push(json!({
            "buffer": 0,
            "byteOffset": off,
            "byteLength": len,
        }));
        let image_idx = gltf_images.len();
        gltf_images.push(json!({
            "name": tex.name,
            "mimeType": tex.mime_type,
            "bufferView": view_idx,
        }));
        gltf_textures.push(json!({
            "source": image_idx,
            "sampler": 0,
        }));
    }

    // ---- Build GLTF materials array ------------------------------------
    let gltf_materials: Vec<Value> = materials
        .iter()
        .map(|m| {
            let mut pbr = json!({
                "baseColorFactor": [
                    m.base_color_factor[0],
                    m.base_color_factor[1],
                    m.base_color_factor[2],
                    m.base_color_factor[3],
                ],
                "metallicFactor": m.metallic_factor,
                "roughnessFactor": m.roughness_factor,
            });
            if let Some(tex_idx) = m.base_color_texture {
                pbr["baseColorTexture"] = json!({
                    "index": tex_idx,
                    "texCoord": 0,
                });
            }
            let mut material = json!({
                "name": m.name,
                "pbrMetallicRoughness": pbr,
                "doubleSided": m.double_sided,
            });
            // Only emit `emissiveFactor` when non-zero so the GLB stays
            // minimal for the (common) no-emission case.
            let emissive = m.emissive_factor;
            if emissive[0] > 0.0 || emissive[1] > 0.0 || emissive[2] > 0.0 {
                material["emissiveFactor"] =
                    json!([emissive[0], emissive[1], emissive[2]]);
            }
            // glTF's default `alphaMode` is OPAQUE, which means the
            // alpha channel of baseColorFactor is ignored and the
            // object always renders fully opaque. `UsdPreviewSurface`'s
            // `inputs:opacity` flows into `base_color_factor[3]`, so
            // whenever that value is below 1 we need `BLEND` mode for
            // the preview to actually look translucent. A small
            // epsilon avoids flipping modes on floating-point noise
            // around 1.0.
            if m.base_color_factor[3] < 1.0 - 1e-4 {
                material["alphaMode"] = json!("BLEND");
            }
            material
        })
        .collect();

    // ---- Build GLTF JSON document --------------------------------------
    let total_bin_length = bin.len() as u64;

    let mut document = json!({
        "asset": {
            "version": "2.0",
            "generator": "yw-look usd-phase5c",
        },
        "scene": 0,
        "scenes": [{ "nodes": scene_nodes }],
        "nodes": nodes,
        "meshes": gltf_meshes,
        "buffers": [{ "byteLength": total_bin_length }],
        "bufferViews": buffer_views,
        "accessors": accessors,
        "materials": gltf_materials,
    });
    if !textures.is_empty() {
        // Single shared sampler with glTF defaults: linear mip-mapping +
        // repeat wrap. Matches what UsdUVTexture authors usually expect
        // unless they explicitly override `wrapS` / `wrapT`, which
        // Phase 5c doesn't surface yet (Phase 5d candidate).
        document["images"] = Value::Array(gltf_images);
        document["textures"] = Value::Array(gltf_textures);
        document["samplers"] = json!([{
            "magFilter": 9729, // LINEAR
            "minFilter": 9987, // LINEAR_MIPMAP_LINEAR
            "wrapS": 10497,    // REPEAT
            "wrapT": 10497,    // REPEAT
        }]);
    }

    let mut json_bytes = serde_json::to_vec(&document)
        .map_err(|e| format!("failed to serialize GLTF JSON: {e}"))?;
    pad_chunk(&mut json_bytes, 0x20); // ASCII space for JSON chunk
    pad_chunk(&mut bin, 0x00); // zeros for BIN chunk

    // ---- Stitch GLB binary container -----------------------------------
    let json_chunk_len = json_bytes.len() as u32;
    let bin_chunk_len = bin.len() as u32;
    // 12 byte header + 8 byte chunk header + JSON + 8 byte chunk header + BIN
    let total_length: u32 = 12 + 8 + json_chunk_len + 8 + bin_chunk_len;

    let mut out = Vec::with_capacity(total_length as usize);
    out.extend_from_slice(&GLB_MAGIC.to_le_bytes());
    out.extend_from_slice(&GLB_VERSION.to_le_bytes());
    out.extend_from_slice(&total_length.to_le_bytes());

    out.extend_from_slice(&json_chunk_len.to_le_bytes());
    out.extend_from_slice(&CHUNK_TYPE_JSON.to_le_bytes());
    out.extend_from_slice(&json_bytes);

    out.extend_from_slice(&bin_chunk_len.to_le_bytes());
    out.extend_from_slice(&CHUNK_TYPE_BIN.to_le_bytes());
    out.extend_from_slice(&bin);

    debug_assert_eq!(out.len() as u32, total_length);
    Ok(out)
}

fn pad_to_4(buf: &mut Vec<u8>) {
    while buf.len() % 4 != 0 {
        buf.push(0);
    }
}

fn pad_chunk(buf: &mut Vec<u8>, byte: u8) {
    while buf.len() % 4 != 0 {
        buf.push(byte);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity_matrix() -> [f32; 16] {
        [
            1.0, 0.0, 0.0, 0.0, //
            0.0, 1.0, 0.0, 0.0, //
            0.0, 0.0, 1.0, 0.0, //
            0.0, 0.0, 0.0, 1.0,
        ]
    }

    fn unit_quad_split_into_two_triangles() -> MeshInput {
        // 4 vertices forming a unit quad in the XY plane
        // (0,0,0), (1,0,0), (1,1,0), (0,1,0)
        MeshInput {
            name: "quad".to_string(),
            world_matrix: identity_matrix(),
            positions: vec![
                0.0, 0.0, 0.0, //
                1.0, 0.0, 0.0, //
                1.0, 1.0, 0.0, //
                0.0, 1.0, 0.0,
            ],
            indices: vec![0, 1, 2, 0, 2, 3],
            normals: Some(vec![
                0.0, 0.0, 1.0, //
                0.0, 0.0, 1.0, //
                0.0, 0.0, 1.0, //
                0.0, 0.0, 1.0,
            ]),
            uvs: Some(vec![
                0.0, 0.0, //
                1.0, 0.0, //
                1.0, 1.0, //
                0.0, 1.0,
            ]),
            material_index: 0,
        }
    }

    fn default_materials() -> Vec<MaterialInput> {
        vec![MaterialInput::default_preview()]
    }

    #[test]
    fn build_glb_roundtrips_a_unit_quad() {
        let mesh = unit_quad_split_into_two_triangles();
        let glb = build_glb(&[mesh], &default_materials(), &[]).expect("build glb");

        // GLB header sanity check
        assert_eq!(&glb[0..4], b"glTF");
        let version = u32::from_le_bytes(glb[4..8].try_into().unwrap());
        assert_eq!(version, 2);
        let total_length = u32::from_le_bytes(glb[8..12].try_into().unwrap());
        assert_eq!(total_length as usize, glb.len());

        // First chunk should be JSON
        let json_chunk_len =
            u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_chunk_type = u32::from_le_bytes(glb[16..20].try_into().unwrap());
        assert_eq!(json_chunk_type, CHUNK_TYPE_JSON);
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .expect("json chunk is utf8")
            .trim_end_matches(' ');
        let doc: serde_json::Value =
            serde_json::from_str(json_text).expect("json chunk parses");
        assert_eq!(doc["asset"]["version"], "2.0");
        assert_eq!(doc["meshes"][0]["primitives"][0]["mode"], 4);
        assert_eq!(doc["accessors"].as_array().unwrap().len(), 4); // pos + normal + uv + idx

        // Second chunk should be BIN, containing 4*3*4 (positions) +
        // 4*3*4 (normals) + 4*2*4 (uvs) + 6*4 (indices) = 48 + 48 + 32 + 24 = 152
        // possibly padded.
        let bin_chunk_offset = json_end;
        let bin_chunk_len =
            u32::from_le_bytes(glb[bin_chunk_offset..bin_chunk_offset + 4].try_into().unwrap())
                as usize;
        let bin_chunk_type = u32::from_le_bytes(
            glb[bin_chunk_offset + 4..bin_chunk_offset + 8].try_into().unwrap(),
        );
        assert_eq!(bin_chunk_type, CHUNK_TYPE_BIN);
        assert!(bin_chunk_len >= 152, "bin chunk too small: {bin_chunk_len}");
    }

    #[test]
    fn rejects_mismatched_normal_count() {
        let mut mesh = unit_quad_split_into_two_triangles();
        mesh.normals = Some(vec![0.0; 6]); // wrong length
        let err = build_glb(&[mesh], &default_materials(), &[]).unwrap_err();
        assert!(err.contains("normal"));
    }

    #[test]
    fn rejects_out_of_range_index() {
        let mut mesh = unit_quad_split_into_two_triangles();
        mesh.indices = vec![0, 1, 99];
        let err = build_glb(&[mesh], &default_materials(), &[]).unwrap_err();
        assert!(err.contains("out of range"));
    }

    #[test]
    fn rejects_material_index_out_of_range() {
        let mut mesh = unit_quad_split_into_two_triangles();
        mesh.material_index = 5;
        let err = build_glb(&[mesh], &default_materials(), &[]).unwrap_err();
        assert!(
            err.contains("material_index"),
            "expected material_index error, got: {err}"
        );
    }

    #[test]
    fn rejects_empty_materials_array() {
        let mesh = unit_quad_split_into_two_triangles();
        let err = build_glb(&[mesh], &[], &[]).unwrap_err();
        assert!(err.contains("material"));
    }

    #[test]
    fn emits_alpha_mode_blend_for_translucent_material() {
        let mesh = unit_quad_split_into_two_triangles();
        let materials = vec![MaterialInput {
            name: "glass".to_string(),
            base_color_factor: [0.2, 0.5, 0.9, 0.4],
            metallic_factor: 0.0,
            roughness_factor: 0.1,
            emissive_factor: [0.0, 0.0, 0.0],
            double_sided: true,
            base_color_texture: None,
        }];
        let glb = build_glb(&[mesh], &materials, &[]).expect("build glb");

        let json_chunk_len =
            u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        assert_eq!(doc["materials"][0]["alphaMode"], "BLEND");
    }

    #[test]
    fn omits_alpha_mode_for_opaque_material() {
        let mesh = unit_quad_split_into_two_triangles();
        let materials = vec![MaterialInput::default_preview()];
        let glb = build_glb(&[mesh], &materials, &[]).expect("build glb");

        let json_chunk_len =
            u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        // Default alphaMode is OPAQUE, so we deliberately omit the
        // field rather than writing "OPAQUE" explicitly — a minor
        // size + review-noise win.
        assert!(doc["materials"][0].get("alphaMode").is_none());
    }

    #[test]
    fn emits_multiple_materials_with_custom_factors() {
        // Two meshes referencing two different material slots — verify
        // the GLTF JSON carries both materials with their authored
        // factors, and that each mesh primitive points at the right
        // index. This covers the Phase 5a plumbing end-to-end without
        // needing a USD stage.
        let mut red_mesh = unit_quad_split_into_two_triangles();
        red_mesh.name = "red".to_string();
        red_mesh.material_index = 0;
        let mut blue_mesh = unit_quad_split_into_two_triangles();
        blue_mesh.name = "blue".to_string();
        blue_mesh.material_index = 1;

        let materials = vec![
            MaterialInput {
                name: "red".to_string(),
                base_color_factor: [1.0, 0.2, 0.2, 1.0],
                metallic_factor: 0.1,
                roughness_factor: 0.4,
                emissive_factor: [0.0, 0.0, 0.0],
                double_sided: false,
                base_color_texture: None,
            },
            MaterialInput {
                name: "blue_emissive".to_string(),
                base_color_factor: [0.1, 0.2, 0.9, 1.0],
                metallic_factor: 0.8,
                roughness_factor: 0.2,
                emissive_factor: [0.0, 0.0, 0.4],
                double_sided: true,
                base_color_texture: None,
            },
        ];

        let glb = build_glb(&[red_mesh, blue_mesh], &materials, &[]).expect("build glb");
        assert_eq!(&glb[0..4], b"glTF");

        let json_chunk_len =
            u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_start = 20;
        let json_end = json_start + json_chunk_len;
        let json_text = std::str::from_utf8(&glb[json_start..json_end])
            .unwrap()
            .trim_end_matches(' ');
        let doc: serde_json::Value = serde_json::from_str(json_text).unwrap();

        let materials_arr = doc["materials"].as_array().expect("materials array");
        assert_eq!(materials_arr.len(), 2);
        assert_eq!(materials_arr[0]["name"], "red");
        let base = materials_arr[0]["pbrMetallicRoughness"]["baseColorFactor"]
            .as_array()
            .expect("baseColorFactor array");
        let expected_red = [1.0_f64, 0.2, 0.2, 1.0];
        for (i, component) in base.iter().enumerate() {
            let v = component.as_f64().expect("factor is number");
            assert!(
                (v - expected_red[i]).abs() < 1e-5,
                "baseColorFactor[{i}] = {v}, expected {}",
                expected_red[i]
            );
        }
        assert!(
            materials_arr[0].get("emissiveFactor").is_none(),
            "zero emissive should be omitted"
        );
        assert_eq!(materials_arr[1]["name"], "blue_emissive");
        assert_eq!(materials_arr[1]["doubleSided"], true);
        let emissive = materials_arr[1]["emissiveFactor"]
            .as_array()
            .expect("emissiveFactor array");
        let expected_emissive = [0.0_f64, 0.0, 0.4];
        for (i, component) in emissive.iter().enumerate() {
            let v = component.as_f64().expect("emissive component");
            assert!(
                (v - expected_emissive[i]).abs() < 1e-5,
                "emissiveFactor[{i}] = {v}",
            );
        }

        let meshes_arr = doc["meshes"].as_array().expect("meshes array");
        assert_eq!(meshes_arr[0]["primitives"][0]["material"], 0);
        assert_eq!(meshes_arr[1]["primitives"][0]["material"], 1);
    }
}
