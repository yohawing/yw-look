//! Format-neutral binary glTF writer used by native preview importers.
//!
//! This deliberately owns only glTF/GLB mechanics. Source-format semantics
//! (FBX pivots, USD purposes, and so on) stay in their adapters.

use serde_json::{json, Map, Value};

use crate::error::AppError;

pub(crate) const GLB_MAGIC: u32 = 0x4654_6c67;
pub(crate) const GLB_VERSION: u32 = 2;
pub(crate) const JSON_CHUNK: u32 = 0x4e4f_534a;
pub(crate) const BIN_CHUNK: u32 = 0x004e_4942;

const GLB_HEADER_LEN: usize = 12;
const GLB_CHUNK_HEADER_LEN: usize = 8;

fn checked_padded_chunk_len(length: usize) -> Result<usize, String> {
    let padding = (4 - length % 4) % 4;
    length
        .checked_add(padding)
        .ok_or_else(|| "GLB chunk size overflow".to_string())
}

pub(crate) fn checked_glb_container_lengths(
    json_length: usize,
    bin_length: usize,
) -> Result<(usize, usize, usize), String> {
    let json_length = checked_padded_chunk_len(json_length)?;
    let bin_length = checked_padded_chunk_len(bin_length)?;
    let max_u32 = u32::MAX as usize;
    if json_length > max_u32 {
        return Err("GLB JSON chunk exceeds u32 range".to_string());
    }
    if bin_length > max_u32 {
        return Err("GLB BIN chunk exceeds u32 range".to_string());
    }
    let total_length = GLB_HEADER_LEN
        .checked_add(GLB_CHUNK_HEADER_LEN)
        .and_then(|length| length.checked_add(json_length))
        .and_then(|length| length.checked_add(GLB_CHUNK_HEADER_LEN))
        .and_then(|length| length.checked_add(bin_length))
        .ok_or_else(|| "GLB total size overflow".to_string())?;
    if total_length > max_u32 {
        return Err("GLB exceeds u32 container range".to_string());
    }
    Ok((json_length, bin_length, total_length))
}

pub(crate) fn checked_binary_byte_length(
    element_count: usize,
    element_size: usize,
) -> Result<usize, String> {
    element_count
        .checked_mul(element_size)
        .ok_or_else(|| "GLB binary section size overflow".to_string())
}

pub(crate) fn append_buffer_view_with<F>(
    binary: &mut Vec<u8>,
    buffer_views: &mut Vec<Value>,
    byte_length: usize,
    target: Option<u32>,
    write: F,
) -> Result<usize, String>
where
    F: FnOnce(&mut Vec<u8>),
{
    let padding = (4 - binary.len() % 4) % 4;
    let byte_offset = binary.len();
    let end = byte_offset
        .checked_add(padding)
        .and_then(|offset| offset.checked_add(byte_length))
        .ok_or_else(|| "GLB binary size overflow".to_string())?;
    if end > u32::MAX as usize {
        return Err("GLB binary chunk exceeds u32 range".to_string());
    }
    let padded_end = checked_padded_chunk_len(end)?;
    if padded_end > u32::MAX as usize {
        return Err("GLB binary chunk exceeds u32 range".to_string());
    }

    binary.resize(byte_offset + padding, 0);
    binary.reserve(byte_length);
    write(binary);
    if binary.len() != end {
        binary.truncate(byte_offset);
        return Err("GLB binary section length mismatch".to_string());
    }
    binary.resize(padded_end, 0);

    let mut view = json!({
        "buffer": 0,
        "byteOffset": byte_offset + padding,
        "byteLength": byte_length,
    });
    if let Some(target) = target {
        view["target"] = json!(target);
    }
    let index = buffer_views.len();
    buffer_views.push(view);
    Ok(index)
}

pub(crate) struct AccessorSpec<'a> {
    pub(crate) target: Option<u32>,
    pub(crate) component_type: u32,
    pub(crate) count: usize,
    pub(crate) type_name: &'a str,
    pub(crate) normalized: bool,
    pub(crate) byte_offset: Option<usize>,
    pub(crate) min: Option<Value>,
    pub(crate) max: Option<Value>,
}

