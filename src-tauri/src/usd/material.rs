//! Backend-independent UsdPreviewSurface material helpers.

use std::collections::HashMap;

use super::extract_shared::{srgb_to_linear, usd_wrap_to_gltf};
use super::glb::{AlphaMode, MaterialInput, TextureTransform};

const USD_DIFFUSE_DEFAULT: [f32; 3] = [0.18, 0.18, 0.18];
const USD_METALLIC_DEFAULT: f32 = 0.0;
const USD_ROUGHNESS_DEFAULT: f32 = 0.5;
const USD_OPACITY_DEFAULT: f32 = 1.0;
const USD_EMISSIVE_DEFAULT: [f32; 3] = [0.0, 0.0, 0.0];

pub(crate) fn is_preview_surface_shader_id(id: Option<&str>) -> bool {
    matches!(
        id,
        Some("UsdPreviewSurface")
            | Some("ND_UsdPreviewSurface_surfaceshader")
            | Some("ND_UsdPreviewSurface")
    )
}

pub(crate) fn is_texture_shader_id(id: Option<&str>) -> bool {
    matches!(
        id,
        Some("UsdUVTexture")
            | Some("ND_image_color3")
            | Some("ND_image_color4")
            | Some("ND_image_vector2")
            | Some("ND_image_vector3")
            | Some("ND_image_vector4")
            | Some("ND_image_float")
            | Some("ND_tiledimage_color3")
            | Some("ND_tiledimage_color4")
    )
}

const MAX_TEXTURE_NODE_DEPTH: u32 = 4;
const NORMALMAP_INPUT: &str = "inputs:in";
const TEXTURE_FILE_INPUT: &str = "inputs:file";

pub(crate) struct ResolvedTextureSampler<N> {
    pub(crate) asset_path: String,
    pub(crate) sampler_node: N,
}

pub(crate) trait TextureNodeGraph {
    type Node: Clone;

    fn shader_id(&self, node: &Self::Node) -> Option<String>;
    fn shader_input_asset(&self, node: &Self::Node, input_name: &str) -> Option<String>;
    fn shader_input_connected_source(
        &self,
        node: &Self::Node,
        input_name: &str,
    ) -> Option<Self::Node>;
}

pub(crate) fn resolve_texture_sampler_node<G: TextureNodeGraph>(
    graph: &G,
    node: &G::Node,
    depth: u32,
) -> Option<ResolvedTextureSampler<G::Node>> {
    if depth > MAX_TEXTURE_NODE_DEPTH {
        return None;
    }
    match graph.shader_id(node).as_deref() {
        id if is_texture_shader_id(id) => {
            graph
                .shader_input_asset(node, TEXTURE_FILE_INPUT)
                .map(|asset_path| ResolvedTextureSampler {
                    asset_path,
                    sampler_node: node.clone(),
                })
        }
        Some("ND_normalmap") => {
            let next = graph.shader_input_connected_source(node, NORMALMAP_INPUT)?;
            resolve_texture_sampler_node(graph, &next, depth + 1)
        }
        _ => None,
    }
}

pub(crate) struct PreviewSurfaceInput<'a> {
    pub(crate) name: &'a str,
    pub(crate) diffuse_color: Option<[f32; 3]>,
    pub(crate) opacity: Option<f32>,
    pub(crate) metallic: Option<f32>,
    pub(crate) roughness: Option<f32>,
    pub(crate) emissive_color: Option<[f32; 3]>,
    pub(crate) wrap_s: Option<&'a str>,
    pub(crate) wrap_t: Option<&'a str>,
    /// `None` keeps Rust-fork behavior: leave alpha mode unset and let
    /// GLB serialization apply its legacy alpha fallback from opacity.
    pub(crate) opacity_threshold: Option<f32>,
}

