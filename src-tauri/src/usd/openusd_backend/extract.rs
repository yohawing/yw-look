use std::cell::RefCell;
use std::path::Path as StdPath;

use openusd::sdf::schema::FieldKey;
use openusd::sdf::{Path as SdfPath, Value as SdfValue};
use openusd::stage::UpAxis;
use openusd::Stage;

use crate::usd::backend::UsdError;
use crate::usd::extract_shared::{
    apply_display_color_fallback, apply_vertex_alpha_blend, filter_display_opacity_for_subset,
    skin_index_from_payload,
};
use crate::usd::geometry::{
    filter_mesh_by_face_indices, mesh_data_to_input, validate_mesh_topology,
};
use crate::usd::glb::{self, MeshInput};
use crate::usd::math::{mat4_f64_to_f32, mat4_mul, z_up_to_y_up_mat4};
use crate::usd::skel::remap_mesh_skin_indices;
use crate::usd::texture_loader::{embed_material_textures, TextureEmbedLogStyle, TextureLoader};
use crate::usd::types::{ExtractGeometryOptions, StageLoadPolicy};

use super::blend_shapes::resolve_blend_shapes;
use super::cameras::resolve_cameras;
use super::lights::resolve_lights;
use super::material_adapter::{find_material_by_name_fallback, resolve_material_slot};
use super::mesh_attributes::{expand_indexed_uvs, read_display_opacity};
use super::mesh_visibility::{is_mesh_active_and_visible, read_mesh_orientation, resolve_purpose};
use super::node_tree::build_node_tree;
use super::skel_adapter::{
    animation_input_from_skel, read_mesh_skel_joints_override, skin_input_from_skel,
};
use super::xform::compose_world_xform;
use super::LEGACY_TRAVERSE_PREDICATE;
// ---------------------------------------------------------------------------
// Free function: the actual geometry-extraction pipeline, callable from both
// `extract_geometry_glb`, `extract_geometry_glb_with_options`, and
// `extract_geometry_from_session` without keeping a Stage alive inside a
// trait impl block.
// ---------------------------------------------------------------------------
pub(crate) fn extract_geometry_from_open_stage_rs(
    stage: &Stage,
    stage_path: &StdPath,
    options: &ExtractGeometryOptions,
) -> Result<Vec<u8>, UsdError> {
    if let Some(selection) = options.variant_selections.first() {
        return Err(UsdError::InvalidVariantSelection {
            prim_path: selection.prim_path.clone(),
            set_name: selection.set_name.clone(),
            variant_name: selection.variant_name.clone(),
        });
    }

    let skipped_payload_sources: Vec<String> = if options.policy == StageLoadPolicy::NoPayloads {
        stage
            .skipped_payloads()
            .iter()
            .map(|payload| payload.prim_path.to_string())
            .collect()
    } else {
        Vec::new()
    };

    // Pre-compute the Z-up → Y-up correction, if any. The viewer is
    // Y-up; Z-up USD scenes (Kitchen Set, most DCC exports from Maya
    // / Houdini) need rotating into viewer space. We bake the
    // correction into every mesh's world matrix below so the GLB is
    // self-describing — the frontend doesn't need to know the
    // original stage's up-axis.
    let up_axis_correction = match stage.up_axis() {
        Some(UpAxis::Z) => Some(z_up_to_y_up_mat4()),
        _ => None,
    };

    // Pass 1: collect every Mesh prim that is active and visible.
    // We intentionally do NOT filter by purpose here so that all
    // four USD purposes (default / render / proxy / guide) land in
    // the GLB. Each MeshInput gets the resolved purpose token
    // written into its `purpose` field so the frontend can toggle
    // visibility dynamically without re-extracting the GLB (#32).
    //
    // (The legacy `is_renderable_mesh` helper also excluded proxy /
    // guide — that behaviour now lives on the frontend via the
    // `purposeModes` default render=true, proxy=false, guide=false.)
    // #41: The Rust fork backend does not support UsdGeomPointInstancer.
    // PointInstancer prims are silently skipped because they do not
    // satisfy `is_mesh_active_and_visible`. Use the C++ backend
    // (feature: backend-openusd-cpp) for EXT_mesh_gpu_instancing preview.
    let mesh_paths = RefCell::new(Vec::<SdfPath>::new());
    let instancer_paths = RefCell::new(Vec::<SdfPath>::new());
    stage
        .traverse(LEGACY_TRAVERSE_PREDICATE, |prim_path| {
            // Detect PointInstancer type by path heuristic: the stage's
            // type_name field. We emit a warning and skip rather than error.
            if let Ok(Some(SdfValue::Token(type_name))) =
                stage.field::<SdfValue>(prim_path.clone(), FieldKey::TypeName)
            {
                if type_name.as_str() == "PointInstancer" {
                    instancer_paths.borrow_mut().push(prim_path.clone());
                    return; // skip from mesh traversal
                }
            }
            if !is_mesh_active_and_visible(&stage, prim_path) {
                return;
            }
            mesh_paths.borrow_mut().push(prim_path.clone());
        })
        .map_err(|e| UsdError::Parse(e.to_string()))?;

    // Emit a single warning if any PointInstancer prims were found.
    {
        let instancer_list = instancer_paths.into_inner();
        if !instancer_list.is_empty() {
            eprintln!(
                "[usd-rs] {} PointInstancer prim(s) found (e.g. '{}') — not supported by \
                     the Rust fork backend; skipped. Use `--features backend-openusd-cpp` \
                     for EXT_mesh_gpu_instancing preview (#41).",
                instancer_list.len(),
                instancer_list[0]
            );
        }
    }

    let mesh_paths = mesh_paths.into_inner();

    // Filter out "leaked" root prims from referenced/payloaded
    // layers. When a layer is composed via `prepend references`,
    // the fork's traverse exposes both the composed prim tree
    // (under defaultPrim) AND the raw root prims from the
    // external layers. The raw roots produce visual duplicates
    // at the origin. Keep only prims under the stage's
    // defaultPrim (if one is authored); for stages without a
    // defaultPrim we keep everything.
    let mesh_paths = if let Some(ref dp) = stage.default_prim() {
        let prefix = format!("/{dp}/");
        let root_path = format!("/{dp}");
        mesh_paths
            .into_iter()
            .filter(|p| {
                let s = p.as_str();
                s.starts_with(&prefix) || s == root_path
            })
            .collect::<Vec<_>>()
    } else {
        mesh_paths
    };

    let mesh_candidates_are_deferred = !mesh_paths.is_empty()
        && mesh_paths.iter().all(|path| {
            let value = path.as_str();
            skipped_payload_sources.iter().any(|source| {
                let descendant_prefix = format!("{source}/");
                value == source || value.starts_with(&descendant_prefix)
            })
        });
    let can_export_empty_scene =
        options.policy == StageLoadPolicy::NoPayloads && !skipped_payload_sources.is_empty();
    let empty_scene_has_no_mesh_candidates = mesh_paths.is_empty() && can_export_empty_scene;

    if mesh_paths.is_empty() {
        if can_export_empty_scene {
            eprintln!(
                "[usd-rs] no renderable Mesh prims found in deferred-payload stage; exporting an empty GLB scene"
            );
        } else {
            return Err(UsdError::Parse(
                "no renderable Mesh prims found in stage".to_string(),
            ));
        }
    }

    // Phase 5a material resolution + Phase 5c texture embedding.
    // The GLB output holds a deduplicated materials array; slot 0
    // is always the default preview material so unbound meshes
    // have something to point at. Each bound Material prim
    // (identified by its composed path) maps to exactly one
    // additional slot, built from `Stage::material_of` output.
    // A mesh whose `bound_material` path appears multiple times
    // across the stage shares the slot, matching how glTF expects
    // material reuse to work.
    //
    // Texture resolution happens after the mesh pass: we collect
    // each material's authored texture asset path during pass 2,
    // then a final pass loads PNG/JPEG bytes (USDZ archive entry
    // or filesystem-relative file) and patches the material's
    // `base_color_texture` to point at the new GLB image slot.
    let mut materials: Vec<glb::MaterialInput> = vec![glb::MaterialInput::default_preview()];
    let mut material_slots: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    // Per material slot: the authored diffuse_texture asset path,
    // or `None` for "no texture / default slot".
    let mut material_texture_paths: Vec<Option<String>> = vec![None];
    // Phase 6a: same shape as `material_texture_paths` but for
    // `UsdPreviewSurface.inputs:normal` texture asset paths. Each
    // slot is `None` when the material has no normal map
    // authored. The loading loop below populates
    // `MaterialInput.normal_texture` after deduping across slots.
    let mut material_normal_paths: Vec<Option<String>> = vec![None];

    // Phase 5c E: resolve any UsdSkel rig bound to one of the
    // collected meshes BEFORE the mesh build pass so each mesh's
    // `skin_index` can be set inline. We dedupe by skeleton prim
    // path so a stage with several meshes sharing one rig
    // produces exactly one GLB skin object.
    let mut skins: Vec<glb::SkinInput> = Vec::new();
    let mut skin_slots: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut mesh_skin_slots: Vec<Option<usize>> = vec![None; mesh_paths.len()];
    // Pre-compute the f32 Z-up → Y-up correction for skeleton
    // transforms. We need this in both the bind-transform
    // rotation and the root-joint rest-transform rotation so the
    // joint hierarchy comes out Y-up in the GLB.
    let up_correction_f32: Option<[f32; 16]> = up_axis_correction.map(|c| mat4_f64_to_f32(&c));

    for (i, prim_path) in mesh_paths.iter().enumerate() {
        if let Some((skel_path, skel_data)) = stage.skeleton_of(prim_path.clone()) {
            let key = skel_path.to_string();
            let slot = if let Some(&existing) = skin_slots.get(&key) {
                existing
            } else {
                let slot = skins.len();
                let skin_input = skin_input_from_skel(&key, &skel_data, up_correction_f32.as_ref());
                skins.push(skin_input);
                skin_slots.insert(key, slot);
                slot
            };
            mesh_skin_slots[i] = Some(slot);
        }
    }

    // Pass 2: build a MeshInput per Mesh prim (or per GeomSubset
    // when the mesh has face-level material splits), composing the
    // world transform along the parent chain and pre-applying the
    // up-axis correction.
    let mut inputs: Vec<MeshInput> = Vec::with_capacity(mesh_paths.len());
    for (mesh_idx, prim_path) in mesh_paths.iter().enumerate() {
        let Some(mut mesh_data) = stage
            .mesh_of(prim_path.clone())
            .map_err(|e| UsdError::Parse(e.to_string()))?
        else {
            continue;
        };
        validate_mesh_topology(prim_path, &mesh_data)?;

        let mut world = compose_world_xform(&stage, prim_path)?;
        if let Some(correction) = &up_axis_correction {
            world = mat4_mul(correction, &world);
        }
        let world_f32 = mat4_f64_to_f32(&world);

        // Expand indexed face-varying UVs: USD allows
        // `primvars:st:indices` to map compact UV arrays to
        // face vertices (UV seam handling). If present, expand
        // the compact UVs to full face-varying layout so
        // classify_attribute picks them up as FaceVarying.
        expand_indexed_uvs(&stage, prim_path, &mut mesh_data);

        // UsdSkel per-mesh `skel:joints` override: when a mesh
        // authors its own ordered joint subset, the mesh's
        // `primvars:skel:jointIndices` index into that subset,
        // not the bound Skeleton's full `joints` array. glTF's
        // `skin.joints` list mirrors the full skeleton order, so
        // the raw indices must be remapped before they reach
        // `mesh_data_to_input`. Apple ARKit exports
        // (chameleon / seahorse) use this pattern heavily —
        // eyeball meshes bind to a single head-deep joint, etc.
        // Skipping this step leaves every vertex pointing at the
        // wrong joint and produces the classic "exploded" look.
        if let Some(skin_slot) = mesh_skin_slots[mesh_idx] {
            if let Some(local_joints) = read_mesh_skel_joints_override(&stage, prim_path) {
                if let Some(skin) = skins.get(skin_slot) {
                    remap_mesh_skin_indices(&mut mesh_data, &local_joints, &skin.joint_names);
                }
            }
        }

        let orientation = read_mesh_orientation(&stage, prim_path);
        let max_joint = mesh_skin_slots[mesh_idx]
            .and_then(|si| skins.get(si))
            .map(|s| s.joint_names.len())
            .unwrap_or(usize::MAX);

        // Phase 6d: resolve blend shape targets against the mesh's
        // own point count (same point buffer is shared across
        // subsets, so the filtered / whole-mesh paths below both
        // reuse this result). Empty when the mesh has no
        // `skel:blendShapeTargets` relationship.
        let point_count = mesh_data.points.len() / 3;
        let blend_shapes = resolve_blend_shapes(&stage, prim_path, point_count);

        // Issue #43 displayOpacity: read `primvars:displayOpacity`
        // from the stage for this mesh prim. The values are scalar
        // floats in the same interpolation topology as
        // `primvars:displayColor` (vertex, faceVarying, constant,
        // …). `None` when not authored — alpha falls back to 1.0.
        let display_opacity_vec = read_display_opacity(&stage, prim_path);
        let display_opacity: Option<&[f32]> = display_opacity_vec.as_deref();

        // GeomSubset: if the mesh has face subsets with material
        // bindings, produce one MeshInput per subset so each face
        // group gets its own material. Otherwise fall through to
        // the whole-mesh path.
        let subsets = stage.geom_subsets_of(prim_path.clone());
        let has_subset_materials =
            !subsets.is_empty() && subsets.iter().any(|s| s.material_binding.is_some());

        // Fallback: if subsets have NO material bindings but
        // Material prims exist under a sibling `Looks` scope,
        // try matching subset names to Material names by prefix.
        // This catches Maya/Apple exports where the authored
        // binding relationship is missing but the naming
        // convention `subset_name` → `Looks/subset_name_N` holds.
        let has_subset_materials = has_subset_materials || {
            if !subsets.is_empty() && subsets.iter().all(|s| s.material_binding.is_none()) {
                // Check if name-based matching would work
                subsets
                    .iter()
                    .any(|s| find_material_by_name_fallback(&stage, prim_path, &s.name).is_some())
            } else {
                false
            }
        };

        if has_subset_materials {
            for subset in &subsets {
                let filtered = filter_mesh_by_face_indices(&mesh_data, &subset.indices);
                if filtered.face_vertex_counts.is_empty() {
                    continue;
                }
                // Issue #43: opacity must be filtered alongside
                // the mesh data so faceVarying / uniform topologies
                // classify correctly against the subset's face
                // count rather than the whole mesh's.
                let subset_opacity_vec = display_opacity.map(|op| {
                    filter_display_opacity_for_subset(op, &mesh_data, &subset.indices, None)
                });
                let subset_opacity: Option<&[f32]> = subset_opacity_vec.as_deref();
                let subset_name = SdfPath::new(&format!("{}/{}", prim_path.as_str(), subset.name))
                    .unwrap_or_else(|_| prim_path.clone());
                let mut tri = mesh_data_to_input(
                    &subset_name,
                    world_f32,
                    &filtered,
                    orientation,
                    max_joint,
                    &blend_shapes,
                    subset_opacity,
                    None,
                )?;

                // Resolve material: try authored binding first,
                // fall back to name-based matching if missing.
                let mat_ref =
                    subset.material_binding.as_ref().cloned().or_else(|| {
                        find_material_by_name_fallback(&stage, prim_path, &subset.name)
                    });
                let slot = resolve_material_slot(
                    &stage,
                    mat_ref.as_ref(),
                    &subset_name,
                    &mut materials,
                    &mut material_texture_paths,
                    &mut material_normal_paths,
                    &mut material_slots,
                );
                tri.material_index = apply_display_color_fallback(
                    slot,
                    &filtered,
                    subset_name.as_str(),
                    &mut materials,
                    &mut material_slots,
                    &mut material_texture_paths,
                    &mut material_normal_paths,
                    None,
                );
                apply_vertex_alpha_blend(&tri, &mut materials);
                tri.skin_index = skin_index_from_payload(&tri, mesh_skin_slots[mesh_idx]);
                // #32: inherit parent mesh's purpose for subsets.
                tri.purpose = Some(resolve_purpose(&stage, prim_path));
                inputs.push(tri);
            }
            continue; // skip whole-mesh path
        }

        let mut triangulated = mesh_data_to_input(
            prim_path,
            world_f32,
            &mesh_data,
            orientation,
            max_joint,
            &blend_shapes,
            display_opacity,
            None,
        )?;

        // Resolve the material slot for this mesh. Unbound meshes
        // fall back to slot 0 (default).
        let slot = resolve_material_slot(
            &stage,
            stage.bound_material(prim_path.clone()).as_ref(),
            prim_path,
            &mut materials,
            &mut material_texture_paths,
            &mut material_normal_paths,
            &mut material_slots,
        );
        triangulated.material_index = apply_display_color_fallback(
            slot,
            &mesh_data,
            prim_path.as_str(),
            &mut materials,
            &mut material_slots,
            &mut material_texture_paths,
            &mut material_normal_paths,
            None,
        );

        apply_vertex_alpha_blend(&triangulated, &mut materials);

        // Phase 5c E: attach the dedup'd skin slot to this mesh
        // primitive. The mesh is rendered statically when no
        // skin is bound.
        triangulated.skin_index = skin_index_from_payload(&triangulated, mesh_skin_slots[mesh_idx]);

        // #32: resolve the USD purpose token for this prim and
        // attach it to the MeshInput so the GLB writer can embed
        // it in node extras. The frontend reads `userData.purpose`
        // after GLTFLoader copies node extras → userData.
        triangulated.purpose = Some(resolve_purpose(&stage, prim_path));

        inputs.push(triangulated);
    }

    if inputs.is_empty() {
        if empty_scene_has_no_mesh_candidates
            || (can_export_empty_scene && mesh_candidates_are_deferred)
        {
            eprintln!(
                "[usd-rs] deferred-payload stage has no usable mesh points; exporting an empty GLB scene"
            );
        } else {
            return Err(UsdError::Parse(
                "stage has Mesh prims but none had usable points data".to_string(),
            ));
        }
    }

    // Phase 5c E: per skin, resolve the bound SkelAnimation and
    // convert it into a glTF animation. Stages without
    // skel:animationSource skip the conversion silently. We
    // also need the stage's `timeCodesPerSecond` so we can map
    // USD time codes (which is what `Stage::skel_animation_of`
    // returns) to glTF seconds — the spec defaults to 24 when
    // not authored, so we mirror that fallback. (Codex P1.)
    let time_codes_per_second: f64 = stage
        .field::<f64>(SdfPath::abs_root(), FieldKey::TimeCodesPerSecond)
        .ok()
        .flatten()
        .filter(|v| *v > 0.0)
        .unwrap_or(24.0);
    let mut animations: Vec<glb::AnimationInput> = Vec::new();
    for (skin_idx, skin) in skins.iter().enumerate() {
        // Look up the skel path key by reverse mapping. Cheap:
        // there are typically 0–2 skins in a stage.
        let skel_path_str = skin_slots
            .iter()
            .find_map(|(k, &v)| (v == skin_idx).then(|| k.clone()));
        let Some(skel_path_str) = skel_path_str else {
            continue;
        };
        let Ok(skel_path) = SdfPath::new(&skel_path_str) else {
            continue;
        };
        if let Some(anim_data) = stage.skel_animation_of(skel_path) {
            if let Some(anim_input) = animation_input_from_skel(
                skin_idx,
                &skin.joint_names,
                &anim_data,
                time_codes_per_second,
            ) {
                animations.push(anim_input);
            }
        }
    }

    // Phase 5c: resolve and embed each authored texture asset.
    // `texture_loader` opens the USDZ archive lazily on the first
    // texture lookup so non-textured stages don't pay the zip
    // open cost.
    //
    // ### Layer-relative resolution: best effort, Phase 5d
    //
    // Ideally a `@./albedo.png@` authored on a Material that lives
    // in a referenced layer should resolve relative to **that
    // layer's** directory, not the top-level stage. The fork's
    // `Stage::material_of` does not yet expose which layer a
    // given material spec came from, so we approximate by
    // searching every composed layer's parent directory in order
    // (root first, then references / payloads / sublayers). For
    // single-layer assets and self-contained USDZ this is
    // identical to a layer-aware lookup. For composed scenes
    // where two layers author the same relative path against
    // different files, the closer-to-root layer wins; this is a
    // known limitation tracked as Phase 5d (needs a fork API
    // for `Stage::layer_for_prim`).
    let mut search_dirs: Vec<std::path::PathBuf> = Vec::new();
    if let Some(parent) = stage_path.parent() {
        search_dirs.push(parent.to_path_buf());
    }
    for layer_id in stage.layer_identifiers() {
        // layer_identifiers returns the root layer first, then the
        // composed layers in order. Skip the root path's parent
        // (already added) and convert each composed layer's
        // identifier into a directory.
        let layer_path = StdPath::new(&layer_id);
        if let Some(parent) = layer_path.parent() {
            if !parent.as_os_str().is_empty() && !search_dirs.iter().any(|d| d == parent) {
                search_dirs.push(parent.to_path_buf());
            }
        }
    }

    let mut texture_loader = TextureLoader::new(stage_path, search_dirs);
    let mut textures: Vec<glb::TextureInput> = Vec::new();
    embed_material_textures(
        &mut texture_loader,
        &mut materials,
        &mut textures,
        &material_texture_paths,
        &material_normal_paths,
        None,
        TextureEmbedLogStyle::OpenUsdRs,
    );

    // Phase 7a: resolve authored UsdLux lights to glTF
    // KHR_lights_punctual entries. Lights are always gathered at
    // stage scope (independent of the mesh traversal above), so
    // they come through even when the stage has no mesh prims —
    // useful for USD lighting-only scenes that we may get in
    // production.
    let lights = resolve_lights(&stage, up_axis_correction.as_ref());
    // Phase 7b: enumerate authored UsdGeomCamera prims. glTF
    // cameras are emitted alongside meshes / lights; Three.js's
    // GLTFLoader exposes them on `gltf.cameras` for the
    // frontend's camera switcher to pick up.
    let cameras = resolve_cameras(&stage, up_axis_correction.as_ref());

    // Pass 1.5: build the prim hierarchy (NodeInput tree) for #46.
    // Collect every prim path referenced by meshes, lights, cameras, and
    // skins, then insert ancestor Group nodes so the GLB carries the full
    // prim tree rather than a flat scene root.
    let node_tree = build_node_tree(
        &stage,
        &mesh_paths,
        &skin_slots,
        &mesh_skin_slots,
        &inputs,
        &lights,
        &cameras,
        up_axis_correction.as_ref(),
    );

    glb::build_glb(
        &node_tree,
        &inputs,
        &materials,
        &textures,
        &skins,
        &animations,
        &lights,
        &cameras,
        up_correction_f32,
        &[], // #41: Rust fork backend skips PointInstancer (no instancing support)
    )
    .map_err(UsdError::Parse)
}