pub(crate) fn append_accessor_with<F>(
    binary: &mut Vec<u8>,
    buffer_views: &mut Vec<Value>,
    accessors: &mut Vec<Value>,
    byte_length: usize,
    spec: AccessorSpec<'_>,
    write: F,
) -> Result<usize, String>
where
    F: FnOnce(&mut Vec<u8>),
{
    if spec.count > u32::MAX as usize {
        return Err("GLB accessor count exceeds u32 range".to_string());
    }
    let view = append_buffer_view_with(binary, buffer_views, byte_length, spec.target, write)?;
    let mut accessor = Map::new();
    accessor.insert("bufferView".into(), json!(view));
    if let Some(byte_offset) = spec.byte_offset {
        accessor.insert("byteOffset".into(), json!(byte_offset));
    }
    accessor.insert("componentType".into(), json!(spec.component_type));
    accessor.insert("count".into(), json!(spec.count));
    accessor.insert("type".into(), json!(spec.type_name));
    if spec.normalized {
        accessor.insert("normalized".into(), json!(true));
    }
    if let Some(value) = spec.min {
        accessor.insert("min".into(), value);
    }
    if let Some(value) = spec.max {
        accessor.insert("max".into(), value);
    }
    let index = accessors.len();
    accessors.push(Value::Object(accessor));
    Ok(index)
}

pub(crate) fn finish_glb(mut json_bytes: Vec<u8>, mut binary: Vec<u8>) -> Result<Vec<u8>, String> {
    let (json_length, bin_length, total_length) =
        checked_glb_container_lengths(json_bytes.len(), binary.len())?;
    json_bytes.resize(json_length, b' ');
    binary.resize(bin_length, 0);

    let mut out = Vec::with_capacity(total_length);
    out.extend_from_slice(&GLB_MAGIC.to_le_bytes());
    out.extend_from_slice(&GLB_VERSION.to_le_bytes());
    out.extend_from_slice(&(total_length as u32).to_le_bytes());
    out.extend_from_slice(&(json_length as u32).to_le_bytes());
    out.extend_from_slice(&JSON_CHUNK.to_le_bytes());
    out.extend_from_slice(&json_bytes);
    out.extend_from_slice(&(bin_length as u32).to_le_bytes());
    out.extend_from_slice(&BIN_CHUNK.to_le_bytes());
    out.extend_from_slice(&binary);
    Ok(out)
}

pub(crate) const ARRAY_BUFFER: u32 = 34_962;
pub(crate) const ELEMENT_ARRAY_BUFFER: u32 = 34_963;
pub(crate) const UNSIGNED_SHORT: u32 = 5_123;
pub(crate) const UNSIGNED_INT: u32 = 5_125;
pub(crate) const FLOAT: u32 = 5_126;

#[derive(Default)]
pub(crate) struct GlbDocument {
    pub(crate) scenes: Vec<Value>,
    pub(crate) nodes: Vec<Value>,
    pub(crate) meshes: Vec<Value>,
    pub(crate) materials: Vec<Value>,
    pub(crate) textures: Vec<Value>,
    pub(crate) images: Vec<Value>,
    pub(crate) samplers: Vec<Value>,
    pub(crate) skins: Vec<Value>,
    pub(crate) animations: Vec<Value>,
    pub(crate) cameras: Vec<Value>,
    pub(crate) extensions_used: Vec<String>,
    pub(crate) extensions: Map<String, Value>,
    pub(crate) extras: Map<String, Value>,
    accessors: Vec<Value>,
    buffer_views: Vec<Value>,
    binary: Vec<u8>,
}

impl GlbDocument {
    fn pad_binary(&mut self, alignment: usize) {
        while self.binary.len() % alignment != 0 {
            self.binary.push(0);
        }
    }

