//! Minimal GLB writer used by Phase 3's USDC → Three.js geometry pipeline.
//!
//! Takes already-triangulated, per-vertex mesh data and produces a self-
//! contained GLB binary that `GLTFLoader.parseAsync` can consume on the
//! frontend. Material support is intentionally minimal — every mesh shares
//! a single default PBR material. UsdPreviewSurface integration is a
//! Phase 5 concern.
//!
//! The caller (currently `OpenusdBackend`) is responsible for:
//!   - triangulating quads / n-gons (we only accept triangle indices)
//!   - expanding face-varying normals / UVs to per-vertex form
//!   - composing world-space transforms (the `world_matrix` field is the
//!     final composed transform applied as a node matrix)

use serde_json::{json, Value};

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

/// Build a GLB binary from a list of meshes. Returns the GLB byte stream
/// ready to send via `tauri::ipc::Response`.
pub fn build_glb(meshes: &[MeshInput]) -> Result<Vec<u8>, String> {
    if meshes.is_empty() {
        return Err("no meshes to export".to_string());
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
                "material": 0,
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

    // ---- Build GLTF JSON document --------------------------------------
    let total_bin_length = bin.len() as u64;

    let document = json!({
        "asset": {
            "version": "2.0",
            "generator": "yw-look usd-phase3",
        },
        "scene": 0,
        "scenes": [{ "nodes": scene_nodes }],
        "nodes": nodes,
        "meshes": gltf_meshes,
        "buffers": [{ "byteLength": total_bin_length }],
        "bufferViews": buffer_views,
        "accessors": accessors,
        "materials": [{
            "name": "yw_look_default",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.7, 0.7, 0.7, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.9,
            },
            "doubleSided": true,
        }],
    });

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
        }
    }

    #[test]
    fn build_glb_roundtrips_a_unit_quad() {
        let mesh = unit_quad_split_into_two_triangles();
        let glb = build_glb(&[mesh]).expect("build glb");

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
        let err = build_glb(&[mesh]).unwrap_err();
        assert!(err.contains("normal"));
    }

    #[test]
    fn rejects_out_of_range_index() {
        let mut mesh = unit_quad_split_into_two_triangles();
        mesh.indices = vec![0, 1, 99];
        let err = build_glb(&[mesh]).unwrap_err();
        assert!(err.contains("out of range"));
    }
}
