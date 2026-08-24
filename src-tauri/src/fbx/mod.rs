use std::collections::HashMap;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use serde_json::{json, Value};

use crate::error::AppError;
use crate::preview::glb::{GlbDocument, ARRAY_BUFFER};

const UFBX_MEMORY_LIMIT: usize = 2 * 1024 * 1024 * 1024;
const UFBX_ALLOCATION_LIMIT: usize = 4_000_000;
const MAX_ANIMATION_SAMPLES: usize = 1_000_000;
const WHITE_PNG: &[u8] = &[
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 215, 99, 248, 255, 255, 255, 127, 0, 9,
    251, 3, 253, 42, 134, 227, 139, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];

#[derive(Clone, Copy, Hash, PartialEq, Eq)]
struct VertexKey {
    control: u32,
    p: [u64; 3],
    n: [u64; 3],
    uv: [u64; 2],
    c: [u64; 4],
}

struct PrimitiveData {
    positions: Vec<f32>,
    normals: Vec<f32>,
    uvs: Vec<f32>,
    colors: Vec<f32>,
    control_points: Vec<u32>,
    indices: Vec<u32>,
}

fn canceled(flag: &AtomicBool) -> Result<(), AppError> {
    if flag.load(Ordering::Relaxed) {
        Err(AppError::Cancelled)
    } else {
        Ok(())
    }
}

fn f32v(value: f64) -> Result<f32, AppError> {
    if value.is_finite() && value >= f32::MIN as f64 && value <= f32::MAX as f64 {
        Ok(value as f32)
    } else {
        Err(AppError::Fbx(
            "FBX contains a non-finite or out-of-range numeric value".into(),
        ))
    }
}

fn vec3(v: ufbx::Vec3) -> Result<[f32; 3], AppError> {
    Ok([f32v(v.x)?, f32v(v.y)?, f32v(v.z)?])
}
fn quat(v: ufbx::Quat) -> Result<[f32; 4], AppError> {
    Ok([f32v(v.x)?, f32v(v.y)?, f32v(v.z)?, f32v(v.w)?])
}

fn vertex_vec2(v: &ufbx::VertexVec2, index: usize) -> Result<ufbx::Vec2, AppError> {
    let value_index = *v
        .indices
        .get(index)
        .ok_or_else(|| AppError::Fbx("vertex UV index is out of range".into()))?
        as usize;
    v.values
        .get(value_index)
        .copied()
        .ok_or_else(|| AppError::Fbx("vertex UV value is out of range".into()))
}

fn vertex_vec3(v: &ufbx::VertexVec3, index: usize) -> Result<ufbx::Vec3, AppError> {
    let value_index = *v
        .indices
        .get(index)
        .ok_or_else(|| AppError::Fbx("vertex attribute index is out of range".into()))?
        as usize;
    v.values
        .get(value_index)
        .copied()
        .ok_or_else(|| AppError::Fbx("vertex attribute value is out of range".into()))
}

fn vertex_vec4(v: &ufbx::VertexVec4, index: usize) -> Result<ufbx::Vec4, AppError> {
    let value_index = *v
        .indices
        .get(index)
        .ok_or_else(|| AppError::Fbx("vertex color index is out of range".into()))?
        as usize;
    v.values
        .get(value_index)
        .copied()
        .ok_or_else(|| AppError::Fbx("vertex color value is out of range".into()))
}

fn gltf_uv(uv: ufbx::Vec2) -> Result<[f32; 2], AppError> {
    Ok([f32v(uv.x)?, f32v(uv.y)?])
}

fn transform_json(t: ufbx::Transform) -> Result<Value, AppError> {
    Ok(json!({
        "translation": vec3(t.translation)?,
        "rotation": quat(t.rotation)?,
        "scale": vec3(t.scale)?,
    }))
}

fn camera_json(camera: &ufbx::Camera) -> Result<Value, AppError> {
    let near = f32v(camera.near_plane)?;
    let far = f32v(camera.far_plane)?;
    if near <= 0.0 || far <= near {
        return Err(AppError::Fbx(format!(
            "camera '{}' has an invalid clipping range",
            camera.element.name
        )));
    }
    match camera.projection_mode {
        ufbx::ProjectionMode::Perspective => {
            let yfov = f32v(camera.field_of_view_deg.y)?.to_radians();
            if !(yfov > 0.0 && yfov < std::f32::consts::PI) {
                return Err(AppError::Fbx(format!(
                    "camera '{}' has an invalid field of view",
                    camera.element.name
                )));
            }
            let aspect = f32v(camera.aspect_ratio)?;
            if !(aspect > 0.0) {
                return Err(AppError::Fbx(format!(
                    "camera '{}' has an invalid aspect ratio",
                    camera.element.name
                )));
            }
            Ok(json!({
                "name": camera.element.name.to_string(),
                "type": "perspective",
                "perspective": {
                    "yfov": yfov,
                    "aspectRatio": aspect,
                    "znear": near,
                    "zfar": far,
                },
                "extras": { "fbxProjectionMode": "Perspective" },
            }))
        }
        ufbx::ProjectionMode::Orthographic => {
            let xmag = f32v(camera.orthographic_size.x)?.abs();
            let ymag = f32v(camera.orthographic_size.y)?.abs();
            if !(xmag > 0.0 && ymag > 0.0) {
                return Err(AppError::Fbx(format!(
                    "camera '{}' has an invalid orthographic size",
                    camera.element.name
                )));
            }
            Ok(json!({
                "name": camera.element.name.to_string(),
                "type": "orthographic",
                "orthographic": {
                    "xmag": xmag,
                    "ymag": ymag,
                    "znear": near,
                    "zfar": far,
                },
                "extras": { "fbxProjectionMode": "Orthographic" },
            }))
        }
    }
}

fn gltf_light_type(type_: ufbx::LightType) -> (&'static str, bool) {
    match type_ {
        ufbx::LightType::Directional => ("directional", false),
        ufbx::LightType::Spot => ("spot", false),
        ufbx::LightType::Point => ("point", false),
        ufbx::LightType::Area | ufbx::LightType::Volume => ("point", true),
    }
}

fn spot_cone_angles(inner_degrees: f64, outer_degrees: f64) -> [f64; 2] {
    let outer = (outer_degrees.to_radians() * 0.5).clamp(0.0, std::f64::consts::FRAC_PI_2);
    let inner = (inner_degrees.to_radians() * 0.5).clamp(0.0, outer);
    [inner, outer]
}