pub(crate) fn material_input_from_preview_surface(input: PreviewSurfaceInput<'_>) -> MaterialInput {
    let diffuse = input.diffuse_color.unwrap_or(USD_DIFFUSE_DEFAULT);
    let opacity = input.opacity.unwrap_or(USD_OPACITY_DEFAULT).clamp(0.0, 1.0);
    let (alpha_mode, alpha_cutoff) = resolve_preview_alpha(opacity, input.opacity_threshold);

    let mut material = MaterialInput {
        name: format!("usd:{}", input.name),
        base_color_factor: [
            srgb_to_linear(diffuse[0]),
            srgb_to_linear(diffuse[1]),
            srgb_to_linear(diffuse[2]),
            opacity,
        ],
        metallic_factor: input.metallic.unwrap_or(USD_METALLIC_DEFAULT),
        roughness_factor: input.roughness.unwrap_or(USD_ROUGHNESS_DEFAULT),
        emissive_factor: input.emissive_color.unwrap_or(USD_EMISSIVE_DEFAULT),
        double_sided: true,
        base_color_texture: None,
        normal_texture: None,
        base_color_texture_transform: None,
        normal_texture_transform: None,
        wrap_s: 10497,
        wrap_t: 10497,
        alpha_mode,
        alpha_cutoff,
        metallic_roughness_texture: None,
    };
    apply_material_wrap_tokens(&mut material, input.wrap_s, input.wrap_t);
    material
}

pub(crate) fn apply_material_wrap_tokens(
    material: &mut MaterialInput,
    wrap_s: Option<&str>,
    wrap_t: Option<&str>,
) {
    material.wrap_s = usd_wrap_to_gltf(wrap_s);
    material.wrap_t = usd_wrap_to_gltf(wrap_t);
}

/// Picks the resolved texture sampler that supplies material-level
/// `wrapS/T`. Diffuse wins when present. Rust passes
/// `tex_path.is_none()` to block normal fallback when the fork's
/// `MaterialData.diffuse_texture` already supplies a diffuse texture
/// path; C++ passes `true` because it has no equivalent side channel.
pub(crate) fn select_wrap_sampler_source<'a, N>(
    diffuse: Option<&'a ResolvedTextureSampler<N>>,
    normal: Option<&'a ResolvedTextureSampler<N>>,
    allow_normal_fallback: bool,
) -> Option<&'a ResolvedTextureSampler<N>> {
    diffuse.or_else(|| if allow_normal_fallback { normal } else { None })
}

/// Replaces both texture-transform slots from already-resolved texture
/// sampler nodes. Call this before any backend-local fallback that wants
/// to fill a missing transform.
pub(crate) fn apply_resolved_texture_transforms<N, F>(
    material: &mut MaterialInput,
    diffuse: Option<&ResolvedTextureSampler<N>>,
    normal: Option<&ResolvedTextureSampler<N>>,
    mut resolve_transform: F,
) where
    F: FnMut(&N) -> Option<TextureTransform>,
{
    material.base_color_texture_transform =
        diffuse.and_then(|tex| resolve_transform(&tex.sampler_node));
    material.normal_texture_transform = normal.and_then(|tex| resolve_transform(&tex.sampler_node));
}

pub(crate) fn texture_transform_from_usd_transform2d(
    shader_id: Option<&str>,
    translation: Option<[f32; 2]>,
    rotation_deg: Option<f32>,
    scale: Option<[f32; 2]>,
) -> Option<TextureTransform> {
    if shader_id != Some("UsdTransform2d") {
        return None;
    }

    let transform = TextureTransform {
        offset: translation.unwrap_or([0.0, 0.0]),
        rotation: rotation_deg.unwrap_or(0.0).to_radians(),
        scale: scale.unwrap_or([1.0, 1.0]),
    };
    if transform.is_identity() {
        None
    } else {
        Some(transform)
    }
}

pub(crate) struct MaterialSlotPaths {
    pub(crate) texture: Option<String>,
    pub(crate) normal: Option<String>,
    pub(crate) metal_rough: Option<String>,
}

pub(crate) fn build_material_slot_paths<N>(
    texture: Option<String>,
    normal: Option<&ResolvedTextureSampler<N>>,
    metal_rough: Option<String>,
) -> MaterialSlotPaths {
    MaterialSlotPaths {
        texture,
        normal: normal.map(|tex| tex.asset_path.clone()),
        metal_rough,
    }
}

pub(crate) fn lookup_material_slot(
    key: &str,
    material_slots: &HashMap<String, usize>,
) -> Option<usize> {
    material_slots.get(key).copied()
}

