//! Format-neutral binary glTF writer used by native preview importers.
//!
//! This deliberately owns only glTF/GLB mechanics. Source-format semantics
//! (FBX pivots, USD purposes, and so on) stay in their adapters.

use serde_json::{json, Map, Value};

use crate::error::AppError;

const GLB_MAGIC: u32 = 0x4654_6c67;
const JSON_CHUNK: u32 = 0x4e4f_534a;
const BIN_CHUNK: u32 = 0x004e_4942;

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
        self.pad_binary(4);
        let byte_offset = self.binary.len();
        let end = byte_offset
            .checked_add(bytes.len())
            .ok_or_else(|| AppError::Fbx("GLB binary size overflow".into()))?;
        if end > u32::MAX as usize {
            return Err(AppError::Fbx("GLB binary chunk exceeds u32 range".into()));
        }
        self.binary.extend_from_slice(bytes);
        let mut view = json!({
            "buffer": 0,
            "byteOffset": byte_offset,
            "byteLength": bytes.len(),
        });
        if let Some(target) = target {
            view["target"] = json!(target);
        }
        let index = self.buffer_views.len();
        self.buffer_views.push(view);
        Ok(index)
    }

    pub(crate) fn push_accessor(
        &mut self,
        bytes: &[u8],
        target: Option<u32>,
        component_type: u32,
        count: usize,
        type_name: &str,
        normalized: bool,
        min: Option<Value>,
        max: Option<Value>,
    ) -> Result<usize, AppError> {
        if count > u32::MAX as usize {
            return Err(AppError::Fbx("GLB accessor count exceeds u32 range".into()));
        }
        let view = self.push_bytes(bytes, target)?;
        let mut accessor = json!({
            "bufferView": view,
            "componentType": component_type,
            "count": count,
            "type": type_name,
        });
        if normalized {
            accessor["normalized"] = json!(true);
        }
        if let Some(value) = min {
            accessor["min"] = value;
        }
        if let Some(value) = max {
            accessor["max"] = value;
        }
        let index = self.accessors.len();
        self.accessors.push(accessor);
        Ok(index)
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
        let byte_len = values
            .len()
            .checked_mul(std::mem::size_of::<f32>())
            .ok_or_else(|| AppError::Fbx("GLB accessor byte length overflow".into()))?;
        let mut bytes = Vec::with_capacity(byte_len);
        for value in values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        self.push_accessor(&bytes, target, FLOAT, count, type_name, false, min, max)
    }

    pub(crate) fn push_u32_indices(&mut self, values: &[u32]) -> Result<usize, AppError> {
        let mut bytes = Vec::with_capacity(values.len().saturating_mul(4));
        for value in values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        self.push_accessor(
            &bytes,
            Some(ELEMENT_ARRAY_BUFFER),
            UNSIGNED_INT,
            values.len(),
            "SCALAR",
            false,
            None,
            None,
        )
    }

    pub(crate) fn push_u16_vec4(&mut self, values: &[[u16; 4]]) -> Result<usize, AppError> {
        let mut bytes = Vec::with_capacity(values.len().saturating_mul(8));
        for row in values {
            for value in row {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
        }
        self.push_accessor(
            &bytes,
            Some(ARRAY_BUFFER),
            UNSIGNED_SHORT,
            values.len(),
            "VEC4",
            false,
            None,
            None,
        )
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

        let mut json_bytes = serde_json::to_vec(&Value::Object(root))?;
        while json_bytes.len() % 4 != 0 {
            json_bytes.push(b' ');
        }
        let total = 12usize
            .checked_add(8)
            .and_then(|n| n.checked_add(json_bytes.len()))
            .and_then(|n| n.checked_add(8))
            .and_then(|n| n.checked_add(self.binary.len()))
            .ok_or_else(|| AppError::Fbx("GLB total size overflow".into()))?;
        if total > u32::MAX as usize {
            return Err(AppError::Fbx("GLB exceeds u32 container range".into()));
        }
        let mut out = Vec::with_capacity(total);
        out.extend_from_slice(&GLB_MAGIC.to_le_bytes());
        out.extend_from_slice(&2u32.to_le_bytes());
        out.extend_from_slice(&(total as u32).to_le_bytes());
        out.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
        out.extend_from_slice(&JSON_CHUNK.to_le_bytes());
        out.extend_from_slice(&json_bytes);
        out.extend_from_slice(&(self.binary.len() as u32).to_le_bytes());
        out.extend_from_slice(&BIN_CHUNK.to_le_bytes());
        out.extend_from_slice(&self.binary);
        Ok(out)
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
}