fn light_json(light: &ufbx::Light) -> Result<(Value, bool), AppError> {
    let (type_name, degraded) = gltf_light_type(light.type_);
    let mut value = json!({
        "name": light.element.name.to_string(),
        "type": type_name,
        "color": [f32v(light.color.x)?, f32v(light.color.y)?, f32v(light.color.z)?],
        "intensity": f32v(if light.cast_light { light.intensity / 100.0 } else { 0.0 })?,
        "extras": {
            "fbxCastShadows": light.cast_shadows,
            "fbxDecay": format!("{:?}", light.decay),
            "fbxOriginalType": format!("{:?}", light.type_),
        },
    });
    if light.type_ == ufbx::LightType::Spot {
        let [inner, outer] = spot_cone_angles(light.inner_angle, light.outer_angle);
        value["spot"] = json!({
            "innerConeAngle": f32v(inner)?,
            "outerConeAngle": f32v(outer)?,
        });
    }
    Ok((value, degraded))
}

fn matrix_values(m: ufbx::Matrix) -> Result<[f32; 16], AppError> {
    Ok([
        f32v(m.m00)?,
        f32v(m.m10)?,
        f32v(m.m20)?,
        0.0,
        f32v(m.m01)?,
        f32v(m.m11)?,
        f32v(m.m21)?,
        0.0,
        f32v(m.m02)?,
        f32v(m.m12)?,
        f32v(m.m22)?,
        0.0,
        f32v(m.m03)?,
        f32v(m.m13)?,
        f32v(m.m23)?,
        1.0,
    ])
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else {
        None
    }
}

fn texture_source_name(texture: &ufbx::Texture) -> String {
    for value in [
        &*texture.relative_filename,
        &*texture.filename,
        &*texture.absolute_filename,
    ] {
        if !value.is_empty() {
            return value.replace('\\', "/");
        }
    }
    texture.element.name.to_string()
}

fn add_texture(doc: &mut GlbDocument, texture: &ufbx::Texture) -> Result<usize, AppError> {
    let source_name = texture_source_name(texture);
    let (bytes, mime, degraded) = match image_mime(&texture.content) {
        Some(mime) => (&texture.content[..], mime, false),
        None => (WHITE_PNG, "image/png", true),
    };
    let view = doc.push_bytes(bytes, None)?;
    let image_index = doc.images.len();
    doc.images.push(json!({
        "name": source_name.rsplit('/').next().unwrap_or(&source_name),
        "bufferView": view,
        "mimeType": mime,
        "extras": { "fbxSourceName": source_name, "fbxDeferred": degraded }
    }));
    let texture_index = doc.textures.len();
    doc.textures
        .push(json!({ "source": image_index, "sampler": 0 }));
    Ok(texture_index)
}

fn texture_index(
    doc: &mut GlbDocument,
    cache: &mut HashMap<u32, usize>,
    texture: &ufbx::Texture,
) -> Result<usize, AppError> {
    if let Some(&index) = cache.get(&texture.element.typed_id) {
        return Ok(index);
    }
    let index = add_texture(doc, texture)?;
    cache.insert(texture.element.typed_id, index);
    Ok(index)
}

fn map_value(map: &ufbx::MaterialMap, fallback: [f64; 4]) -> [f64; 4] {
    if map.has_value {
        [
            map.value_vec4.x,
            map.value_vec4.y,
            map.value_vec4.z,
            map.value_vec4.w,
        ]
    } else {
        fallback
    }
}

fn scalar_map_value(map: &ufbx::MaterialMap, fallback: f64) -> f64 {
    if map.has_value {
        map.value_vec4.x
    } else {
        fallback
    }
}

fn emission_value(color_map: &ufbx::MaterialMap, factor_map: &ufbx::MaterialMap) -> [f64; 3] {
    let color = map_value(color_map, [0.0, 0.0, 0.0, 1.0]);
    let factor = if factor_map.has_value {
        factor_map.value_vec4.x
    } else {
        1.0
    };
    [color[0] * factor, color[1] * factor, color[2] * factor]
}

fn add_materials(
    doc: &mut GlbDocument,
    scene: &ufbx::Scene,
    cancel: &AtomicBool,
) -> Result<(HashMap<u32, usize>, Vec<Value>), AppError> {
    doc.samplers.push(json!({ "wrapS": 10497, "wrapT": 10497 }));
    let mut texture_cache = HashMap::<u32, usize>::new();
    let mut result = HashMap::new();
    let mut texture_bindings = Vec::new();
    for material in &scene.materials {
        canceled(cancel)?;
        let material_name = material.element.name.to_string();
        let base = map_value(&material.pbr.base_color, [1.0, 1.0, 1.0, 1.0]);
        let factor = scalar_map_value(&material.pbr.base_factor, 1.0);
        // ufbx leaves unauthored unified PBR opacity at zero with has_value=false.
        let opacity = if material.pbr.opacity.has_value {
            material.pbr.opacity.value_vec4.x.clamp(0.0, 1.0)
        } else {
            1.0
        };
        let roughness = if material.pbr.roughness.has_value {
            material.pbr.roughness.value_vec4.x.clamp(0.0, 1.0)
        } else {
            1.0
        };
        let metallic = if material.pbr.metalness.has_value {
            material.pbr.metalness.value_vec4.x.clamp(0.0, 1.0)
        } else {
            0.0
        };
        let mut pbr = json!({
            "baseColorFactor": [f32v(base[0] * factor)?, f32v(base[1] * factor)?, f32v(base[2] * factor)?, f32v(opacity)?],
            "metallicFactor": f32v(metallic)?,
            "roughnessFactor": f32v(roughness)?,
        });
        if let Some(texture) = material.pbr.base_color.texture.as_deref() {
            let index = texture_index(doc, &mut texture_cache, texture)?;
            pbr["baseColorTexture"] = json!({ "index": index });
            texture_bindings.push(json!({ "material": material_name, "slot": "baseColor", "source": texture_source_name(texture), "textureIndex": index }));
        }
        let emissive = emission_value(&material.pbr.emission_color, &material.pbr.emission_factor);
        let material_extras = json!({ "fbxOpacityAuthored": material.pbr.opacity.has_value });
        let mut value = json!({
            "name": material_name.clone(),
            "pbrMetallicRoughness": pbr,
            "emissiveFactor": [f32v(emissive[0])?, f32v(emissive[1])?, f32v(emissive[2])?],
            "doubleSided": material.features.double_sided.enabled,
            "alphaMode": if opacity < 0.999 { "BLEND" } else { "OPAQUE" },
            "extras": material_extras
        });
        if let Some(texture) = material.pbr.base_color.texture.as_deref() {
            value["extras"]["fbxBaseColorSource"] = json!(texture_source_name(texture));
        }
        if let Some(texture) = material.pbr.normal_map.texture.as_deref() {
            let index = texture_index(doc, &mut texture_cache, texture)?;
            value["normalTexture"] = json!({ "index": index });
            value["extras"]["fbxNormalSource"] = json!(texture_source_name(texture));
            texture_bindings.push(json!({ "material": material_name, "slot": "normal", "source": texture_source_name(texture), "textureIndex": index }));
        }
        if emissive[0] != 0.0 || emissive[1] != 0.0 || emissive[2] != 0.0 {
            if let Some(texture) = material.pbr.emission_color.texture.as_deref() {
                let index = texture_index(doc, &mut texture_cache, texture)?;
                value["emissiveTexture"] = json!({ "index": index });
                value["extras"]["fbxEmissiveSource"] = json!(texture_source_name(texture));
                texture_bindings.push(json!({ "material": material_name, "slot": "emissive", "source": texture_source_name(texture), "textureIndex": index }));
            }
        }
        for (slot, key, map) in [
            ("roughness", "fbxRoughnessSource", &material.pbr.roughness),
            ("metalness", "fbxMetalnessSource", &material.pbr.metalness),
            (
                "ambientOcclusion",
                "fbxAmbientOcclusionSource",
                &material.pbr.ambient_occlusion,
            ),
        ] {
            if let Some(texture) = map.texture.as_deref() {
                let index = texture_index(doc, &mut texture_cache, texture)?;
                value["extras"][key] = json!(texture_source_name(texture));
                texture_bindings.push(json!({ "material": material_name, "slot": slot, "source": texture_source_name(texture), "textureIndex": index }));
            }
        }
        result.insert(material.element.typed_id, doc.materials.len());
        doc.materials.push(value);
    }
    if doc.materials.is_empty() {
        doc.materials.push(json!({"name":"FBX Default","pbrMetallicRoughness":{"baseColorFactor":[1,1,1,1],"metallicFactor":0,"roughnessFactor":1}}));
    }
    Ok((result, texture_bindings))
}

