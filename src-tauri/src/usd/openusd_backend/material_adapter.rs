use std::collections::HashMap;

use openusd::sdf::schema::FieldKey;
use openusd::sdf::{Path as SdfPath, Value as SdfValue};
use openusd::Stage;

use crate::usd::glb;
use crate::usd::ir::MaterialData;
use crate::usd::material::{
    apply_material_wrap_tokens, apply_resolved_texture_transforms, build_material_slot_paths,
    is_preview_surface_shader_id, is_texture_shader_id, lookup_material_slot,
    material_input_from_preview_surface, register_material_slot, resolve_texture_sampler_node,
    select_wrap_sampler_source, texture_transform_from_usd_transform2d, PreviewSurfaceInput,
    ResolvedTextureSampler, TextureNodeGraph,
};

use super::shader_fields::{read_shader_color, read_shader_float, read_shader_token};
use super::stage_fields::read_token_or_string_field;
use super::LEGACY_TRAVERSE_PREDICATE;

/// Name-based material fallback for GeomSubsets without authored
/// `material:binding`. Searches sibling `Looks` scopes for a
/// Material whose prim name starts with the subset name. Returns
/// the first match, or `None` if no candidate is found.
pub(crate) fn find_material_by_name_fallback(
    stage: &Stage,
    mesh_path: &SdfPath,
    subset_name: &str,
) -> Option<SdfPath> {
    // Walk up from the mesh to find a parent that has a `Looks` child.
    let mut parent_str = mesh_path.as_str().to_string();
    loop {
        let Some(slash) = parent_str.rfind('/') else {
            break;
        };
        if slash == 0 {
            break;
        }
        parent_str.truncate(slash);

        let looks_str = format!("{}/Looks", parent_str);
        let Ok(looks_path) = SdfPath::new(&looks_str) else {
            continue;
        };

        // Check if Looks prim exists by reading its specifier.
        if stage
            .field::<SdfValue>(looks_path.clone(), FieldKey::Specifier)
            .ok()
            .flatten()
            .is_none()
        {
            continue;
        }

        // Found a Looks scope. Search its children for a Material
        // whose name starts with the subset name.
        let mut found: Option<SdfPath> = None;
        stage
            .traverse(LEGACY_TRAVERSE_PREDICATE, |prim_path| {
                if found.is_some() {
                    return;
                }
                let path_str = prim_path.as_str();
                if !path_str.starts_with(&looks_str) {
                    return;
                }
                // Direct child of Looks only (no deeper nesting)
                let remainder = &path_str[looks_str.len()..];
                if remainder.is_empty() || remainder.chars().filter(|c| *c == '/').count() != 1 {
                    return;
                }
                let child_name = remainder.trim_start_matches('/');
                if child_name.starts_with(subset_name)
                    && read_token_or_string_field(stage, prim_path.clone(), FieldKey::TypeName)
                        .as_deref()
                        == Some("Material")
                {
                    found = Some(prim_path.clone());
                }
            })
            .ok();

        if found.is_some() {
            return found;
        }
    }
    None
}