    pub(crate) fn push_bytes(
        &mut self,
        bytes: &[u8],
        target: Option<u32>,
    ) -> Result<usize, AppError> {
        append_buffer_view_with(
            &mut self.binary,
            &mut self.buffer_views,
            bytes.len(),
            target,
            |binary| binary.extend_from_slice(bytes),
        )
        .map_err(AppError::Fbx)
    }

    pub(crate) fn push_f32(
        &mut self,
        values: &[f32],
        target: Option<u32>,
        count: usize,
        type_name: &str,
        min: Option<Value>,
        max: Option<Value>,
    ) -> Result<usize, AppError> {
        let components = match type_name {
            "SCALAR" => 1,
            "VEC2" => 2,
            "VEC3" => 3,
            "VEC4" => 4,
            "MAT2" => 4,
            "MAT3" => 9,
            "MAT4" => 16,
            _ => {
                return Err(AppError::Fbx(format!(
                    "unsupported glTF accessor type: {type_name}"
                )))
            }
        };
        let expected = count
            .checked_mul(components)
            .ok_or_else(|| AppError::Fbx("GLB accessor element count overflow".into()))?;
        if values.len() != expected {
            return Err(AppError::Fbx(format!(
                "GLB accessor value count mismatch: {} values for {count} {type_name}",
                values.len()
            )));
        }
        if values.iter().any(|value| !value.is_finite()) {
            return Err(AppError::Fbx(
                "GLB accessor contains a non-finite float".into(),
            ));
        }
        let byte_len = checked_binary_byte_length(values.len(), std::mem::size_of::<f32>())
            .map_err(|_| AppError::Fbx("GLB accessor byte length overflow".into()))?;
        append_accessor_with(
            &mut self.binary,
            &mut self.buffer_views,
            &mut self.accessors,
            byte_len,
            AccessorSpec {
                target,
                component_type: FLOAT,
                count,
                type_name,
                normalized: false,
                byte_offset: None,
                min,
                max,
            },
            |binary| {
                for value in values {
                    binary.extend_from_slice(&value.to_le_bytes());
                }
            },
        )
        .map_err(AppError::Fbx)
    }

    pub(crate) fn push_u32_indices(&mut self, values: &[u32]) -> Result<usize, AppError> {
        let byte_len = checked_binary_byte_length(values.len(), std::mem::size_of::<u32>())
            .map_err(AppError::Fbx)?;
        append_accessor_with(
            &mut self.binary,
            &mut self.buffer_views,
            &mut self.accessors,
            byte_len,
            AccessorSpec {
                target: Some(ELEMENT_ARRAY_BUFFER),
                component_type: UNSIGNED_INT,
                count: values.len(),
                type_name: "SCALAR",
                normalized: false,
                byte_offset: None,
                min: None,
                max: None,
            },
            |binary| {
                for value in values {
                    binary.extend_from_slice(&value.to_le_bytes());
                }
            },
        )
        .map_err(AppError::Fbx)
    }

    pub(crate) fn push_u16_vec4(&mut self, values: &[[u16; 4]]) -> Result<usize, AppError> {
        let byte_len = checked_binary_byte_length(values.len(), 4 * std::mem::size_of::<u16>())
            .map_err(AppError::Fbx)?;
        append_accessor_with(
            &mut self.binary,
            &mut self.buffer_views,
            &mut self.accessors,
            byte_len,
            AccessorSpec {
                target: Some(ARRAY_BUFFER),
                component_type: UNSIGNED_SHORT,
                count: values.len(),
                type_name: "VEC4",
                normalized: false,
                byte_offset: None,
                min: None,
                max: None,
            },
            |binary| {
                for row in values {
                    for value in row {
                        binary.extend_from_slice(&value.to_le_bytes());
                    }
                }
            },
        )
        .map_err(AppError::Fbx)
    }