fn primitive_data(
    mesh: &ufbx::Mesh,
    faces: &[u32],
    cancel: &AtomicBool,
) -> Result<PrimitiveData, AppError> {
    let mut out = PrimitiveData {
        positions: vec![],
        normals: vec![],
        uvs: vec![],
        colors: vec![],
        control_points: vec![],
        indices: vec![],
    };
    let mut dedup = HashMap::<VertexKey, u32>::new();
    let mut triangulated = Vec::new();
    for &face_index in faces {
        canceled(cancel)?;
        let face = *mesh
            .faces
            .get(face_index as usize)
            .ok_or_else(|| AppError::Fbx("material part face index is out of range".into()))?;
        ufbx::triangulate_face_vec(&mut triangulated, mesh, face);
        for &corner in &triangulated {
            canceled(cancel)?;
            let ci = corner as usize;
            let control = *mesh
                .vertex_indices
                .get(ci)
                .ok_or_else(|| AppError::Fbx("corner control point is out of range".into()))?;
            let p = vertex_vec3(&mesh.vertex_position, ci)?;
            let n = if mesh.vertex_normal.exists {
                vertex_vec3(&mesh.vertex_normal, ci)?
            } else {
                ufbx::Vec3 {
                    x: 0.0,
                    y: 1.0,
                    z: 0.0,
                }
            };
            let uv = if mesh.vertex_uv.exists {
                vertex_vec2(&mesh.vertex_uv, ci)?
            } else {
                ufbx::Vec2::default()
            };
            let c = if mesh.vertex_color.exists {
                vertex_vec4(&mesh.vertex_color, ci)?
            } else {
                ufbx::Vec4 {
                    x: 1.0,
                    y: 1.0,
                    z: 1.0,
                    w: 1.0,
                }
            };
            let pf = [f32v(p.x)?, f32v(p.y)?, f32v(p.z)?];
            let nf = [f32v(n.x)?, f32v(n.y)?, f32v(n.z)?];
            // ufbx exposes FBX UVs in the source convention expected by the
            // decoded image. GLB textures are emitted with flipY=false, so an
            // additional V inversion here would turn the material upside down.
            let uvf = gltf_uv(uv)?;
            let cf = [f32v(c.x)?, f32v(c.y)?, f32v(c.z)?, f32v(c.w)?];
            let key = VertexKey {
                control,
                p: [p.x.to_bits(), p.y.to_bits(), p.z.to_bits()],
                n: [n.x.to_bits(), n.y.to_bits(), n.z.to_bits()],
                uv: [uv.x.to_bits(), uv.y.to_bits()],
                c: [c.x.to_bits(), c.y.to_bits(), c.z.to_bits(), c.w.to_bits()],
            };
            let next = u32::try_from(dedup.len())
                .map_err(|_| AppError::Fbx("primitive vertex count exceeds u32".into()))?;
            let index = *dedup.entry(key).or_insert_with(|| {
                out.positions.extend(pf);
                out.normals.extend(nf);
                out.uvs.extend(uvf);
                out.colors.extend(cf);
                out.control_points.push(control);
                next
            });
            out.indices.push(index);
        }
    }
    Ok(out)
}

fn min_max(values: &[f32]) -> (Value, Value) {
    let mut min = [f32::INFINITY; 3];
    let mut max = [f32::NEG_INFINITY; 3];
    for v in values.chunks_exact(3) {
        for i in 0..3 {
            min[i] = min[i].min(v[i]);
            max[i] = max[i].max(v[i]);
        }
    }
    (json!(min), json!(max))
}

fn shape_offsets(
    shape: &ufbx::BlendShape,
    controls: &[u32],
    cancel: &AtomicBool,
) -> Result<Vec<f32>, AppError> {
    if shape.offset_vertices.len() != shape.position_offsets.len() {
        return Err(AppError::Fbx(
            "blend shape position offset arrays have different lengths".into(),
        ));
    }
    let offsets: HashMap<u32, ufbx::Vec3> = shape
        .offset_vertices
        .iter()
        .copied()
        .zip(shape.position_offsets.iter().copied())
        .collect();
    let mut out = Vec::with_capacity(
        controls
            .len()
            .checked_mul(3)
            .ok_or_else(|| AppError::Fbx("blend shape vertex count overflow".into()))?,
    );
    for &control in controls {
        canceled(cancel)?;
        out.extend(vec3(offsets.get(&control).copied().unwrap_or_default())?);
    }
    Ok(out)
}