/// Resolve a material binding path → material slot index, creating
/// a new MaterialInput when the material is first seen.
///
/// Phase 6a: also walks the bound material's UsdShade graph to find a
/// `UsdPreviewSurface.inputs:normal` connection and records the asset
/// path of the connected `UsdUVTexture.inputs:file` into the parallel
/// `material_normal_paths` vector. The actual texture bytes are loaded
/// + embedded later in the same pass that handles base color textures.
pub(crate) fn resolve_material_slot(
    stage: &Stage,
    mat_path: Option<&SdfPath>,
    prim_path: &SdfPath,
    materials: &mut Vec<glb::MaterialInput>,
    material_texture_paths: &mut Vec<Option<String>>,
    material_normal_paths: &mut Vec<Option<String>>,
    material_slots: &mut HashMap<String, usize>,
) -> usize {
    let Some(mat_path) = mat_path else { return 0 };
    let key = mat_path.to_string();
    if let Some(existing) = lookup_material_slot(&key, material_slots) {
        return existing;
    }
    let data: Option<MaterialData> = stage.material_of(prim_path.clone()).map(Into::into);
    let surface_shader = find_preview_surface_shader(stage, mat_path);
    if data.is_none() && surface_shader.is_none() {
        return 0;
    }

    {
        let diffuse_tex = surface_shader
            .as_ref()
            .and_then(|shader| resolve_shader_texture_asset(stage, shader, "inputs:diffuseColor"));
        let tex_path = diffuse_tex
            .as_ref()
            .map(|tex| tex.asset_path.clone())
            .or_else(|| data.as_ref().and_then(|data| data.diffuse_texture.clone()));
        // Phase 6a: the fork's `MaterialData` does not carry a normal
        // texture field, so we walk the UsdShade graph ourselves
        // using the same public API surface (prim_children + field
        // with FieldKey::ConnectionPaths). When the fork eventually
        // grows `MaterialData::normal_texture`, this helper can be
        // collapsed to a single `data.normal_texture.clone()` line.
        let normal_tex = surface_shader
            .as_ref()
            .and_then(|shader| resolve_shader_texture_asset(stage, shader, "inputs:normal"));
        let mut mi = if let Some(data) = data.as_ref() {
            material_input_from_data(&key, data)
        } else {
            material_input_from_shader(
                stage,
                &key,
                surface_shader.as_ref().expect("surface shader"),
            )
        };
        let wrap_source = select_wrap_sampler_source(
            diffuse_tex.as_ref(),
            normal_tex.as_ref(),
            tex_path.is_none(),
        );
        if let Some(tex) = wrap_source {
            let wrap_s = read_shader_token(stage, &tex.sampler_node, "inputs:wrapS");
            let wrap_t = read_shader_token(stage, &tex.sampler_node, "inputs:wrapT");
            apply_material_wrap_tokens(&mut mi, wrap_s.as_deref(), wrap_t.as_deref());
        }
        // Phase 6b: texture transforms live alongside the texture
        // slot on the MaterialInput itself; probe the UsdShade graph
        // for a UsdTransform2d between the UsdUVTexture and
        // PrimvarReader, and drop identity transforms so the GLB
        // stays minimal.
        apply_resolved_texture_transforms(
            &mut mi,
            diffuse_tex.as_ref(),
            normal_tex.as_ref(),
            |node| resolve_texture_transform_from_sampler(stage, node),
        );
        mi.base_color_texture_transform = mi
            .base_color_texture_transform
            .or_else(|| resolve_texture_transform(stage, mat_path, "inputs:diffuseColor"));
        register_material_slot(
            &key,
            mi,
            build_material_slot_paths(tex_path, normal_tex.as_ref(), None),
            materials,
            material_slots,
            material_texture_paths,
            material_normal_paths,
            None,
        )
    }
}

/// Walk the UsdShade graph rooted at a Material prim looking for a
/// `UsdPreviewSurface.inputs:normal` connection that targets a
/// `UsdUVTexture` (or MaterialX equivalent). Returns the texture
/// asset path on success, `None` when any step in the chain is
/// missing or has the wrong type.
///
/// Mirrors the logic of the fork's private `find_preview_surface_shader`
/// + `follow_texture_connection` helpers (stage.rs:773 / 921). When
/// `MaterialData` grows a `normal_texture` field upstream, this
/// function becomes redundant and the call site can use it directly.
fn resolve_shader_texture_asset(
    stage: &Stage,
    shader_path: &SdfPath,
    input_name: &str,
) -> Option<ResolvedTextureSampler<SdfPath>> {
    let input_path = shader_path.append_property(input_name).ok()?;
    let texture_shader = follow_connection_to_shader(stage, &input_path)?;
    let graph = RustTextureNodeGraph { stage };
    resolve_texture_sampler_node(&graph, &texture_shader, 0)
}

