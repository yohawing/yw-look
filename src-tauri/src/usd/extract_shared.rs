//! Small extraction helpers for the Rust USD backend.

use std::collections::HashMap;

use openusd::stage::MeshData;

use super::glb::{AlphaMode, MaterialInput, MeshInput};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub(crate) enum ScalarAttributeKind {
    Vertex,
    FaceVarying,
    Uniform,
    Constant,
}

/// Convert an sRGB color channel (0-1 float) to linear space.
///
/// USD's `UsdPreviewSurface` documents `inputs:diffuseColor` and
/// `primvars:displayColor` as sRGB values, while glTF baseColorFactor
/// is specified in linear space.
pub(crate) fn srgb_to_linear(c: f32) -> f32 {
    let c = c.clamp(0.0, 1.0);
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// Map a USD `inputs:wrapS/wrapT` token to a glTF sampler wrap mode.
/// USD `"useMetadata"` and unknown tokens fall back to glTF's default
/// repeat behavior.
pub(crate) fn usd_wrap_to_gltf(token: Option<&str>) -> u32 {
    match token {
        Some("clamp") => 33071,
        Some("mirror") => 33648,
        Some("repeat") | Some("useMetadata") | None => 10497,
        Some(_) => 10497,
    }
}

/// Only attach `skin_index` when the mesh actually carries per-vertex
/// joint influences. Rigid-follow meshes have no joint attributes and
/// must remain static GLB meshes.
pub(crate) fn skin_index_from_payload(mesh: &MeshInput, skin_slot: Option<usize>) -> Option<usize> {
    if mesh.joint_indices.is_some() && mesh.joint_weights.is_some() {
        skin_slot
    } else {
        None
    }
}

/// Issue #43: authored vertex alpha below 1.0 makes the material
/// transparent. Preserve an explicit MASK material because an authored
/// alpha cutoff is stronger than the implicit BLEND upgrade.
pub(crate) fn apply_vertex_alpha_blend(mesh: &MeshInput, materials: &mut [MaterialInput]) {
    let has_partial_alpha = mesh
        .colors
        .as_ref()
        .map(|rgba| rgba.chunks_exact(4).any(|c| c[3] < 1.0 - 1e-4))
        .unwrap_or(false);
    if !has_partial_alpha {
        return;
    }
    if let Some(mat) = materials.get_mut(mesh.material_index) {
        if mat.alpha_mode != Some(AlphaMode::Mask) {
            mat.alpha_mode = Some(AlphaMode::Blend);
        }
    }
}

/// Constant `primvars:displayColor` fallback: when the mesh has no bound
/// material (`slot == 0`), create a dedicated material slot with that color.
pub(crate) fn apply_display_color_fallback(
    slot: usize,
    mesh: &MeshData,
    prim_path: &str,
    materials: &mut Vec<MaterialInput>,
    material_slots: &mut HashMap<String, usize>,
    material_texture_paths: &mut Vec<Option<String>>,
    material_normal_paths: &mut Vec<Option<String>>,
    material_metal_rough_paths: Option<&mut Vec<Option<String>>>,
) -> usize {
    if slot != 0 {
        return slot;
    }
    let Some(dc) = &mesh.display_color else {
        return 0;
    };
    if dc.len() != 3 {
        return 0;
    }

    let key = format!("displayColor:{:.4},{:.4},{:.4}", dc[0], dc[1], dc[2]);
    if let Some(&existing) = material_slots.get(&key) {
        return existing;
    }

    let slot = materials.len();
    materials.push(display_color_material(prim_path, [dc[0], dc[1], dc[2]]));
    material_texture_paths.push(None);
    material_normal_paths.push(None);
    if let Some(paths) = material_metal_rough_paths {
        paths.push(None);
    }
    material_slots.insert(key, slot);
    slot
}

/// Filter a per-mesh `displayOpacity` array down to the faces referenced
/// by a GeomSubset while preserving the authored scalar topology.
///
/// `original_mesh` is the pre-filter `MeshData`; `opacity_kind` is optional
/// because the parser may not expose authored interpolation metadata.
pub(crate) fn filter_display_opacity_for_subset(
    opacity: &[f32],
    original_mesh: &MeshData,
    face_indices: &[u32],
    opacity_kind: Option<ScalarAttributeKind>,
) -> Vec<f32> {
    let face_count = original_mesh.face_vertex_counts.len();
    let point_count = original_mesh.points.len() / 3;
    let total_fv: usize = original_mesh
        .face_vertex_counts
        .iter()
        .map(|c| *c as usize)
        .sum();

    let is_face_varying = opacity_kind == Some(ScalarAttributeKind::FaceVarying)
        || (opacity_kind.is_none() && opacity.len() == total_fv);
    if is_face_varying {
        let mut fv_offsets: Vec<usize> = Vec::with_capacity(face_count);
        let mut cursor: usize = 0;
        for &c in &original_mesh.face_vertex_counts {
            fv_offsets.push(cursor);
            cursor += c as usize;
        }

        let mut out = Vec::new();
        for &fi in face_indices {
            let fi = fi as usize;
            if fi >= face_count {
                continue;
            }
            let off = fv_offsets[fi];
            let end = off + original_mesh.face_vertex_counts[fi] as usize;
            if end <= opacity.len() {
                out.extend_from_slice(&opacity[off..end]);
            }
        }
        return out;
    }

    let is_uniform = opacity_kind == Some(ScalarAttributeKind::Uniform)
        || (opacity_kind.is_none() && opacity.len() == face_count);
    if is_uniform {
        let mut out = Vec::with_capacity(face_indices.len());
        for &fi in face_indices {
            let fi = fi as usize;
            if fi < face_count && fi < opacity.len() {
                out.push(opacity[fi]);
            }
        }
        return out;
    }

    if opacity_kind == Some(ScalarAttributeKind::Vertex)
        || opacity_kind == Some(ScalarAttributeKind::Constant)
        || opacity.len() == point_count
        || opacity.len() == 1
    {
        return opacity.to_vec();
    }

    opacity.to_vec()
}

fn display_color_material(prim_path: &str, rgb: [f32; 3]) -> MaterialInput {
    MaterialInput {
        name: format!("dc:{prim_path}"),
        base_color_factor: [
            srgb_to_linear(rgb[0]),
            srgb_to_linear(rgb[1]),
            srgb_to_linear(rgb[2]),
            1.0,
        ],
        metallic_factor: 0.0,
        roughness_factor: 0.5,
        emissive_factor: [0.0, 0.0, 0.0],
        double_sided: true,
        base_color_texture: None,
        normal_texture: None,
        base_color_texture_transform: None,
        normal_texture_transform: None,
        wrap_s: 10497,
        wrap_t: 10497,
        alpha_mode: None,
        alpha_cutoff: 0.5,
        metallic_roughness_texture: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mesh_with_display_color(display_color: Option<Vec<f32>>) -> MeshData {
        MeshData {
            points: vec![0.0, 0.0, 0.0],
            face_vertex_indices: vec![0],
            face_vertex_counts: vec![1],
            normals: None,
            uvs: None,
            joint_indices: None,
            joint_weights: None,
            joints_per_vertex: 0,
            display_color,
        }
    }

    fn mesh_with_topology(points: usize, face_vertex_counts: Vec<i32>) -> MeshData {
        MeshData {
            points: vec![0.0; points * 3],
            face_vertex_indices: Vec::new(),
            face_vertex_counts,
            normals: None,
            uvs: None,
            joint_indices: None,
            joint_weights: None,
            joints_per_vertex: 0,
            display_color: None,
        }
    }

    fn mesh_input(joint_indices: Option<Vec<u16>>, joint_weights: Option<Vec<f32>>) -> MeshInput {
        MeshInput {
            name: "/Mesh".to_string(),
            world_matrix: [0.0; 16],
            positions: vec![0.0, 0.0, 0.0],
            indices: vec![0, 0, 0],
            normals: None,
            uvs: None,
            colors: None,
            joint_indices,
            joint_weights,
            material_index: 0,
            skin_index: None,
            morph_targets: Vec::new(),
            morph_weights: Vec::new(),
            purpose: None,
        }
    }

    #[test]
    fn skin_index_requires_joint_payload() {
        assert_eq!(
            skin_index_from_payload(&mesh_input(Some(vec![0; 4]), Some(vec![1.0; 4])), Some(2)),
            Some(2)
        );
        assert_eq!(
            skin_index_from_payload(&mesh_input(Some(vec![0; 4]), None), Some(2)),
            None
        );
        assert_eq!(
            skin_index_from_payload(&mesh_input(None, Some(vec![1.0; 4])), Some(2)),
            None
        );
    }

    #[test]
    fn usd_wrap_tokens_map_to_gltf_sampler_constants() {
        assert_eq!(usd_wrap_to_gltf(None), 10497);
        assert_eq!(usd_wrap_to_gltf(Some("repeat")), 10497);
        assert_eq!(usd_wrap_to_gltf(Some("useMetadata")), 10497);
        assert_eq!(usd_wrap_to_gltf(Some("clamp")), 33071);
        assert_eq!(usd_wrap_to_gltf(Some("mirror")), 33648);
        assert_eq!(usd_wrap_to_gltf(Some("bogus")), 10497);
    }

    #[test]
    fn display_color_fallback_returns_existing_slot_for_bound_material() {
        let mut materials = vec![MaterialInput::default_preview()];
        let mut slots = HashMap::new();
        let mut textures = Vec::new();
        let mut normals = Vec::new();

        let slot = apply_display_color_fallback(
            3,
            &mesh_with_display_color(Some(vec![0.1, 0.2, 0.3])),
            "/Mesh",
            &mut materials,
            &mut slots,
            &mut textures,
            &mut normals,
            None,
        );

        assert_eq!(slot, 3);
        assert_eq!(materials.len(), 1);
        assert!(slots.is_empty());
    }

    #[test]
    fn display_color_fallback_ignores_missing_or_non_constant_color() {
        for display_color in [None, Some(vec![0.1, 0.2, 0.3, 0.4])] {
            let mut materials = vec![MaterialInput::default_preview()];
            let mut slots = HashMap::new();
            let mut textures = Vec::new();
            let mut normals = Vec::new();

            let slot = apply_display_color_fallback(
                0,
                &mesh_with_display_color(display_color),
                "/Mesh",
                &mut materials,
                &mut slots,
                &mut textures,
                &mut normals,
                None,
            );

            assert_eq!(slot, 0);
            assert_eq!(materials.len(), 1);
            assert!(slots.is_empty());
        }
    }

    #[test]
    fn display_color_fallback_creates_and_dedupes_material_slot() {
        let mut materials = vec![MaterialInput::default_preview()];
        let mut slots = HashMap::new();
        let mut textures = Vec::new();
        let mut normals = Vec::new();
        let mut metal_rough = Vec::new();
        let mesh = mesh_with_display_color(Some(vec![0.1, 0.3, 0.9]));

        let first = apply_display_color_fallback(
            0,
            &mesh,
            "/Mesh",
            &mut materials,
            &mut slots,
            &mut textures,
            &mut normals,
            Some(&mut metal_rough),
        );
        let second = apply_display_color_fallback(
            0,
            &mesh,
            "/MeshAgain",
            &mut materials,
            &mut slots,
            &mut textures,
            &mut normals,
            Some(&mut metal_rough),
        );

        assert_eq!(first, 1);
        assert_eq!(second, 1);
        assert_eq!(materials.len(), 2);
        assert_eq!(textures, vec![None]);
        assert_eq!(normals, vec![None]);
        assert_eq!(metal_rough, vec![None]);
        assert_eq!(materials[1].name, "dc:/Mesh");
        assert!((materials[1].base_color_factor[0] - srgb_to_linear(0.1)).abs() < 1e-6);
        assert!((materials[1].base_color_factor[1] - srgb_to_linear(0.3)).abs() < 1e-6);
        assert!((materials[1].base_color_factor[2] - srgb_to_linear(0.9)).abs() < 1e-6);
        assert_eq!(materials[1].roughness_factor, 0.5);
        assert_eq!(materials[1].metallic_factor, 0.0);
    }

    #[test]
    fn vertex_alpha_blend_ignores_meshes_without_colors_or_partial_alpha() {
        let mut no_color_materials = vec![MaterialInput::default_preview()];
        apply_vertex_alpha_blend(&mesh_input(None, None), &mut no_color_materials);
        assert_eq!(no_color_materials[0].alpha_mode, None);

        let mut opaque_materials = vec![MaterialInput::default_preview()];
        let mut mesh = mesh_input(None, None);
        mesh.colors = Some(vec![1.0, 1.0, 1.0, 1.0, 0.4, 0.5, 0.6, 1.0 - 5e-5]);
        apply_vertex_alpha_blend(&mesh, &mut opaque_materials);
        assert_eq!(opaque_materials[0].alpha_mode, None);
    }

    #[test]
    fn vertex_alpha_blend_sets_blend_for_partial_alpha() {
        let mut materials = vec![MaterialInput::default_preview()];
        let mut mesh = mesh_input(None, None);
        mesh.colors = Some(vec![1.0, 1.0, 1.0, 0.5]);

        apply_vertex_alpha_blend(&mesh, &mut materials);

        assert_eq!(materials[0].alpha_mode, Some(AlphaMode::Blend));
    }

    #[test]
    fn vertex_alpha_blend_preserves_mask_materials() {
        let mut materials = vec![MaterialInput {
            alpha_mode: Some(AlphaMode::Mask),
            ..MaterialInput::default_preview()
        }];
        let mut mesh = mesh_input(None, None);
        mesh.colors = Some(vec![1.0, 1.0, 1.0, 0.5]);

        apply_vertex_alpha_blend(&mesh, &mut materials);

        assert_eq!(materials[0].alpha_mode, Some(AlphaMode::Mask));
    }

    #[test]
    fn display_opacity_subset_infers_face_varying_by_length() {
        let mesh = mesh_with_topology(6, vec![3, 4]);
        let opacity = vec![0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];

        let filtered = filter_display_opacity_for_subset(&opacity, &mesh, &[1], None);

        assert_eq!(filtered, vec![0.4, 0.5, 0.6, 0.7]);
    }

    #[test]
    fn display_opacity_subset_infers_uniform_by_length() {
        let mesh = mesh_with_topology(6, vec![3, 4, 3]);
        let opacity = vec![0.25, 0.5, 0.75];

        let filtered = filter_display_opacity_for_subset(&opacity, &mesh, &[2, 0], None);

        assert_eq!(filtered, vec![0.75, 0.25]);
    }

    #[test]
    fn display_opacity_subset_passes_vertex_and_constant_through() {
        let mesh = mesh_with_topology(5, vec![3, 4]);
        let vertex_opacity = vec![0.1, 0.2, 0.3, 0.4, 0.5];
        let constant_opacity = vec![0.6];

        assert_eq!(
            filter_display_opacity_for_subset(&vertex_opacity, &mesh, &[1], None),
            vertex_opacity
        );
        assert_eq!(
            filter_display_opacity_for_subset(&constant_opacity, &mesh, &[1], None),
            constant_opacity
        );
    }

    #[test]
    fn display_opacity_subset_kind_hint_overrides_ambiguous_length() {
        let mesh = mesh_with_topology(4, vec![2, 2]);
        let opacity = vec![0.1, 0.2, 0.3, 0.4];

        assert_eq!(
            filter_display_opacity_for_subset(
                &opacity,
                &mesh,
                &[1],
                Some(ScalarAttributeKind::Vertex)
            ),
            opacity
        );
        assert_eq!(
            filter_display_opacity_for_subset(
                &opacity,
                &mesh,
                &[1],
                Some(ScalarAttributeKind::Uniform)
            ),
            vec![0.2]
        );
    }

    #[test]
    fn display_opacity_subset_respects_explicit_face_varying_and_constant_kinds() {
        let mesh = mesh_with_topology(4, vec![2, 2]);
        let opacity = vec![0.1, 0.2, 0.3, 0.4];
        let constant_opacity = vec![0.75];

        assert_eq!(
            filter_display_opacity_for_subset(
                &opacity,
                &mesh,
                &[1],
                Some(ScalarAttributeKind::FaceVarying)
            ),
            vec![0.3, 0.4]
        );
        assert_eq!(
            filter_display_opacity_for_subset(
                &constant_opacity,
                &mesh,
                &[1],
                Some(ScalarAttributeKind::Constant)
            ),
            constant_opacity
        );
    }

    #[test]
    fn display_opacity_subset_skips_out_of_range_or_short_arrays() {
        let mesh = mesh_with_topology(4, vec![3, 4]);

        assert_eq!(
            filter_display_opacity_for_subset(
                &[0.1, 0.2, 0.3, 0.4],
                &mesh,
                &[1, 99],
                Some(ScalarAttributeKind::FaceVarying)
            ),
            Vec::<f32>::new()
        );
        assert_eq!(
            filter_display_opacity_for_subset(
                &[0.1],
                &mesh,
                &[1, 99],
                Some(ScalarAttributeKind::Uniform)
            ),
            Vec::<f32>::new()
        );
    }
}