fn shape_normal_offsets(
    shape: &ufbx::BlendShape,
    controls: &[u32],
    cancel: &AtomicBool,
) -> Result<Option<Vec<f32>>, AppError> {
    if shape.normal_offsets.is_empty() {
        return Ok(None);
    }
    if shape.offset_vertices.len() != shape.normal_offsets.len() {
        return Err(AppError::Fbx(
            "blend shape normal offset arrays have different lengths".into(),
        ));
    }
    let offsets: HashMap<u32, ufbx::Vec3> = shape
        .offset_vertices
        .iter()
        .copied()
        .zip(shape.normal_offsets.iter().copied())
        .collect();
    let mut out = Vec::with_capacity(controls.len() * 3);
    for control in controls {
        canceled(cancel)?;
        out.extend(vec3(offsets.get(control).copied().unwrap_or_default())?);
    }
    Ok(Some(out))
}

fn add_skin(
    doc: &mut GlbDocument,
    skin: &ufbx::SkinDeformer,
    node_map: &HashMap<u32, usize>,
    cancel: &AtomicBool,
) -> Result<Option<(usize, HashMap<u32, usize>)>, AppError> {
    let mut joints = Vec::new();
    let mut matrices = Vec::new();
    let mut cluster_map = HashMap::new();
    for (cluster_index, cluster) in skin.clusters.iter().enumerate() {
        canceled(cancel)?;
        let Some(bone) = cluster.bone_node.as_deref() else {
            continue;
        };
        let Some(&node) = node_map.get(&bone.element.typed_id) else {
            continue;
        };
        cluster_map.insert(cluster_index as u32, joints.len());
        joints.push(node);
        matrices.extend(matrix_values(cluster.geometry_to_bone)?);
    }
    if joints.is_empty() {
        return Ok(None);
    }
    let accessor = doc.push_f32(&matrices, None, joints.len(), "MAT4", None, None)?;
    let index = doc.skins.len();
    doc.skins
        .push(json!({ "joints": joints, "inverseBindMatrices": accessor }));
    Ok(Some((index, cluster_map)))
}

fn skin_attributes(
    skin: &ufbx::SkinDeformer,
    controls: &[u32],
    cluster_map: &HashMap<u32, usize>,
    cancel: &AtomicBool,
) -> Result<(Vec<[u16; 4]>, Vec<f32>), AppError> {
    let mut joints = Vec::with_capacity(controls.len());
    let mut weights = Vec::with_capacity(controls.len() * 4);
    for &control in controls {
        canceled(cancel)?;
        let vertex = *skin
            .vertices
            .get(control as usize)
            .ok_or_else(|| AppError::Fbx("skin vertex is out of range".into()))?;
        let begin = vertex.weight_begin as usize;
        let end = begin
            .checked_add(vertex.num_weights as usize)
            .ok_or_else(|| AppError::Fbx("skin weight range overflow".into()))?;
        let mut js = [0u16; 4];
        let mut ws = [0.0f32; 4];
        let mut count = 0;
        for weight in skin
            .weights
            .get(begin..end)
            .ok_or_else(|| AppError::Fbx("skin weight range is out of bounds".into()))?
            .iter()
        {
            if count == 4 {
                break;
            }
            if let Some(&joint) = cluster_map.get(&weight.cluster_index) {
                js[count] = u16::try_from(joint)
                    .map_err(|_| AppError::Fbx("skin has more than 65535 joints".into()))?;
                ws[count] = f32v(weight.weight.max(0.0))?;
                count += 1;
            }
        }
        let sum: f64 = ws.iter().map(|weight| *weight as f64).sum();
        if !sum.is_finite() {
            return Err(AppError::Fbx("skin influence sum is non-finite".into()));
        }
        if sum <= f32::EPSILON as f64 {
            ws = [1.0, 0.0, 0.0, 0.0];
        } else {
            for weight in &mut ws {
                *weight = f32v(*weight as f64 / sum)?;
            }
        }
        joints.push(js);
        weights.extend(ws);
    }
    Ok((joints, weights))
}

fn add_animation_sampler(
    doc: &mut GlbDocument,
    samplers: &mut Vec<Value>,
    times: &[f32],
    values: &[f32],
    value_type: &str,
    interpolation: &str,
) -> Result<usize, AppError> {
    let min = times.first().copied().unwrap_or(0.0);
    let max = times.last().copied().unwrap_or(0.0);
    let input = doc.push_f32(
        times,
        None,
        times.len(),
        "SCALAR",
        Some(json!([min])),
        Some(json!([max])),
    )?;
    let components = match value_type {
        "VEC3" => 3,
        "VEC4" => 4,
        _ => 1,
    };
    let output = doc.push_f32(
        values,
        None,
        values.len() / components,
        value_type,
        None,
        None,
    )?;
    let index = samplers.len();
    samplers.push(json!({ "input": input, "output": output, "interpolation": interpolation }));
    Ok(index)
}