/// Find a child Shader of `material_path` whose `info:id` is a
/// UsdPreviewSurface or a known MaterialX alias. Walks direct children
/// only (the standard Material-Shader layout); if a real asset wraps
/// the shader inside nested NodeGraphs we'll miss it, which is the
/// same single-hop limitation `material_of` has for the diffuse channel.
fn find_preview_surface_shader(stage: &Stage, material_path: &SdfPath) -> Option<SdfPath> {
    let children = stage.prim_children(material_path.clone()).ok()?;
    for child_name in children {
        // SdfPath has no `append_child`; compose the child path via
        // string concat (same pattern used for GeomSubset names).
        let child = SdfPath::new(&format!("{}/{}", material_path.as_str(), child_name)).ok()?;
        if read_token_or_string_field(stage, child.clone(), FieldKey::TypeName).as_deref()
            != Some("Shader")
        {
            continue;
        }
        let info_id_path = child.append_property("info:id").ok()?;
        let info_id = read_token_or_string_field(stage, info_id_path, FieldKey::Default);
        if is_preview_surface_shader_id(info_id.as_deref()) {
            return Some(child);
        }
    }
    None
}

struct RustTextureNodeGraph<'a> {
    stage: &'a Stage,
}

impl TextureNodeGraph for RustTextureNodeGraph<'_> {
    type Node = SdfPath;

    fn shader_id(&self, node: &Self::Node) -> Option<String> {
        let info_id_path = node.append_property("info:id").ok()?;
        read_token_or_string_field(self.stage, info_id_path, FieldKey::Default)
    }

    fn shader_input_asset(&self, node: &Self::Node, input_name: &str) -> Option<String> {
        let file_path = node.append_property(input_name).ok()?;
        let value: Option<SdfValue> = self
            .stage
            .field(file_path, FieldKey::Default)
            .ok()
            .flatten();
        match value? {
            SdfValue::AssetPath(s) => Some(s.to_string()),
            SdfValue::String(s) => Some(s),
            SdfValue::Token(s) => Some(s.as_str().to_owned()),
            _ => None,
        }
    }

    fn shader_input_connected_source(
        &self,
        node: &Self::Node,
        input_name: &str,
    ) -> Option<Self::Node> {
        let input_path = node.append_property(input_name).ok()?;
        follow_connection_to_shader(self.stage, &input_path)
    }
}

/// Phase 6b: follow the UsdShade graph from a Material prim down to
/// the `UsdUVTexture` node bound to `surface_input_name`
/// (`"inputs:diffuseColor"` / `"inputs:normal"`), then probe that
/// texture node's `inputs:st` for a `UsdTransform2d` hop. Returns
/// the authored transform as a `glb::TextureTransform`, or `None`
/// when:
///
///   - the surface / texture / transform chain is missing at any step
///   - the transform is the identity (we'd emit a no-op extension)
///
/// Reads:
///
///   - `UsdTransform2d.inputs:translation` — `float2` or `double2`
///   - `UsdTransform2d.inputs:rotation` — `float` or `double`, in
///     **degrees** per the UsdPreviewSurface spec
///   - `UsdTransform2d.inputs:scale` — `float2` or `double2`
///
/// Default values follow the UsdPreviewSurface spec: translation
/// `(0, 0)`, rotation `0°`, scale `(1, 1)`.
fn resolve_texture_transform(
    stage: &Stage,
    material_path: &SdfPath,
    surface_input_name: &str,
) -> Option<glb::TextureTransform> {
    let surface_shader = find_preview_surface_shader(stage, material_path)?;
    let surface_input = surface_shader.append_property(surface_input_name).ok()?;
    let texture_shader = follow_connection_to_shader(stage, &surface_input)?;
    let graph = RustTextureNodeGraph { stage };
    if !is_texture_shader_id(graph.shader_id(&texture_shader).as_deref()) {
        return None;
    }
    resolve_texture_transform_from_sampler(stage, &texture_shader)
}

fn resolve_texture_transform_from_sampler(
    stage: &Stage,
    texture_shader: &SdfPath,
) -> Option<glb::TextureTransform> {
    let st_input = texture_shader.append_property("inputs:st").ok()?;
    let transform_shader = follow_connection_to_shader(stage, &st_input)?;
    let info_id_path = transform_shader.append_property("info:id").ok()?;
    let info_id = read_token_or_string_field(stage, info_id_path, FieldKey::Default);
    texture_transform_from_usd_transform2d(
        info_id.as_deref(),
        read_vec2_input(stage, &transform_shader, "inputs:translation"),
        read_scalar_input(stage, &transform_shader, "inputs:rotation"),
        read_vec2_input(stage, &transform_shader, "inputs:scale"),
    )
}