pub(crate) fn register_material_slot(
    key: &str,
    material: MaterialInput,
    paths: MaterialSlotPaths,
    materials: &mut Vec<MaterialInput>,
    material_slots: &mut HashMap<String, usize>,
    material_texture_paths: &mut Vec<Option<String>>,
    material_normal_paths: &mut Vec<Option<String>>,
    material_metal_rough_paths: Option<&mut Vec<Option<String>>>,
) -> usize {
    let slot = materials.len();
    materials.push(material);
    material_texture_paths.push(paths.texture);
    material_normal_paths.push(paths.normal);
    if let Some(paths_out) = material_metal_rough_paths {
        paths_out.push(paths.metal_rough);
    }
    material_slots.insert(key.to_string(), slot);
    slot
}

fn resolve_preview_alpha(opacity: f32, opacity_threshold: Option<f32>) -> (Option<AlphaMode>, f32) {
    let Some(threshold) = opacity_threshold else {
        return (None, 0.5);
    };
    let threshold = threshold.clamp(0.0, 1.0);
    if threshold > 0.0 {
        return (Some(AlphaMode::Mask), threshold);
    }
    if opacity < 1.0 {
        return (Some(AlphaMode::Blend), 0.5);
    }
    (None, 0.5)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct FakeTextureGraph {
        nodes: HashMap<&'static str, FakeTextureNode>,
    }

    struct FakeTextureNode {
        shader_id: &'static str,
        file: Option<&'static str>,
        input: Option<&'static str>,
    }

    impl FakeTextureGraph {
        fn with(
            mut self,
            node: &'static str,
            shader_id: &'static str,
            file: Option<&'static str>,
            input: Option<&'static str>,
        ) -> Self {
            self.nodes.insert(
                node,
                FakeTextureNode {
                    shader_id,
                    file,
                    input,
                },
            );
            self
        }
    }

    impl TextureNodeGraph for FakeTextureGraph {
        type Node = &'static str;

        fn shader_id(&self, node: &Self::Node) -> Option<String> {
            self.nodes.get(node).map(|node| node.shader_id.to_string())
        }

        fn shader_input_asset(&self, node: &Self::Node, input_name: &str) -> Option<String> {
            if input_name != "inputs:file" {
                return None;
            }
            self.nodes
                .get(node)
                .and_then(|node| node.file)
                .map(str::to_string)
        }

        fn shader_input_connected_source(
            &self,
            node: &Self::Node,
            input_name: &str,
        ) -> Option<Self::Node> {
            if input_name != "inputs:in" {
                return None;
            }
            self.nodes.get(node).and_then(|node| node.input)
        }
    }

    fn input(name: &str) -> PreviewSurfaceInput<'_> {
        PreviewSurfaceInput {
            name,
            diffuse_color: None,
            opacity: None,
            metallic: None,
            roughness: None,
            emissive_color: None,
            wrap_s: None,
            wrap_t: None,
            opacity_threshold: None,
        }
    }

    #[test]
    fn material_slot_lookup_misses_then_hits() {
        let mut slots = HashMap::new();

        assert_eq!(lookup_material_slot("/Looks/Mat", &slots), None);
        slots.insert("/Looks/Mat".to_string(), 3);

        assert_eq!(lookup_material_slot("/Looks/Mat", &slots), Some(3));
    }

    #[test]
    fn register_material_slot_uses_pre_push_len_and_records_lookup() {
        let mut materials = vec![MaterialInput::default_preview()];
        let mut slots = HashMap::new();
        let mut texture_paths = vec![None];
        let mut normal_paths = vec![None];
        let mut metal_rough_paths = vec![None];

        let slot = register_material_slot(
            "/Looks/Mat",
            MaterialInput {
                name: "usd:/Looks/Mat".to_string(),
                ..MaterialInput::default_preview()
            },
            MaterialSlotPaths {
                texture: Some("base.png".to_string()),
                normal: Some("normal.png".to_string()),
                metal_rough: Some("orm.png".to_string()),
            },
            &mut materials,
            &mut slots,
            &mut texture_paths,
            &mut normal_paths,
            Some(&mut metal_rough_paths),
        );

        assert_eq!(slot, 1);
        assert_eq!(lookup_material_slot("/Looks/Mat", &slots), Some(1));
        assert_eq!(materials[slot].name, "usd:/Looks/Mat");
        assert_eq!(texture_paths[slot].as_deref(), Some("base.png"));
        assert_eq!(normal_paths[slot].as_deref(), Some("normal.png"));
        assert_eq!(metal_rough_paths[slot].as_deref(), Some("orm.png"));
    }

    #[test]
    fn register_material_slot_keeps_parallel_vectors_aligned() {
        let mut materials = vec![MaterialInput::default_preview()];
        let mut slots = HashMap::new();
        let mut texture_paths = vec![None];
        let mut normal_paths = vec![None];
        let mut metal_rough_paths = vec![None];

        for idx in 0..3 {
            register_material_slot(
                &format!("/Looks/Mat{idx}"),
                MaterialInput::default_preview(),
                MaterialSlotPaths {
                    texture: Some(format!("base{idx}.png")),
                    normal: None,
                    metal_rough: Some(format!("orm{idx}.png")),
                },
                &mut materials,
                &mut slots,
                &mut texture_paths,
                &mut normal_paths,
                Some(&mut metal_rough_paths),
            );
        }

        assert_eq!(texture_paths.len(), materials.len());
        assert_eq!(normal_paths.len(), materials.len());
        assert_eq!(metal_rough_paths.len(), materials.len());
        assert_eq!(slots.len(), 3);
    }

    #[test]
    fn register_material_slot_can_skip_metal_rough_sidecar() {
        let mut materials = vec![MaterialInput::default_preview()];
        let mut slots = HashMap::new();
        let mut texture_paths = vec![None];
        let mut normal_paths = vec![None];

        let slot = register_material_slot(
            "/Looks/RustOnly",
            MaterialInput::default_preview(),
            MaterialSlotPaths {
                texture: None,
                normal: Some("normal.png".to_string()),
                metal_rough: Some("ignored-when-sidecar-absent.png".to_string()),
            },
            &mut materials,
            &mut slots,
            &mut texture_paths,
            &mut normal_paths,
            None,
        );

        assert_eq!(slot, 1);
        assert_eq!(materials.len(), 2);
        assert_eq!(texture_paths.len(), 2);
        assert_eq!(normal_paths.len(), 2);
        assert_eq!(normal_paths[slot].as_deref(), Some("normal.png"));
    }

    #[test]
    fn build_material_slot_paths_maps_normal_asset_path() {
        let normal = ResolvedTextureSampler {
            asset_path: "normal.png".to_string(),
            sampler_node: "normal",
        };

        let paths = build_material_slot_paths(Some("base.png".to_string()), Some(&normal), None);

        assert_eq!(paths.texture.as_deref(), Some("base.png"));
        assert_eq!(paths.normal.as_deref(), Some("normal.png"));
        assert_eq!(paths.metal_rough, None);
    }

    #[test]
    fn build_material_slot_paths_passes_backend_local_fields_through() {
        let normal = ResolvedTextureSampler {
            asset_path: "normal.png".to_string(),
            sampler_node: "normal",
        };

        let rust_paths =
            build_material_slot_paths::<&str>(Some("fork-fallback.png".to_string()), None, None);
        let cpp_paths = build_material_slot_paths(None, Some(&normal), Some("orm.png".to_string()));

        assert_eq!(rust_paths.texture.as_deref(), Some("fork-fallback.png"));
        assert_eq!(rust_paths.normal, None);
        assert_eq!(rust_paths.metal_rough, None);
        assert_eq!(cpp_paths.texture, None);
        assert_eq!(cpp_paths.normal.as_deref(), Some("normal.png"));
        assert_eq!(cpp_paths.metal_rough.as_deref(), Some("orm.png"));
    }

    #[test]
    fn build_material_slot_paths_all_none_when_inputs_missing() {
        let paths = build_material_slot_paths::<&str>(None, None, None);

        assert_eq!(paths.texture, None);
        assert_eq!(paths.normal, None);
        assert_eq!(paths.metal_rough, None);
    }

    #[test]
    fn preview_surface_shader_id_accepts_usd_and_materialx_aliases() {
        assert!(is_preview_surface_shader_id(Some("UsdPreviewSurface")));
        assert!(is_preview_surface_shader_id(Some(
            "ND_UsdPreviewSurface_surfaceshader"
        )));
        assert!(is_preview_surface_shader_id(Some("ND_UsdPreviewSurface")));
    }

    #[test]
    fn preview_surface_shader_id_rejects_missing_partial_and_texture_ids() {
        assert!(!is_preview_surface_shader_id(None));
        assert!(!is_preview_surface_shader_id(Some("")));
        assert!(!is_preview_surface_shader_id(Some(
            "ND_UsdPreviewSurface_surfaceshader_extra"
        )));
        assert!(!is_preview_surface_shader_id(Some("ND_UsdPreviewSurface2")));
        assert!(!is_preview_surface_shader_id(Some("UsdUVTexture")));
        assert!(!is_preview_surface_shader_id(Some("ND_image_color3")));
    }

    #[test]
    fn texture_shader_id_accepts_usd_and_materialx_image_nodes() {
        for id in [
            "UsdUVTexture",
            "ND_image_color3",
            "ND_image_color4",
            "ND_image_vector2",
            "ND_image_vector3",
            "ND_image_vector4",
            "ND_image_float",
            "ND_tiledimage_color3",
            "ND_tiledimage_color4",
        ] {
            assert!(is_texture_shader_id(Some(id)), "{id}");
        }
    }

    #[test]
    fn texture_shader_id_rejects_missing_partial_surface_and_wrappers() {
        for id in [
            None,
            Some(""),
            Some("ND_image_color3_extra"),
            Some("ND_tiledimage_color3_suffix"),
            Some("UsdPreviewSurface"),
            Some("ND_UsdPreviewSurface"),
            Some("ND_UsdPreviewSurface_surfaceshader"),
            Some("ND_normalmap"),
        ] {
            assert!(!is_texture_shader_id(id), "{id:?}");
        }
    }

    #[test]
    fn texture_sampler_node_resolves_terminal_texture() {
        let graph = FakeTextureGraph::default().with(
            "/Tex",
            "ND_image_vector3",
            Some("./normal.png"),
            None,
        );

        let resolved = resolve_texture_sampler_node(&graph, &"/Tex", 0).expect("resolved texture");

        assert_eq!(resolved.asset_path, "./normal.png");
        assert_eq!(resolved.sampler_node, "/Tex");
    }

    #[test]
    fn texture_sampler_node_walks_normalmap_wrapper() {
        let graph = FakeTextureGraph::default()
            .with("/NormalMap", "ND_normalmap", None, Some("/Tex"))
            .with("/Tex", "ND_image_vector3", Some("./normal.png"), None);

        let resolved =
            resolve_texture_sampler_node(&graph, &"/NormalMap", 0).expect("resolved texture");

        assert_eq!(resolved.asset_path, "./normal.png");
        assert_eq!(resolved.sampler_node, "/Tex");
    }

    #[test]
    fn texture_sampler_node_rejects_unsupported_missing_and_cyclic_nodes() {
        let unsupported =
            FakeTextureGraph::default().with("/Noise", "ND_noise3d", Some("./noise.png"), None);
        assert!(resolve_texture_sampler_node(&unsupported, &"/Noise", 0).is_none());

        let missing_file = FakeTextureGraph::default().with("/Tex", "UsdUVTexture", None, None);
        assert!(resolve_texture_sampler_node(&missing_file, &"/Tex", 0).is_none());

        let missing_input =
            FakeTextureGraph::default().with("/NormalMap", "ND_normalmap", None, None);
        assert!(resolve_texture_sampler_node(&missing_input, &"/NormalMap", 0).is_none());

        let cycle = FakeTextureGraph::default().with(
            "/NormalMap",
            "ND_normalmap",
            None,
            Some("/NormalMap"),
        );
        assert!(resolve_texture_sampler_node(&cycle, &"/NormalMap", 0).is_none());
    }

    #[test]
    fn texture_sampler_node_depth_boundary_matches_cpp_backend() {
        let succeeds_at_depth_four = FakeTextureGraph::default()
            .with("/Wrap0", "ND_normalmap", None, Some("/Wrap1"))
            .with("/Wrap1", "ND_normalmap", None, Some("/Wrap2"))
            .with("/Wrap2", "ND_normalmap", None, Some("/Wrap3"))
            .with("/Wrap3", "ND_normalmap", None, Some("/Tex"))
            .with("/Tex", "ND_image_vector3", Some("./normal.png"), None);
        let resolved = resolve_texture_sampler_node(&succeeds_at_depth_four, &"/Wrap0", 0)
            .expect("depth four terminal should resolve");
        assert_eq!(resolved.asset_path, "./normal.png");
        assert_eq!(resolved.sampler_node, "/Tex");

        let fails_at_depth_five = FakeTextureGraph::default()
            .with("/Wrap0", "ND_normalmap", None, Some("/Wrap1"))
            .with("/Wrap1", "ND_normalmap", None, Some("/Wrap2"))
            .with("/Wrap2", "ND_normalmap", None, Some("/Wrap3"))
            .with("/Wrap3", "ND_normalmap", None, Some("/Wrap4"))
            .with("/Wrap4", "ND_normalmap", None, Some("/Tex"))
            .with("/Tex", "ND_image_vector3", Some("./normal.png"), None);
        assert!(resolve_texture_sampler_node(&fails_at_depth_five, &"/Wrap0", 0).is_none());
    }

    #[test]
    fn schema_defaults_all_unauthored() {
        let material = material_input_from_preview_surface(input("/Root/Looks/Default"));

        assert_eq!(material.name, "usd:/Root/Looks/Default");
        assert!((material.base_color_factor[0] - srgb_to_linear(0.18)).abs() < 1e-6);
        assert!((material.base_color_factor[1] - srgb_to_linear(0.18)).abs() < 1e-6);
        assert!((material.base_color_factor[2] - srgb_to_linear(0.18)).abs() < 1e-6);
        assert_eq!(material.base_color_factor[3], 1.0);
        assert_eq!(material.metallic_factor, 0.0);
        assert_eq!(material.roughness_factor, 0.5);
        assert_eq!(material.emissive_factor, [0.0, 0.0, 0.0]);
    }

    #[test]
    fn partial_diffuse_only_uses_usd_schema_defaults_not_preview_defaults() {
        let mut input = input("/Root/Looks/Red");
        input.diffuse_color = Some([1.0, 0.0, 0.0]);

        let material = material_input_from_preview_surface(input);

        assert_eq!(material.base_color_factor, [1.0, 0.0, 0.0, 1.0]);
        assert_eq!(material.metallic_factor, 0.0);
        assert_eq!(material.roughness_factor, 0.5);
    }

    #[test]
    fn diffuse_srgb_is_linearized_but_emissive_passes_through() {
        let mut input = input("/Root/Looks/Blue");
        input.diffuse_color = Some([0.1, 0.3, 0.9]);
        input.emissive_color = Some([0.1, 0.3, 0.9]);

        let material = material_input_from_preview_surface(input);

        assert_eq!(
            material.base_color_factor,
            [
                srgb_to_linear(0.1),
                srgb_to_linear(0.3),
                srgb_to_linear(0.9),
                1.0
            ]
        );
        assert_eq!(material.emissive_factor, [0.1, 0.3, 0.9]);
    }

    #[test]
    fn opacity_is_clamped() {
        let mut low = input("/Root/Looks/Low");
        low.opacity = Some(-0.25);
        let mut high = input("/Root/Looks/High");
        high.opacity = Some(1.25);

        assert_eq!(
            material_input_from_preview_surface(low).base_color_factor[3],
            0.0
        );
        assert_eq!(
            material_input_from_preview_surface(high).base_color_factor[3],
            1.0
        );
    }

    #[test]
    fn wrap_tokens_map_to_gltf_sampler_constants() {
        let mut material_input = input("/Root/Looks/ClampMirror");
        material_input.wrap_s = Some("clamp");
        material_input.wrap_t = Some("mirror");
        let material = material_input_from_preview_surface(material_input);
        assert_eq!(material.wrap_s, 33071);
        assert_eq!(material.wrap_t, 33648);

        let mut repeat_input = input("/Root/Looks/Repeat");
        repeat_input.wrap_s = Some("repeat");
        repeat_input.wrap_t = Some("useMetadata");
        let repeat = material_input_from_preview_surface(repeat_input);
        assert_eq!(repeat.wrap_s, 10497);
        assert_eq!(repeat.wrap_t, 10497);

        let mut unknown_input = input("/Root/Looks/Unknown");
        unknown_input.wrap_s = Some("bogus");
        let unknown = material_input_from_preview_surface(unknown_input);
        assert_eq!(unknown.wrap_s, 10497);
        assert_eq!(unknown.wrap_t, 10497);
    }

    #[test]
    fn apply_material_wrap_tokens_overwrites_both_axes() {
        let mut material = MaterialInput {
            wrap_s: 33071,
            wrap_t: 33648,
            ..MaterialInput::default_preview()
        };

        apply_material_wrap_tokens(&mut material, Some("mirror"), None);

        assert_eq!(material.wrap_s, 33648);
        assert_eq!(material.wrap_t, 10497);
    }

    #[test]
    fn select_wrap_sampler_prefers_diffuse_when_present() {
        let diffuse = ResolvedTextureSampler {
            asset_path: "base.png".to_string(),
            sampler_node: "diffuse",
        };
        let normal = ResolvedTextureSampler {
            asset_path: "normal.png".to_string(),
            sampler_node: "normal",
        };

        let selected = select_wrap_sampler_source(Some(&diffuse), Some(&normal), true);

        assert_eq!(selected.map(|tex| tex.sampler_node), Some("diffuse"));
    }

    #[test]
    fn select_wrap_sampler_uses_normal_when_diffuse_absent_and_allowed() {
        let normal = ResolvedTextureSampler {
            asset_path: "normal.png".to_string(),
            sampler_node: "normal",
        };

        let selected = select_wrap_sampler_source::<&str>(None, Some(&normal), true);

        assert_eq!(selected.map(|tex| tex.sampler_node), Some("normal"));
    }

    #[test]
    fn select_wrap_sampler_blocks_normal_when_fallback_not_allowed() {
        let normal = ResolvedTextureSampler {
            asset_path: "normal.png".to_string(),
            sampler_node: "normal",
        };

        let selected = select_wrap_sampler_source::<&str>(None, Some(&normal), false);

        assert!(selected.is_none());
    }

    #[test]
    fn select_wrap_sampler_returns_none_without_candidates() {
        let selected = select_wrap_sampler_source::<&str>(None, None, true);

        assert!(selected.is_none());
    }

    #[test]
    fn apply_resolved_texture_transforms_sets_both_slots() {
        let diffuse = ResolvedTextureSampler {
            asset_path: "base.png".to_string(),
            sampler_node: "diffuse",
        };
        let normal = ResolvedTextureSampler {
            asset_path: "normal.png".to_string(),
            sampler_node: "normal",
        };
        let diffuse_transform = TextureTransform {
            offset: [0.25, 0.5],
            rotation: 0.0,
            scale: [1.0, 1.0],
        };
        let normal_transform = TextureTransform {
            offset: [0.0, 0.0],
            rotation: 0.5,
            scale: [2.0, 2.0],
        };
        let mut material = MaterialInput::default_preview();

        apply_resolved_texture_transforms(&mut material, Some(&diffuse), Some(&normal), |node| {
            match *node {
                "diffuse" => Some(diffuse_transform),
                "normal" => Some(normal_transform),
                _ => None,
            }
        });

        assert_eq!(
            material.base_color_texture_transform,
            Some(diffuse_transform)
        );
        assert_eq!(material.normal_texture_transform, Some(normal_transform));
    }

    #[test]
    fn apply_resolved_texture_transforms_preserves_missing_channels_as_none() {
        let diffuse = ResolvedTextureSampler {
            asset_path: "base.png".to_string(),
            sampler_node: "diffuse",
        };
        let diffuse_transform = TextureTransform {
            offset: [0.25, 0.5],
            rotation: 0.0,
            scale: [1.0, 1.0],
        };
        let mut material = MaterialInput::default_preview();

        apply_resolved_texture_transforms(&mut material, Some(&diffuse), None, |_| {
            Some(diffuse_transform)
        });

        assert_eq!(
            material.base_color_texture_transform,
            Some(diffuse_transform)
        );
        assert_eq!(material.normal_texture_transform, None);
    }

    #[test]
    fn apply_resolved_texture_transforms_flattens_missing_resolver_result() {
        let diffuse = ResolvedTextureSampler {
            asset_path: "base.png".to_string(),
            sampler_node: "diffuse",
        };
        let mut material = MaterialInput {
            base_color_texture_transform: Some(TextureTransform {
                offset: [0.25, 0.5],
                rotation: 0.0,
                scale: [1.0, 1.0],
            }),
            ..MaterialInput::default_preview()
        };

        apply_resolved_texture_transforms(&mut material, Some(&diffuse), None, |_| None);

        assert_eq!(material.base_color_texture_transform, None);
        assert_eq!(material.normal_texture_transform, None);
    }

    #[test]
    fn apply_resolved_texture_transforms_leaves_both_slots_none_without_textures() {
        let mut material = MaterialInput::default_preview();

        apply_resolved_texture_transforms::<&str, _>(&mut material, None, None, |_| {
            unreachable!("resolver should not be called without textures")
        });

        assert_eq!(material.base_color_texture_transform, None);
        assert_eq!(material.normal_texture_transform, None);
    }

    #[test]
    fn texture_transform_from_usd_transform2d_rejects_non_transform_shader() {
        assert_eq!(
            texture_transform_from_usd_transform2d(
                Some("UsdPrimvarReader_float2"),
                Some([0.25, 0.5]),
                Some(90.0),
                Some([2.0, 2.0])
            ),
            None
        );
    }

    #[test]
    fn texture_transform_from_usd_transform2d_omits_schema_defaults() {
        assert_eq!(
            texture_transform_from_usd_transform2d(Some("UsdTransform2d"), None, None, None),
            None
        );
    }

    #[test]
    fn texture_transform_from_usd_transform2d_converts_rotation_degrees_to_radians() {
        let transform =
            texture_transform_from_usd_transform2d(Some("UsdTransform2d"), None, Some(90.0), None)
                .expect("non-identity rotation should emit transform");

        assert!((transform.rotation - std::f32::consts::FRAC_PI_2).abs() < 1e-6);
        assert_eq!(transform.offset, [0.0, 0.0]);
        assert_eq!(transform.scale, [1.0, 1.0]);
    }

    #[test]
    fn texture_transform_from_usd_transform2d_emits_offset_and_scale() {
        let transform = texture_transform_from_usd_transform2d(
            Some("UsdTransform2d"),
            Some([0.25, 0.5]),
            None,
            Some([2.0, 3.0]),
        )
        .expect("authored offset and scale should emit transform");

        assert_eq!(transform.offset, [0.25, 0.5]);
        assert_eq!(transform.rotation, 0.0);
        assert_eq!(transform.scale, [2.0, 3.0]);
    }

    #[test]
    fn rust_fork_alpha_mode_stays_unset_even_when_translucent() {
        let mut material_input = input("/Root/Looks/Glass");
        material_input.opacity = Some(0.5);
        material_input.opacity_threshold = None;

        let material = material_input_from_preview_surface(material_input);

        assert_eq!(material.base_color_factor[3], 0.5);
        assert_eq!(material.alpha_mode, None);
        assert_eq!(material.alpha_cutoff, 0.5);
    }

    #[test]
    fn cpp_alpha_mask_when_threshold_positive() {
        let mut material_input = input("/Root/Looks/Cutout");
        material_input.opacity = Some(0.5);
        material_input.opacity_threshold = Some(0.25);

        let material = material_input_from_preview_surface(material_input);

        assert_eq!(material.alpha_mode, Some(AlphaMode::Mask));
        assert_eq!(material.alpha_cutoff, 0.25);
    }

    #[test]
    fn cpp_alpha_blend_when_translucent_with_zero_threshold() {
        let mut material_input = input("/Root/Looks/Glass");
        material_input.opacity = Some(0.5);
        material_input.opacity_threshold = Some(0.0);

        let material = material_input_from_preview_surface(material_input);

        assert_eq!(material.alpha_mode, Some(AlphaMode::Blend));
        assert_eq!(material.alpha_cutoff, 0.5);
    }

    #[test]
    fn cpp_alpha_blend_keeps_exact_legacy_threshold() {
        let mut material_input = input("/Root/Looks/AlmostOpaque");
        material_input.opacity = Some(0.99995);
        material_input.opacity_threshold = Some(0.0);

        let material = material_input_from_preview_surface(material_input);

        assert_eq!(material.alpha_mode, Some(AlphaMode::Blend));
        assert_eq!(material.alpha_cutoff, 0.5);
    }

    #[test]
    fn texture_slots_remain_unassigned() {
        let material = material_input_from_preview_surface(input("/Root/Looks/Plain"));

        assert_eq!(material.base_color_texture, None);
        assert_eq!(material.normal_texture, None);
        assert_eq!(material.base_color_texture_transform, None);
        assert_eq!(material.normal_texture_transform, None);
        assert_eq!(material.metallic_roughness_texture, None);
    }
}