fn add_animations(
    doc: &mut GlbDocument,
    scene: &ufbx::Scene,
    node_map: &HashMap<u32, usize>,
    mesh_nodes: &HashMap<u32, Vec<usize>>,
    mesh_channels: &HashMap<u32, Vec<&ufbx::BlendChannel>>,
    cancel: &AtomicBool,
) -> Result<(), AppError> {
    for stack in &scene.anim_stacks {
        canceled(cancel)?;
        let baked = ufbx::bake_anim(
            scene,
            &stack.anim,
            ufbx::BakeOpts {
                trim_start_time: false,
                resample_rate: {
                    let fps = scene.settings.frames_per_second;
                    if fps.is_finite() && fps > 0.0 {
                        fps.max(30.0)
                    } else {
                        30.0
                    }
                },
                key_reduction_enabled: true,
                key_reduction_rotation: true,
                ..Default::default()
            },
        )
        .map_err(|error| {
            AppError::Fbx(format!(
                "failed to bake animation '{}': {}",
                stack.element.name,
                error.info()
            ))
        })?;
        let start = stack.time_begin;
        let end = stack.time_end;
        if !start.is_finite() || !end.is_finite() || end < start {
            return Err(AppError::Fbx(format!(
                "animation '{}' has an invalid time range",
                stack.element.name
            )));
        }
        let duration = end - start;
        let fps = {
            let value = scene.settings.frames_per_second;
            if value.is_finite() && value > 0.0 {
                value.max(30.0)
            } else {
                30.0
            }
        };
        let sample_count_f64 = duration * fps;
        if !sample_count_f64.is_finite()
            || sample_count_f64 > (MAX_ANIMATION_SAMPLES.saturating_sub(1)) as f64
        {
            return Err(AppError::Fbx(format!(
                "animation '{}' exceeds the native preview sample limit",
                stack.element.name
            )));
        }
        let mut samplers = Vec::new();
        let mut channels = Vec::new();
        for baked_node in &baked.nodes {
            canceled(cancel)?;
            let Some(&node_index) = node_map.get(&baked_node.typed_id) else {
                continue;
            };
            if !baked_node.translation_keys.is_empty() {
                let times: Vec<f32> = baked_node
                    .translation_keys
                    .iter()
                    .map(|k| f32v((k.time - start).clamp(0.0, end - start)))
                    .collect::<Result<_, _>>()?;
                let values: Vec<f32> = baked_node
                    .translation_keys
                    .iter()
                    .map(|k| vec3(k.value))
                    .collect::<Result<Vec<_>, _>>()?
                    .into_iter()
                    .flatten()
                    .collect();
                let sampler =
                    add_animation_sampler(doc, &mut samplers, &times, &values, "VEC3", "LINEAR")?;
                channels.push(
                    json!({"sampler":sampler,"target":{"node":node_index,"path":"translation"}}),
                );
            }
            if !baked_node.rotation_keys.is_empty() {
                let times: Vec<f32> = baked_node
                    .rotation_keys
                    .iter()
                    .map(|k| f32v((k.time - start).clamp(0.0, end - start)))
                    .collect::<Result<_, _>>()?;
                let values: Vec<f32> = baked_node
                    .rotation_keys
                    .iter()
                    .map(|k| quat(k.value))
                    .collect::<Result<Vec<_>, _>>()?
                    .into_iter()
                    .flatten()
                    .collect();
                let sampler =
                    add_animation_sampler(doc, &mut samplers, &times, &values, "VEC4", "LINEAR")?;
                channels.push(
                    json!({"sampler":sampler,"target":{"node":node_index,"path":"rotation"}}),
                );
            }
            if !baked_node.scale_keys.is_empty() {
                let times: Vec<f32> = baked_node
                    .scale_keys
                    .iter()
                    .map(|k| f32v((k.time - start).clamp(0.0, end - start)))
                    .collect::<Result<_, _>>()?;
                let values: Vec<f32> = baked_node
                    .scale_keys
                    .iter()
                    .map(|k| vec3(k.value))
                    .collect::<Result<Vec<_>, _>>()?
                    .into_iter()
                    .flatten()
                    .collect();
                let sampler =
                    add_animation_sampler(doc, &mut samplers, &times, &values, "VEC3", "LINEAR")?;
                channels
                    .push(json!({"sampler":sampler,"target":{"node":node_index,"path":"scale"}}));
            }
        }
        let sample_count = sample_count_f64.ceil() as usize + 1;
        let morph_times: Vec<f32> = (0..sample_count)
            .map(|i| {
                if sample_count == 1 {
                    Ok(0.0)
                } else {
                    f32v(duration * i as f64 / (sample_count - 1) as f64)
                }
            })
            .collect::<Result<_, _>>()?;
        for (&mesh_id, blend_channels) in mesh_channels {
            if blend_channels.is_empty() {
                continue;
            }
            let value_count = morph_times
                .len()
                .checked_mul(blend_channels.len())
                .ok_or_else(|| AppError::Fbx("morph animation value count overflow".into()))?;
            let mut values = Vec::with_capacity(value_count);
            for &relative in &morph_times {
                canceled(cancel)?;
                let time = start + relative as f64;
                for channel in blend_channels {
                    canceled(cancel)?;
                    values.push(f32v(
                        channel.evaluate_blend_weight(&stack.anim, time) / 100.0,
                    )?);
                }
            }
            for &node_index in mesh_nodes.get(&mesh_id).into_iter().flatten() {
                let sampler = add_animation_sampler(
                    doc,
                    &mut samplers,
                    &morph_times,
                    &values,
                    "SCALAR",
                    "LINEAR",
                )?;
                channels
                    .push(json!({"sampler":sampler,"target":{"node":node_index,"path":"weights"}}));
            }
        }
        if !channels.is_empty() {
            doc.animations.push(json!({"name":animation_stack_name(scene, stack),"samplers":samplers,"channels":channels,"extras":{"fbxTimeBegin":start,"fbxTimeEnd":end}}));
        }
    }
    Ok(())
}

/// Blender's FBX exporter names takes as `Object|Action`. Remove only that
/// exporter prefix: a user-authored pipe remains intact unless its left side
/// is the name of an actual scene node.
fn animation_stack_name(scene: &ufbx::Scene, stack: &ufbx::AnimStack) -> String {
    let raw = stack.element.name.to_string();
    let Some((object_name, action_name)) = raw.rsplit_once('|') else {
        return raw;
    };
    if !action_name.is_empty()
        && scene
            .nodes
            .iter()
            .any(|node| node.element.name.as_ref() == object_name)
    {
        action_name.to_owned()
    } else {
        raw
    }
}

fn native_load_options<'a>(
    progress_cb: ufbx::ProgressCb<'a>,
    space_conversion: ufbx::SpaceConversion,
) -> ufbx::LoadOpts<'a> {
    ufbx::LoadOpts {
        target_axes: ufbx::CoordinateAxes::right_handed_y_up(),
        target_unit_meters: 1.0,
        // Three.js applies a mounted node's transform after skinning. A
        // conversion root would therefore scale skinned vertices twice. The
        // geometry-space variant is selected for skinned scenes below; the
        // transform-root pass preserves the existing animation contract for
        // unskinned scenes.
        space_conversion,
        generate_missing_normals: true,
        normalize_normals: true,
        load_external_files: false,
        ignore_missing_external_files: true,
        clean_skin_weights: true,
        force_single_thread_ascii_parsing: true,
        progress_cb,
        progress_interval_hint: 64 * 1024,
        temp_allocator: ufbx::AllocatorOpts {
            memory_limit: UFBX_MEMORY_LIMIT,
            allocation_limit: UFBX_ALLOCATION_LIMIT,
            ..Default::default()
        },
        result_allocator: ufbx::AllocatorOpts {
            memory_limit: UFBX_MEMORY_LIMIT,
            allocation_limit: UFBX_ALLOCATION_LIMIT,
            ..Default::default()
        },
        ..Default::default()
    }
}

fn load_native_scene(
    bytes: &[u8],
    opts: ufbx::LoadOpts<'_>,
    cancel: &AtomicBool,
) -> Result<ufbx::SceneRoot, AppError> {
    canceled(cancel)?;
    ufbx::load_memory(bytes, opts).map_err(|error| {
        if cancel.load(Ordering::Relaxed) {
            AppError::Cancelled
        } else {
            AppError::Fbx(format!(
                "ufbx load failed ({:?}): {}",
                error.type_,
                error.info()
            ))
        }
    })
}