/// Follow one `ConnectionPaths` hop from a property path and return
/// the target shader's prim path (property suffix stripped). Returns
/// `None` when the property has no authored connection or the target
/// resolves to something other than a Shader prim.
fn follow_connection_to_shader(stage: &Stage, input_path: &SdfPath) -> Option<SdfPath> {
    let connections: Option<SdfValue> = stage
        .field(input_path.clone(), FieldKey::ConnectionPaths)
        .ok()
        .flatten();
    let list_op = match connections? {
        SdfValue::PathListOp(op) => op,
        _ => return None,
    };
    let target = list_op.iter().next()?.clone();
    let shader_path = target.prim_path();
    if read_token_or_string_field(stage, shader_path.clone(), FieldKey::TypeName).as_deref()
        != Some("Shader")
    {
        return None;
    }
    Some(shader_path)
}

/// Read a scalar float-like input on a shader prim. Accepts both
/// `float` and `double` authoring; other numeric types are ignored.
fn read_scalar_input(stage: &Stage, shader_path: &SdfPath, input_name: &str) -> Option<f32> {
    let prop_path = shader_path.append_property(input_name).ok()?;
    let value: SdfValue = stage.field(prop_path, FieldKey::Default).ok().flatten()?;
    match value {
        SdfValue::Float(v) => Some(v),
        SdfValue::Double(v) => Some(v as f32),
        _ => None,
    }
}

/// Read a vec2 float-like input on a shader prim. Accepts both
/// `float2` and `double2` authoring; other types fall through.
fn read_vec2_input(stage: &Stage, shader_path: &SdfPath, input_name: &str) -> Option<[f32; 2]> {
    let prop_path = shader_path.append_property(input_name).ok()?;
    let value: SdfValue = stage.field(prop_path, FieldKey::Default).ok().flatten()?;
    match value {
        SdfValue::Vec2f(v) => Some(v.into()),
        SdfValue::Vec2d(v) => Some([v[0] as f32, v[1] as f32]),
        _ => None,
    }
}

/// Convert a fork-level `MaterialData` (scalar PBR factors resolved
/// from a `UsdPreviewSurface` shader) into a yw-look `MaterialInput`
/// ready for the GLB builder.
///
/// **Unauthored channels fall back to the `UsdPreviewSurface` schema
/// defaults — not yw-look's neutral preview material.** A USD asset
/// that authors only `diffuseColor` should still see the spec
/// `roughness = 0.5`, `metallic = 0.0`, opacity 1, etc., not
/// yw-look's grey-rough fallback. The yw-look default is only used
/// when a mesh is not bound to any material at all (slot 0 of the
/// GLB materials array).
///
/// sRGB base color values are linearized here because glTF specifies
/// `baseColorFactor` in linear space; emissive is already linear in
/// `MaterialData` and passes through untouched.
///
/// `diffuse_texture` is handled by the call site alongside graph-walked
/// texture references so texture loading, dedupe, and scalar fallback
/// stay in one place.
fn material_input_from_data(name: &str, data: &MaterialData) -> glb::MaterialInput {
    material_input_from_preview_surface(PreviewSurfaceInput {
        name,
        diffuse_color: data.diffuse_color,
        opacity: data.opacity,
        metallic: data.metallic,
        roughness: data.roughness,
        emissive_color: data.emissive_color,
        wrap_s: data.wrap_s.as_deref(),
        wrap_t: data.wrap_t.as_deref(),
        opacity_threshold: None,
    })
}

fn material_input_from_shader(
    stage: &Stage,
    name: &str,
    shader_path: &SdfPath,
) -> glb::MaterialInput {
    material_input_from_preview_surface(PreviewSurfaceInput {
        name,
        diffuse_color: read_shader_color(stage, shader_path, "inputs:diffuseColor"),
        opacity: read_shader_float(stage, shader_path, "inputs:opacity"),
        metallic: read_shader_float(stage, shader_path, "inputs:metallic"),
        roughness: read_shader_float(stage, shader_path, "inputs:roughness"),
        emissive_color: read_shader_color(stage, shader_path, "inputs:emissiveColor"),
        wrap_s: None,
        wrap_t: None,
        opacity_threshold: None,
    })
}