    pub(crate) fn finish(mut self) -> Result<Vec<u8>, AppError> {
        self.pad_binary(4);
        let mut root = Map::new();
        root.insert(
            "asset".into(),
            json!({ "version": "2.0", "generator": "yw-look native preview" }),
        );
        root.insert("scene".into(), json!(0));
        root.insert("scenes".into(), Value::Array(self.scenes));
        root.insert("nodes".into(), Value::Array(self.nodes));
        if !self.meshes.is_empty() {
            root.insert("meshes".into(), Value::Array(self.meshes));
        }
        if !self.materials.is_empty() {
            root.insert("materials".into(), Value::Array(self.materials));
        }
        if !self.textures.is_empty() {
            root.insert("textures".into(), Value::Array(self.textures));
        }
        if !self.images.is_empty() {
            root.insert("images".into(), Value::Array(self.images));
        }
        if !self.samplers.is_empty() {
            root.insert("samplers".into(), Value::Array(self.samplers));
        }
        if !self.skins.is_empty() {
            root.insert("skins".into(), Value::Array(self.skins));
        }
        if !self.animations.is_empty() {
            root.insert("animations".into(), Value::Array(self.animations));
        }
        if !self.cameras.is_empty() {
            root.insert("cameras".into(), Value::Array(self.cameras));
        }
        if !self.extensions_used.is_empty() {
            root.insert("extensionsUsed".into(), json!(self.extensions_used));
        }
        if !self.extensions.is_empty() {
            root.insert("extensions".into(), Value::Object(self.extensions));
        }
        if !self.extras.is_empty() {
            root.insert("extras".into(), Value::Object(self.extras));
        }
        root.insert("accessors".into(), Value::Array(self.accessors));
        root.insert("bufferViews".into(), Value::Array(self.buffer_views));
        root.insert(
            "buffers".into(),
            json!([{ "byteLength": self.binary.len() }]),
        );

        let json_bytes = serde_json::to_vec(&Value::Object(root))?;
        finish_glb(json_bytes, self.binary).map_err(AppError::Fbx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emits_aligned_glb_with_empty_scene() {
        let mut doc = GlbDocument::default();
        doc.scenes.push(json!({"nodes": []}));
        let glb = doc.finish().unwrap();
        assert_eq!(&glb[..4], b"glTF");
        assert_eq!(glb.len() % 4, 0);
        assert_eq!(
            u32::from_le_bytes(glb[8..12].try_into().unwrap()) as usize,
            glb.len()
        );
    }

    #[test]
    fn finish_glb_pads_json_with_spaces_and_bin_with_zeros() {
        let glb = finish_glb(br#"{"x":1}"#.to_vec(), vec![1, 2, 3]).unwrap();
        assert_eq!(&glb[0..4], b"glTF");
        assert_eq!(
            u32::from_le_bytes(glb[4..8].try_into().unwrap()),
            GLB_VERSION
        );

        let json_length = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        assert_eq!(json_length, 8);
        assert_eq!(&glb[16..20], b"JSON");
        assert_eq!(&glb[20..28], br#"{"x":1} "#);

        let bin_header = 20 + json_length;
        let bin_length =
            u32::from_le_bytes(glb[bin_header..bin_header + 4].try_into().unwrap()) as usize;
        assert_eq!(bin_length, 4);
        assert_eq!(&glb[bin_header + 4..bin_header + 8], b"BIN\0");
        assert_eq!(&glb[bin_header + 8..], &[1, 2, 3, 0]);
    }

    #[test]
    fn finish_glb_emits_an_empty_bin_chunk() {
        let glb = finish_glb(br#"{}"#.to_vec(), Vec::new()).unwrap();
        let json_length = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let bin_header = 20 + json_length;
        assert_eq!(
            u32::from_le_bytes(glb[bin_header..bin_header + 4].try_into().unwrap()),
            0
        );
        assert_eq!(&glb[bin_header + 4..bin_header + 8], b"BIN\0");
        assert_eq!(glb.len(), bin_header + 8);
    }

    #[test]
    fn checked_glb_container_lengths_reject_overflow_and_u32_boundaries() {
        assert!(checked_glb_container_lengths(usize::MAX, 0).is_err());
        assert!(checked_glb_container_lengths(0, usize::MAX).is_err());

        let max_u32 = u32::MAX as usize;
        assert!(checked_glb_container_lengths(max_u32, 0).is_err());
        assert!(checked_glb_container_lengths(0, max_u32).is_err());

        let max_fitting_json = (max_u32 - GLB_HEADER_LEN - 2 * GLB_CHUNK_HEADER_LEN) & !3;
        let (_, _, total_length) = checked_glb_container_lengths(max_fitting_json, 0).unwrap();
        assert_eq!(total_length, max_u32 - 3);
        assert!(checked_glb_container_lengths(max_fitting_json + 4, 0).is_err());
    }

    #[test]
    fn append_helpers_preserve_alignment_targets_and_accessor_metadata() {
        let mut binary = Vec::new();
        let mut buffer_views = Vec::new();
        let mut accessors = Vec::new();

        let bytes_view =
            append_buffer_view_with(&mut binary, &mut buffer_views, 3, None, |binary| {
                binary.extend_from_slice(&[1, 2, 3])
            })
            .unwrap();
        assert_eq!(bytes_view, 0);
        assert_eq!(binary, vec![1, 2, 3, 0]);
        assert_eq!(
            buffer_views[bytes_view],
            json!({"buffer": 0, "byteOffset": 0, "byteLength": 3})
        );

        let f32_accessor = append_accessor_with(
            &mut binary,
            &mut buffer_views,
            &mut accessors,
            8,
            AccessorSpec {
                target: Some(ARRAY_BUFFER),
                component_type: FLOAT,
                count: 2,
                type_name: "SCALAR",
                normalized: true,
                byte_offset: Some(0),
                min: Some(json!([-1.0])),
                max: Some(json!([1.0])),
            },
            |binary| binary.extend_from_slice(&[0; 8]),
        )
        .unwrap();
        assert_eq!(f32_accessor, 0);
        assert_eq!(
            buffer_views[f32_accessor + 1]["target"],
            json!(ARRAY_BUFFER)
        );
        assert_eq!(
            accessors[f32_accessor],
            json!({
                "bufferView": 1,
                "componentType": FLOAT,
                "count": 2,
                "type": "SCALAR",
                "byteOffset": 0,
                "normalized": true,
                "min": [-1.0],
                "max": [1.0],
            })
        );
        assert_eq!(binary.len(), 12);
    }

    #[test]
    fn document_writers_preserve_mixed_sections_and_trailing_texture_padding() {
        let positions = [1.0_f32, 2.0, 3.0];
        let joints = [[1_u16, 2, 3, 4]];
        let indices = [0_u32, 2, 1];
        let mut doc = GlbDocument::default();
        doc.scenes.push(json!({"nodes": []}));

        let position_accessor = doc
            .push_f32(
                &positions,
                Some(ARRAY_BUFFER),
                1,
                "VEC3",
                Some(json!([1.0, 2.0, 3.0])),
                Some(json!([1.0, 2.0, 3.0])),
            )
            .unwrap();
        let joints_accessor = doc.push_u16_vec4(&joints).unwrap();
        let indices_accessor = doc.push_u32_indices(&indices).unwrap();
        let texture_view = doc.push_bytes(&[1, 2, 3], None).unwrap();

        assert_eq!(position_accessor, 0);
        assert_eq!(joints_accessor, 1);
        assert_eq!(indices_accessor, 2);
        assert_eq!(texture_view, 3);
        assert_eq!(doc.buffer_views[0]["byteOffset"], json!(0));
        assert_eq!(doc.buffer_views[0]["byteLength"], json!(12));
        assert_eq!(doc.buffer_views[0]["target"], json!(ARRAY_BUFFER));
        assert_eq!(doc.buffer_views[1]["byteOffset"], json!(12));
        assert_eq!(doc.buffer_views[1]["byteLength"], json!(8));
        assert_eq!(doc.buffer_views[1]["target"], json!(ARRAY_BUFFER));
        assert_eq!(doc.buffer_views[2]["byteOffset"], json!(20));
        assert_eq!(doc.buffer_views[2]["byteLength"], json!(12));
        assert_eq!(doc.buffer_views[2]["target"], json!(ELEMENT_ARRAY_BUFFER));
        assert_eq!(doc.buffer_views[3]["byteOffset"], json!(32));
        assert_eq!(doc.buffer_views[3]["byteLength"], json!(3));
        assert!(doc.buffer_views[3].get("target").is_none());
        assert_eq!(doc.accessors[0]["componentType"], json!(FLOAT));
        assert_eq!(doc.accessors[0]["min"], json!([1.0, 2.0, 3.0]));
        assert_eq!(doc.accessors[1]["componentType"], json!(UNSIGNED_SHORT));
        assert_eq!(doc.accessors[2]["componentType"], json!(UNSIGNED_INT));

        let mut expected_binary = Vec::new();
        for value in positions {
            expected_binary.extend_from_slice(&value.to_le_bytes());
        }
        for row in joints {
            for value in row {
                expected_binary.extend_from_slice(&value.to_le_bytes());
            }
        }
        for value in indices {
            expected_binary.extend_from_slice(&value.to_le_bytes());
        }
        expected_binary.extend_from_slice(&[1, 2, 3, 0]);
        assert_eq!(doc.binary, expected_binary);

        let expected_bin_length = expected_binary.len();
        let glb = doc.finish().unwrap();
        let json_length = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_text = std::str::from_utf8(&glb[20..20 + json_length])
            .unwrap()
            .trim_end_matches(' ');
        let document: Value = serde_json::from_str(json_text).unwrap();
        assert_eq!(
            document["buffers"][0]["byteLength"],
            json!(expected_bin_length)
        );
        let bin_header = 20 + json_length;
        let bin_length =
            u32::from_le_bytes(glb[bin_header..bin_header + 4].try_into().unwrap()) as usize;
        assert_eq!(bin_length, expected_bin_length);
        assert_eq!(&glb[bin_header + 8..], &expected_binary);
    }

    #[test]
    fn append_helpers_reject_overflow_without_mutating_state() {
        assert!(checked_binary_byte_length(usize::MAX, 4).is_err());

        let mut binary = vec![9, 8, 7, 6];
        let mut buffer_views = vec![json!({"existing": true})];
        let mut accessors = vec![json!({"existing": true})];
        let before_binary = binary.clone();
        let before_views = buffer_views.clone();
        let before_accessors = accessors.clone();

        if let Some(too_many) = (u32::MAX as usize).checked_add(1) {
            let result = append_accessor_with(
                &mut binary,
                &mut buffer_views,
                &mut accessors,
                4,
                AccessorSpec {
                    target: Some(ELEMENT_ARRAY_BUFFER),
                    component_type: UNSIGNED_INT,
                    count: too_many,
                    type_name: "SCALAR",
                    normalized: false,
                    byte_offset: None,
                    min: None,
                    max: None,
                },
                |binary| binary.extend_from_slice(&[0; 4]),
            );
            assert!(result.is_err());
            assert_eq!(binary, before_binary);
            assert_eq!(buffer_views, before_views);
            assert_eq!(accessors, before_accessors);
        }

        let result = append_buffer_view_with(
            &mut binary,
            &mut buffer_views,
            usize::MAX,
            Some(ARRAY_BUFFER),
            |_| {},
        );
        assert!(result.is_err());
        assert_eq!(binary, before_binary);
        assert_eq!(buffer_views, before_views);

        let result = append_buffer_view_with(
            &mut binary,
            &mut buffer_views,
            4,
            Some(ARRAY_BUFFER),
            |binary| binary.extend_from_slice(&[1, 2, 3]),
        );
        assert!(result.is_err());
        assert_eq!(binary, before_binary);
        assert_eq!(buffer_views, before_views);
    }
}