fn space_conversion_for_scene(has_skin: bool) -> ufbx::SpaceConversion {
    if has_skin {
        ufbx::SpaceConversion::ModifyGeometry
    } else {
        ufbx::SpaceConversion::TransformRoot
    }
}

pub(crate) fn convert(path: &Path, cancel: Arc<AtomicBool>) -> Result<Vec<u8>, AppError> {
    let mut progress = |_: &ufbx::Progress| {
        if cancel.load(Ordering::Relaxed) {
            ufbx::ProgressResult::Cancel
        } else {
            ufbx::ProgressResult::Continue
        }
    };
    let bytes = std::fs::read(path)
        .map_err(|error| AppError::Io(format!("failed to read FBX input: {error}")))?;
    let initial = load_native_scene(
        &bytes,
        native_load_options(
            ufbx::ProgressCb::Mut(&mut progress),
            space_conversion_for_scene(false),
        ),
        &cancel,
    )?;
    let scene = if initial.skin_deformers.is_empty() {
        initial
    } else {
        // ufbx's TransformRoot mode is the historical path used by all
        // unskinned assets and keeps authored animation values unchanged.
        // For skinned assets, load once more with ModifyGeometry so the
        // unit/axis conversion is incorporated into vertices, joints, and
        // inverse bind matrices as one coherent coordinate space.
        drop(initial);
        load_native_scene(
            &bytes,
            native_load_options(
                ufbx::ProgressCb::Mut(&mut progress),
                space_conversion_for_scene(true),
            ),
            &cancel,
        )?
    };
    canceled(&cancel)?;
    build_scene(&scene, &cancel)
}

fn build_scene(scene: &ufbx::Scene, cancel: &AtomicBool) -> Result<Vec<u8>, AppError> {
    let mut doc = GlbDocument::default();
    let (material_map, texture_bindings) = add_materials(&mut doc, scene, cancel)?;
    let mut warnings: Vec<String> = scene
        .metadata
        .warnings
        .iter()
        .map(|w| format!("{:?}: {}", w.type_, w.description))
        .collect();
    let mut gltf_lights = Vec::new();
    let mut node_map = HashMap::new();
    for node in &scene.nodes {
        node_map.insert(node.element.typed_id, doc.nodes.len());
        let mut value = transform_json(node.local_transform)?;
        value["name"] = json!(node.element.name.to_string());
        value["extras"] = json!({"visible":node.visible});
        if let Some(camera) = node.camera.as_deref() {
            let camera_index = doc.cameras.len();
            doc.cameras.push(camera_json(camera)?);
            value["camera"] = json!(camera_index);
        }
        if let Some(light) = node.light.as_deref() {
            let (light_value, degraded) = light_json(light)?;
            let light_index = gltf_lights.len();
            gltf_lights.push(light_value);
            value["extensions"] = json!({
                "KHR_lights_punctual": { "light": light_index }
            });
            if degraded {
                warnings.push(format!(
                    "FBX {:?} light '{}' is approximated as a point light in preview GLB",
                    light.type_, node.element.name
                ));
            }
        }
        doc.nodes.push(value);
    }
    if !gltf_lights.is_empty() {
        doc.extensions_used.push("KHR_lights_punctual".into());
        doc.extensions.insert(
            "KHR_lights_punctual".into(),
            json!({ "lights": gltf_lights }),
        );
    }
    for node in &scene.nodes {
        let index = node_map[&node.element.typed_id];
        let children: Vec<usize> = node
            .children
            .iter()
            .filter_map(|child| node_map.get(&child.element.typed_id).copied())
            .collect();
        if !children.is_empty() {
            doc.nodes[index]["children"] = json!(children);
        }
    }
    let mut mesh_map = HashMap::new();
    let mut skin_map = HashMap::<u32, (usize, HashMap<u32, usize>)>::new();
    let mut mesh_nodes = HashMap::<u32, Vec<usize>>::new();
    let mut mesh_channels = HashMap::<u32, Vec<&ufbx::BlendChannel>>::new();
    for node in &scene.nodes {
        canceled(cancel)?;
        let Some(mesh) = node.mesh.as_deref() else {
            continue;
        };
        let gltf_mesh = if let Some(&index) = mesh_map.get(&mesh.element.typed_id) {
            index
        } else {
            let mut primitives = Vec::new();
            let parts: Vec<(usize, Vec<u32>)> = if mesh.material_parts.is_empty() {
                vec![(0, (0..mesh.faces.len() as u32).collect())]
            } else {
                mesh.material_parts
                    .iter()
                    .map(|p| (p.index as usize, p.face_indices.iter().copied().collect()))
                    .collect()
            };
            let skin_info = mesh
                .skin_deformers
                .first()
                .map(|skin| {
                    let entry = add_skin(&mut doc, skin, &node_map, cancel)?;
                    if let Some(entry) = entry.clone() {
                        skin_map.insert(mesh.element.typed_id, entry);
                    }
                    Ok::<_, AppError>(entry)
                })
                .transpose()?
                .flatten();
            let channels: Vec<&ufbx::BlendChannel> = mesh
                .blend_deformers
                .iter()
                .flat_map(|d| d.channels.iter().map(|c| &**c))
                .filter(|c| c.target_shape.is_some())
                .collect();
            for channel in &channels {
                if channel.keyframes.len() > 1 {
                    warnings.push(format!(
                        "FBX blend channel '{}' contains in-between shapes; preview keeps the final target shape",
                        channel.element.name
                    ));
                }
            }
            mesh_channels.insert(mesh.element.typed_id, channels.clone());
            for (part_index, faces) in parts {
                let data = primitive_data(mesh, &faces, cancel)?;
                if data.indices.is_empty() {
                    continue;
                }
                let count = data.control_points.len();
                let (min, max) = min_max(&data.positions);
                let position = doc.push_f32(
                    &data.positions,
                    Some(ARRAY_BUFFER),
                    count,
                    "VEC3",
                    Some(min),
                    Some(max),
                )?;
                let normal =
                    doc.push_f32(&data.normals, Some(ARRAY_BUFFER), count, "VEC3", None, None)?;
                let uv = doc.push_f32(&data.uvs, Some(ARRAY_BUFFER), count, "VEC2", None, None)?;
                let color =
                    doc.push_f32(&data.colors, Some(ARRAY_BUFFER), count, "VEC4", None, None)?;
                let indices = doc.push_u32_indices(&data.indices)?;
                let mut attrs =
                    json!({"POSITION":position,"NORMAL":normal,"TEXCOORD_0":uv,"COLOR_0":color});
                if let (Some(skin), Some((_, cluster_map))) =
                    (mesh.skin_deformers.first(), skin_info.as_ref())
                {
                    let (joints, weights) =
                        skin_attributes(skin, &data.control_points, cluster_map, cancel)?;
                    attrs["JOINTS_0"] = json!(doc.push_u16_vec4(&joints)?);
                    attrs["WEIGHTS_0"] = json!(doc.push_f32(
                        &weights,
                        Some(ARRAY_BUFFER),
                        count,
                        "VEC4",
                        None,
                        None
                    )?);
                }
                let material = mesh
                    .materials
                    .get(part_index)
                    .and_then(|m| material_map.get(&m.element.typed_id))
                    .copied()
                    .unwrap_or(0);
                let mut primitive =
                    json!({"attributes":attrs,"indices":indices,"material":material,"mode":4});
                if !channels.is_empty() {
                    let mut targets = Vec::new();
                    for channel in &channels {
                        canceled(cancel)?;
                        let shape = channel.target_shape.as_deref().unwrap();
                        let offsets = shape_offsets(shape, &data.control_points, cancel)?;
                        let accessor =
                            doc.push_f32(&offsets, Some(ARRAY_BUFFER), count, "VEC3", None, None)?;
                        let mut target = json!({"POSITION":accessor});
                        if let Some(normals) =
                            shape_normal_offsets(shape, &data.control_points, cancel)?
                        {
                            target["NORMAL"] = json!(doc.push_f32(
                                &normals,
                                Some(ARRAY_BUFFER),
                                count,
                                "VEC3",
                                None,
                                None
                            )?);
                        }
                        targets.push(target);
                    }
                    primitive["targets"] = json!(targets);
                }
                primitives.push(primitive);
            }
            let target_names: Vec<String> = channels
                .iter()
                .map(|c| c.element.name.to_string())
                .collect();
            let weights: Vec<f32> = channels
                .iter()
                .map(|c| f32v(c.weight / 100.0))
                .collect::<Result<_, _>>()?;
            let index = doc.meshes.len();
            doc.meshes.push(json!({"name":mesh.element.name.to_string(),"primitives":primitives,"weights":weights,"extras":{"targetNames":target_names}}));
            mesh_map.insert(mesh.element.typed_id, index);
            index
        };
        let node_index = node_map[&node.element.typed_id];
        doc.nodes[node_index]["mesh"] = json!(gltf_mesh);
        mesh_nodes
            .entry(mesh.element.typed_id)
            .or_default()
            .push(node_index);
        if let Some((skin_index, _)) = skin_map.get(&mesh.element.typed_id) {
            doc.nodes[node_index]["skin"] = json!(skin_index);
        }
    }
    // TransformRoot is ufbx's authoritative axis/unit conversion. Keep that
    // node instead of promoting its children or the conversion would be lost.
    let roots: Vec<usize> = node_map
        .get(&scene.root_node.element.typed_id)
        .copied()
        .into_iter()
        .collect();
    add_animations(
        &mut doc,
        scene,
        &node_map,
        &mesh_nodes,
        &mesh_channels,
        cancel,
    )?;
    let source_stats = json!({"nodes":scene.nodes.len(),"meshes":scene.meshes.len(),"materials":scene.materials.len(),"skins":scene.skin_deformers.len(),"blendChannels":scene.blend_channels.len(),"animationStacks":scene.anim_stacks.len(),"cameras":scene.cameras.len(),"lights":scene.lights.len(),"textures":scene.textures.len()});
    doc.scenes.push(json!({"nodes":roots,"extras":{"fbxWarnings":warnings.clone(),"fbxSourceStats":source_stats.clone(),"fbxTextureBindings":texture_bindings.clone()}}));
    doc.extras.insert("fbxWarnings".into(), json!(warnings));
    doc.extras.insert("fbxSourceStats".into(), source_stats);
    doc.extras
        .insert("fbxTextureBindings".into(), json!(texture_bindings));
    doc.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preview::glb::FLOAT;

    fn temporary_fixture_path(name: &str) -> std::path::PathBuf {
        let thread_name: String = std::thread::current()
            .name()
            .unwrap_or("test")
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() {
                    character
                } else {
                    '_'
                }
            })
            .collect();
        std::env::temp_dir().join(format!(
            "yw-look-{name}-{}-{}.fbx",
            std::process::id(),
            thread_name
        ))
    }

    #[test]
    fn unauthored_map_uses_fallback() {
        let map = ufbx::MaterialMap {
            value_vec4: ufbx::Vec4::default(),
            value_int: 0,
            texture: None,
            has_value: false,
            texture_enabled: false,
            feature_disabled: false,
            value_components: 0,
        };
        assert_eq!(map_value(&map, [1.0; 4]), [1.0; 4]);
    }

    #[test]
    fn authored_zero_emission_factor_disables_emission_color() {
        let make_map = |value: ufbx::Vec4| ufbx::MaterialMap {
            value_vec4: value,
            value_int: 0,
            texture: None,
            has_value: true,
            texture_enabled: false,
            feature_disabled: false,
            value_components: 4,
        };
        let color = make_map(ufbx::Vec4 {
            x: 0.8,
            y: 0.7,
            z: 0.6,
            w: 1.0,
        });
        let factor = make_map(ufbx::Vec4::default());
        assert_eq!(emission_value(&color, &factor), [0.0, 0.0, 0.0]);
    }

    #[test]
    fn authored_base_factor_is_a_scalar() {
        let factor = ufbx::MaterialMap {
            value_vec4: ufbx::Vec4 {
                x: 0.5,
                y: 0.0,
                z: 0.0,
                w: 0.0,
            },
            value_int: 0,
            texture: None,
            has_value: true,
            texture_enabled: false,
            feature_disabled: false,
            value_components: 1,
        };
        assert_eq!(scalar_map_value(&factor, 1.0), 0.5);
    }

    #[test]
    fn fbx_spot_angles_convert_to_gltf_half_cones() {
        let [inner, outer] = spot_cone_angles(30.0, 60.0);
        assert!((inner - 15.0_f64.to_radians()).abs() < 1e-12);
        assert!((outer - 30.0_f64.to_radians()).abs() < 1e-12);
    }

    #[test]
    fn unsupported_fbx_light_types_degrade_explicitly() {
        assert_eq!(gltf_light_type(ufbx::LightType::Area), ("point", true));
        assert_eq!(
            gltf_light_type(ufbx::LightType::Directional),
            ("directional", false)
        );
    }

    #[test]
    fn native_fbx_uv_is_not_inverted_twice() {
        assert_eq!(
            gltf_uv(ufbx::Vec2 { x: 0.25, y: 0.75 }).unwrap(),
            [0.25, 0.75]
        );
    }

    #[test]
    fn generated_preview_glb_has_valid_container() {
        let mut generated = GlbDocument::default();
        generated.scenes.push(json!({ "nodes": [] }));
        let bytes = generated
            .finish()
            .expect("empty preview document should serialize");
        assert!(bytes.len() > 20);
        assert_eq!(&bytes[..4], b"glTF");
        let total = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        assert_eq!(total, bytes.len());
        let json_len = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
        assert_eq!(&bytes[16..20], b"JSON");
        let document: Value = serde_json::from_slice(&bytes[20..20 + json_len]).unwrap();
        assert_eq!(document["asset"]["version"], "2.0");
        assert_eq!(document["scene"], 0);
        assert!(document["buffers"][0]["byteLength"].is_number());
    }

    #[test]
    fn skinned_preview_uses_geometry_space_conversion_for_three_skinning() {
        // FBX files with centimetre units expose a 0.01 TransformRoot. Three
        // applies that mounted-node transform after skinning, so retaining it
        // makes the root scale apply twice to the rendered mesh. Geometry-space
        // conversion keeps vertices, joints, and inverse binds in one space.
        assert_eq!(
            space_conversion_for_scene(true),
            ufbx::SpaceConversion::ModifyGeometry
        );
        assert_eq!(
            space_conversion_for_scene(false),
            ufbx::SpaceConversion::TransformRoot
        );
    }

    fn fixture_glb(name: &str) -> (Value, Vec<u8>) {
        let bytes = convert(
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("tests")
                .join("fixtures")
                .join("models")
                .join(name),
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap_or_else(|error| panic!("fixture {name} should convert: {error}"));
        let json_len = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
        let document: Value = serde_json::from_slice(&bytes[20..20 + json_len]).unwrap();
        let bin_header = 20 + json_len;
        let bin_len =
            u32::from_le_bytes(bytes[bin_header..bin_header + 4].try_into().unwrap()) as usize;
        let bin_start = bin_header + 8;
        (document, bytes[bin_start..bin_start + bin_len].to_vec())
    }

    fn accessor_f32(document: &Value, binary: &[u8], accessor_index: usize) -> Vec<f32> {
        let accessor = &document["accessors"][accessor_index];
        assert_eq!(accessor["componentType"], FLOAT);
        let view_index = accessor["bufferView"].as_u64().unwrap() as usize;
        let view = &document["bufferViews"][view_index];
        let offset = view["byteOffset"].as_u64().unwrap_or(0) as usize;
        let count = accessor["count"].as_u64().unwrap() as usize;
        let components = match accessor["type"].as_str().unwrap() {
            "SCALAR" => 1,
            "VEC3" => 3,
            _ => panic!("unexpected fixture accessor type"),
        };
        let byte_len = count * components * std::mem::size_of::<f32>();
        binary[offset..offset + byte_len]
            .chunks_exact(4)
            .map(|bytes| f32::from_le_bytes(bytes.try_into().unwrap()))
            .collect()
    }

    fn assert_translation_contract(
        document: &Value,
        binary: &[u8],
        name: &str,
        duration: f32,
        start: [f32; 3],
        end: [f32; 3],
    ) {
        let animation = document["animations"]
            .as_array()
            .unwrap()
            .iter()
            .find(|animation| animation["name"] == name)
            .unwrap_or_else(|| panic!("missing animation {name}"));
        let channels = animation["channels"].as_array().unwrap();
        let channel = channels
            .iter()
            .find(|channel| channel["target"]["path"] == "translation")
            .unwrap();
        let sampler_index = channel["sampler"].as_u64().unwrap() as usize;
        let sampler = &animation["samplers"][sampler_index];
        let times = accessor_f32(
            document,
            binary,
            sampler["input"].as_u64().unwrap() as usize,
        );
        let values = accessor_f32(
            document,
            binary,
            sampler["output"].as_u64().unwrap() as usize,
        );
        assert_eq!(times.first().copied().unwrap(), 0.0);
        assert!(
            (times.last().copied().unwrap() - duration).abs() < 1e-4,
            "{name}: expected duration {duration}, got times {times:?}"
        );
        assert_eq!(values.len() % 3, 0);
        assert!(start
            .iter()
            .zip(values[..3].iter())
            .all(|(expected, actual)| (expected - actual).abs() < 1e-4));
        assert!(
            end.iter()
                .zip(values[values.len() - 3..].iter())
                .all(|(expected, actual)| (expected - actual).abs() < 1e-4),
            "{name}: expected end {end:?}, got values {values:?}"
        );
    }

    #[test]
    fn native_fixture_take_preserves_name_range_and_endpoints() {
        let (document, binary) = fixture_glb("animated-triangle.fbx");
        assert_translation_contract(
            &document,
            &binary,
            "FixtureTake",
            1.0,
            [0.0, 0.0, 0.0],
            [0.0, 2.0, 0.0],
        );
    }

    #[test]
    fn native_fixture_takes_normalize_negative_start_and_preserve_endpoints() {
        let (document, binary) = fixture_glb("animated-take-ranges.fbx");
        assert_translation_contract(
            &document,
            &binary,
            "Take A",
            1.0,
            [0.0, 0.0, 0.0],
            [10.0, 0.0, 0.0],
        );
        assert_translation_contract(
            &document,
            &binary,
            "Take B",
            1.5,
            [-10.0, 0.0, 0.0],
            [5.0, 0.0, 0.0],
        );
    }

    #[test]
    fn malformed_and_truncated_fbx_fail_closed() {
        for (name, bytes) in [
            ("malformed", b"not an FBX".as_slice()),
            ("truncated", b"Kaydara FBX Binary  \0\x1a".as_slice()),
        ] {
            let path = temporary_fixture_path(name);
            std::fs::write(&path, bytes).unwrap();
            let result = convert(&path, Arc::new(AtomicBool::new(false)));
            let _ = std::fs::remove_file(&path);
            assert!(
                matches!(result, Err(AppError::Fbx(_))),
                "unexpected result: {result:?}"
            );
        }
    }

    #[test]
    fn pre_cancel_stops_before_glb_generation() {
        let path = temporary_fixture_path("pre-cancel");
        std::fs::write(&path, b"not an FBX").unwrap();
        let cancel = Arc::new(AtomicBool::new(true));
        let result = convert(&path, cancel);
        let _ = std::fs::remove_file(&path);
        assert!(matches!(result, Err(AppError::Cancelled)));
    }
}
