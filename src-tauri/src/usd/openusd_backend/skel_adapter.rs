use std::collections::BTreeMap;

use openusd::sdf::{Path as SdfPath, Value as SdfValue};
use openusd::usd::Stage;

use super::stage_fields::ValidatedStagePathExt;

use crate::usd::backend::UsdError;
use crate::usd::glb;
use crate::usd::ir;
use crate::usd::math::{invert_mat4_f32, mat4_mul_f32, IDENTITY_MAT4_F32};

use super::stage_fields::token_vec_to_strings;

/// Reads a mesh prim's `skel:joints` attribute — the optional
/// per-mesh joint ordering override defined by UsdSkel. When
/// authored, the mesh's `primvars:skel:jointIndices` index into this
/// local list rather than the bound Skeleton's full `joints` array.
///
/// Returns `None` when the attribute is not authored, which signals
/// the caller that the mesh's joint indices are already in skeleton
/// order (the common DCC case, e.g. the `tiny_rigged.usda` fixture
/// and the `UsdSkelExamples/HumanFemale` rig).
pub(crate) fn read_mesh_skel_joints_override(
    stage: &Stage,
    mesh_path: &SdfPath,
) -> Option<Vec<String>> {
    let attr_path = mesh_path.append_property("skel:joints").ok()?;
    let value: Option<SdfValue> = stage.attribute_at(attr_path).get::<SdfValue>().ok()?;
    match value? {
        SdfValue::TokenVec(v) => Some(token_vec_to_strings(v)),
        SdfValue::StringVec(v) => Some(v),
        _ => None,
    }
}

/// Reads a mesh prim's `primvars:skel:geomBindTransform` — the
/// UsdSkel matrix that maps the mesh's points from geometry space
/// into the skeleton's bind space. `None` when not authored
/// (equivalent to identity).
pub(crate) fn read_geom_bind_transform(stage: &Stage, mesh_path: &SdfPath) -> Option<[f64; 16]> {
    let attr_path = mesh_path
        .append_property("primvars:skel:geomBindTransform")
        .ok()?;
    let value: Option<SdfValue> = stage.attribute_at(attr_path).get::<SdfValue>().ok()?;
    match value? {
        SdfValue::Matrix4d(m) => Some(m.into()),
        _ => None,
    }
}

/// Bakes a `geomBindTransform` into a skinned mesh's points and
/// normals.
///
/// glTF has no equivalent of UsdSkel's geom-bind matrix: the spec's
/// skinning formula is `skinMatrix * vertex` with the mesh node's own
/// transform ignored, and `inverseBindMatrices` are shared per skin —
/// while each USD mesh can author its own geomBindTransform. The only
/// faithful translation is to pre-transform the vertices so they live
/// in the skeleton's bind space, which is exactly what
/// `UsdSkelSkinningQuery` does before skinning.
///
/// Normals get the inverse-transpose of the 3×3 linear part (without
/// renormalisation — Three.js normalises in the shader). Blend-shape
/// offsets are resolved from separate target prims later and are NOT
/// rotated here; a non-identity geomBindTransform combined with blend
/// shapes is currently unhandled.
pub(crate) fn apply_geom_bind_transform(mesh_data: &mut ir::MeshData, matrix: &[f64; 16]) {
    let m: Vec<f32> = matrix.iter().map(|&v| v as f32).collect();
    let m: &[f32; 16] = m.as_slice().try_into().expect("mat4 has 16 elements");
    for p in mesh_data.points.chunks_exact_mut(3) {
        let (x, y, z) = (p[0], p[1], p[2]);
        p[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
        p[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        p[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    if let Some(normals) = mesh_data.normals.as_mut() {
        if let Some(inv) = invert_mat4_f32(m) {
            // Inverse-transpose of the linear part: read the inverse's
            // ROWS as the transformed basis (transpose fold-in).
            for n in normals.chunks_exact_mut(3) {
                let (x, y, z) = (n[0], n[1], n[2]);
                n[0] = inv[0] * x + inv[1] * y + inv[2] * z;
                n[1] = inv[4] * x + inv[5] * y + inv[6] * z;
                n[2] = inv[8] * x + inv[9] * y + inv[10] * z;
            }
        }
    }
}

/// Phase 5c E: convert a fork-level `SkeletonData` into a yw-look
/// `SkinInput` ready for the GLB writer.
///
/// ### Matrix layout
///
/// USD stores `matrix4d` values row-major with the **row-vector**
/// convention (`v' = v * M`, translation in the last row, flat
/// indices 12–14). That flat layout is byte-identical to glTF's
/// column-major column-vector layout, so `SkeletonData` matrices pass
/// through verbatim — exactly what `xformOp:transform` values get in
/// `xform.rs` (`SdfValue::Matrix4d(m) => m.0`). An earlier fork
/// revision transposed them in `read_mat4_vec_attr`, which shoved
/// every joint's translation into the projection slots and exploded
/// the mesh into spikes; the fork now passes them through unchanged.
/// `bindTransforms` are world-space bind transforms; glTF wants the
/// **inverse** of those for the `inverseBindMatrices` accessor, so
/// we invert each one before writing the GLB. `restTransforms` are
/// local-space bind-pose transforms per the UsdSkel spec, used as the
/// joint nodes' default TRS (the matrix is decomposed in `glb.rs`
/// because glTF disallows animating a node's `matrix`).
///
/// ### Skel-space `restTransforms` fallback
///
/// Some exporters (move.ai's Blender pipeline, e.g. `bbibbi.usdc`)
/// author `restTransforms` as **skeleton-space** cumulatives — byte
/// for byte identical to `bindTransforms` — instead of the
/// spec-mandated joint-local transforms. Treating those as local
/// double-accumulates every ancestor's transform, so deep joints
/// (fingers, neck, toes) fly off while near-root joints look almost
/// right. When `restTransforms` is missing or ≈ `bindTransforms`, we
/// instead derive each joint's local rest as
/// `inverse(bind[parent]) * bind[joint]`. This is exact in both
/// interpretations: if rest really was authored local AND equals
/// bind everywhere, every parent bind must be identity, making the
/// derivation a no-op.
pub(crate) fn skin_input_from_skel(
    name: &str,
    skel: &ir::SkeletonData,
    _up_axis_correction: Option<&[f32; 16]>,
) -> glb::SkinInput {
    let joint_count = skel.joints.len();

    // Skeleton bind/rest transforms stay in their authored space
    // (Z-up for Z-up stages). The Z-up → Y-up rotation lives on the
    // mesh node's world matrix, which Three.js applies AFTER the
    // skinning computation (`meshMatrix * skin(vertex, joints)`).
    // Rotating the skeleton transforms here would double-rotate the
    // result because the mesh node already carries the correction.
    let bind_world_matrices: &[[f32; 16]] = &skel.bind_transforms;
    let rest_matrices: Vec<[f32; 16]> = skel.rest_transforms.clone();
    let rest_looks_skel_space = !bind_world_matrices.is_empty()
        && rest_matrices.len() == bind_world_matrices.len()
        && rest_matrices
            .iter()
            .zip(bind_world_matrices)
            .all(|(r, b)| mat4_approx_eq(r, b, 1e-5));
    let rest_local_matrices: Vec<[f32; 16]> = if rest_matrices.is_empty() || rest_looks_skel_space {
        joint_locals_from_world(bind_world_matrices, &skel.parents)
    } else {
        rest_matrices
    };
    let inverse_bind_matrices: Vec<[f32; 16]> = bind_world_matrices
        .iter()
        .map(|m| invert_mat4_f32(m).unwrap_or(IDENTITY_MAT4_F32))
        .collect();
    // Pad shorter authored arrays out to the joint count with
    // identity so the GLB writer's parallel-length validation passes
    // even on slightly malformed assets.
    let rest_local_matrices = pad_to_len(rest_local_matrices, joint_count, IDENTITY_MAT4_F32);
    let inverse_bind_matrices = pad_to_len(inverse_bind_matrices, joint_count, IDENTITY_MAT4_F32);
    glb::SkinInput {
        name: format!("usd:{name}"),
        joint_names: skel.joints.clone(),
        parents: skel.parents.clone(),
        rest_local_matrices,
        inverse_bind_matrices,
        // The Rust fork doesn't expose the Skeleton prim's composed world
        // transform through `SkeletonData`, so the wrapper-node transform
        // cannot be recovered here. Keep this optional until the fork grows
        // the field.
        skel_root_matrix: None,
    }
}

fn mat4_approx_eq(a: &[f32; 16], b: &[f32; 16], eps: f32) -> bool {
    a.iter().zip(b).all(|(x, y)| (x - y).abs() <= eps)
}

/// Converts skeleton-space joint transforms into joint-local ones:
/// `local[i] = inverse(world[parent(i)]) * world[i]` (column-vector
/// convention). Roots keep their world transform as-is. A parent
/// index outside the slice or a singular parent matrix falls back to
/// the world transform, matching `pad_to_len`'s lenient stance on
/// malformed assets.
fn joint_locals_from_world(world: &[[f32; 16]], parents: &[Option<usize>]) -> Vec<[f32; 16]> {
    world
        .iter()
        .enumerate()
        .map(|(i, w)| {
            let Some(parent) = parents.get(i).copied().flatten() else {
                return *w;
            };
            let Some(parent_world) = world.get(parent) else {
                return *w;
            };
            match invert_mat4_f32(parent_world) {
                Some(inv_parent) => mat4_mul_f32(&inv_parent, w),
                None => *w,
            }
        })
        .collect()
}

fn pad_to_len<T: Clone>(mut v: Vec<T>, len: usize, fill: T) -> Vec<T> {
    while v.len() < len {
        v.push(fill.clone());
    }
    v.truncate(len);
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    fn translate_z(z: f32) -> [f32; 16] {
        let mut m = IDENTITY_MAT4_F32;
        m[14] = z;
        m
    }

    #[test]
    fn joint_locals_from_world_subtracts_parent_transform() {
        // Chain: root at z=1, child at z=3 (both skel-space cumulative).
        let world = vec![translate_z(1.0), translate_z(3.0)];
        let parents = vec![None, Some(0)];
        let locals = joint_locals_from_world(&world, &parents);
        assert_eq!(locals[0], translate_z(1.0));
        assert_eq!(locals[1], translate_z(2.0));
    }

    #[test]
    fn skin_input_derives_locals_when_rest_equals_bind() {
        // move.ai-style rig: restTransforms authored as skel-space
        // cumulatives, identical to bindTransforms. The converter must
        // NOT treat them as joint-local.
        let skel = ir::SkeletonData {
            joints: vec!["Root".into(), "Root/Hips".into()],
            bind_transforms: vec![translate_z(1.0), translate_z(3.0)],
            rest_transforms: vec![translate_z(1.0), translate_z(3.0)],
            parents: vec![None, Some(0)],
        };
        let skin = skin_input_from_skel("skel", &skel, None);
        assert_eq!(skin.rest_local_matrices[1], translate_z(2.0));
        // Inverse bind of translate(z=3) is translate(z=-3).
        assert_eq!(skin.inverse_bind_matrices[1], translate_z(-3.0));
    }

    #[test]
    fn skin_input_keeps_authored_local_rest_when_it_differs_from_bind() {
        let skel = ir::SkeletonData {
            joints: vec!["Root".into(), "Root/Hips".into()],
            bind_transforms: vec![translate_z(1.0), translate_z(3.0)],
            rest_transforms: vec![translate_z(1.0), translate_z(2.5)],
            parents: vec![None, Some(0)],
        };
        let skin = skin_input_from_skel("skel", &skel, None);
        assert_eq!(skin.rest_local_matrices[1], translate_z(2.5));
    }

    #[test]
    fn apply_geom_bind_transform_moves_points_into_bind_space() {
        let mut mesh = ir::MeshData {
            points: vec![0.0, 0.0, 0.0, 1.0, 2.0, 3.0],
            normals: Some(vec![0.0, 0.0, 1.0]),
            ..Default::default()
        };
        let mut geom_bind = [0.0_f64; 16];
        for i in [0, 5, 10, 15] {
            geom_bind[i] = 1.0;
        }
        geom_bind[14] = 0.875; // translate z, USD flat layout
        apply_geom_bind_transform(&mut mesh, &geom_bind);
        assert_eq!(mesh.points, vec![0.0, 0.0, 0.875, 1.0, 2.0, 3.875]);
        // Pure translation leaves normals untouched.
        assert_eq!(mesh.normals, Some(vec![0.0, 0.0, 1.0]));
    }
}

/// Phase 5c E: convert a fork-level `SkelAnimationData` into the
/// flattened-per-joint layout the GLB writer wants. Returns `None`
/// when neither joint TRS nor blend-shape weight samples are authored.
///
/// `time_codes_per_second` is used to map USD time codes (what the
/// fork returns) to glTF seconds. Pass the stage-level
/// `timeCodesPerSecond` metadata or the USD-spec default (24).
///
/// **Sparse channels** — UsdSkel allows authoring `rotations` or
/// `scales` only on a subset of the translation timeline, with
/// missing frames represented as empty vectors by
/// `align_samples_to_times`. Filling those gaps with zeros would
/// produce invalid `[0,0,0,0]` quaternions or zero scales (Codex
/// P2), so for any joint with at least one missing frame on a
/// channel we **drop** that channel entirely and let the runtime
/// fall back to the joint's rest TRS.
pub(crate) fn animation_input_from_skel(
    skin_index: usize,
    skin_joint_names: &[String],
    anim: &ir::SkelAnimationData,
    time_codes_per_second: f64,
    meshes: &[glb::MeshInput],
    input_source_paths: &[SdfPath],
    weight_mesh_indices: &[usize],
) -> Result<Option<glb::AnimationInput>, UsdError> {
    if anim.times.is_empty() && anim.blend_shape_weights.is_empty() {
        return Ok(None);
    }
    let frame_count = anim.times.len();
    let inv_tcps = if time_codes_per_second > 0.0 {
        1.0 / time_codes_per_second
    } else {
        1.0
    };
    let times: Vec<f32> = anim.times.iter().map(|&t| (t * inv_tcps) as f32).collect();
    let weight_times: Vec<f32> = anim
        .blend_shape_weights
        .iter()
        .map(|&(t, _)| {
            let seconds = (t * inv_tcps) as f32;
            if seconds.is_finite() {
                Ok(seconds)
            } else {
                Err(UsdError::Parse(
                    "USD SkelAnimation sample time overflows GLB seconds".to_owned(),
                ))
            }
        })
        .collect::<Result<_, _>>()?;

    // Build a mapping from skin joint -> index in the animation's
    // joint list. UsdSkelSkelAnimation can target a subset of the
    // skeleton's joints (in any order), so we look each skin joint
    // up by name; joints that aren't animated stay at rest.
    let anim_index_for: Vec<Option<usize>> = skin_joint_names
        .iter()
        .map(|name| anim.joints.iter().position(|j| j == name))
        .collect();

    let extract_channel = |samples: &[Vec<f32>], stride: usize| -> Vec<Option<Vec<f32>>> {
        anim_index_for
            .iter()
            .map(|maybe_anim_idx| {
                let Some(anim_idx) = *maybe_anim_idx else {
                    return None;
                };
                if frame_count == 0 || samples.is_empty() || samples.len() < frame_count {
                    return None;
                }
                let mut out = Vec::with_capacity(frame_count * stride);
                let off = anim_idx * stride;
                for frame in samples.iter().take(frame_count) {
                    // Sparse frame → drop the entire channel for
                    // this joint so the runtime keeps using the
                    // rest pose for the missing slots instead of
                    // collapsing on `[0,0,0,0]`.
                    if frame.is_empty() || off + stride > frame.len() {
                        return None;
                    }
                    out.extend_from_slice(&frame[off..off + stride]);
                }
                Some(out)
            })
            .collect()
    };

    let translations = extract_channel(&anim.translations, 3);
    let rotations = extract_channel(&anim.rotations, 4);
    let scales = extract_channel(&anim.scales, 3);

    let weight_channels = weight_channels_for_meshes(
        &anim.blend_shapes,
        &anim.blend_shape_weights,
        meshes,
        input_source_paths,
        weight_mesh_indices,
    )?;

    Ok(Some(glb::AnimationInput {
        name: "usd:SkelAnimation".to_string(),
        times,
        weight_times,
        skin_index,
        translations,
        rotations,
        scales,
        weight_channels,
    }))
}

fn weight_channels_for_meshes(
    shape_names: &[String],
    weight_samples: &[(f64, Vec<f32>)],
    meshes: &[glb::MeshInput],
    input_source_paths: &[SdfPath],
    weight_mesh_indices: &[usize],
) -> Result<Vec<glb::MorphWeightChannel>, UsdError> {
    if weight_samples.is_empty() {
        return Ok(Vec::new());
    }
    if shape_names.is_empty() {
        return Err(UsdError::Parse(
            "USD SkelAnimation blendShapeWeights has no blendShapes names".to_owned(),
        ));
    }
    if meshes.len() != input_source_paths.len() {
        return Err(UsdError::Parse(
            "USD mesh inputs and source paths have inconsistent lengths".to_owned(),
        ));
    }
    for (time, values) in weight_samples {
        if values.len() != shape_names.len() {
            return Err(UsdError::Parse(format!(
                "USD SkelAnimation blendShapeWeights at {time} has {} values; expected {}",
                values.len(),
                shape_names.len()
            )));
        }
    }
    if weight_mesh_indices
        .iter()
        .any(|&index| index >= meshes.len())
    {
        return Err(UsdError::Parse(
            "USD SkelAnimation weight mesh index is out of bounds".to_owned(),
        ));
    }

    let mut channels = Vec::new();
    let mut matched_any = false;
    for &mesh_index in weight_mesh_indices {
        let mesh = &meshes[mesh_index];
        if mesh.morph_targets.is_empty() {
            continue;
        }
        let source_path = &input_source_paths[mesh_index];
        let mut seen_targets = BTreeMap::<String, ()>::new();
        let target_to_shape = mesh
            .morph_targets
            .iter()
            .map(|target| {
                let name = target.name.as_ref().ok_or_else(|| {
                    UsdError::Parse(format!(
                        "mesh '{}' has a morph target without a name",
                        source_path
                    ))
                })?;
                if seen_targets.insert(name.clone(), ()).is_some() {
                    return Err(UsdError::Parse(format!(
                        "mesh '{}' has duplicate morph target name '{name}'",
                        source_path
                    )));
                }
                Ok(shape_names.iter().position(|shape| shape == name))
            })
            .collect::<Result<Vec<_>, UsdError>>()?;
        if !target_to_shape.iter().any(Option::is_some) {
            continue;
        }
        matched_any = true;
        let mut weights = Vec::with_capacity(weight_samples.len() * target_to_shape.len());
        for (_, frame) in weight_samples {
            for shape_index in &target_to_shape {
                weights.push(shape_index.map(|index| frame[index]).unwrap_or(0.0));
            }
        }
        channels.push(glb::MorphWeightChannel {
            mesh_index,
            weights,
        });
    }
    if !matched_any {
        return Err(UsdError::Parse(
            "USD SkelAnimation blendShapeWeights has no matching mesh morph targets".to_owned(),
        ));
    }
    Ok(channels)
}

#[cfg(test)]
mod animation_tests {
    use super::*;

    fn mesh_with_target(name: &str) -> glb::MeshInput {
        glb::MeshInput {
            name: name.to_owned(),
            world_matrix: IDENTITY_MAT4_F32,
            positions: vec![0.0, 0.0, 0.0],
            indices: vec![0, 0, 0],
            normals: None,
            uvs: None,
            colors: None,
            joint_indices: None,
            joint_weights: None,
            material_index: 0,
            skin_index: Some(0),
            morph_targets: vec![glb::MorphTarget {
                name: Some("Smile".to_owned()),
                position_offsets: vec![0.0, 0.0, 0.0],
            }],
            morph_weights: vec![0.0],
            purpose: None,
        }
    }

    #[test]
    fn weight_channels_only_include_meshes_bound_to_selected_skeleton() {
        let meshes = vec![mesh_with_target("RigA"), mesh_with_target("RigB")];
        let paths = vec![
            SdfPath::new("/RigA/Mesh").expect("path"),
            SdfPath::new("/RigB/Mesh").expect("path"),
        ];
        let names = vec!["Smile".to_owned()];
        let samples = vec![(0.0, vec![0.0]), (1.0, vec![1.0])];
        let channels = weight_channels_for_meshes(&names, &samples, &meshes, &paths, &[1])
            .expect("weight channels");
        assert_eq!(channels.len(), 1);
        assert_eq!(channels[0].mesh_index, 1);
        assert_eq!(channels[0].weights, vec![0.0, 1.0]);
    }

    #[test]
    fn keeps_trs_timeline_separate_from_weight_timeline() {
        let anim = ir::SkelAnimationData {
            times: vec![0.0, 24.0],
            translations: vec![vec![0.0, 0.0, 0.0], vec![2.0, 0.0, 0.0]],
            rotations: Vec::new(),
            scales: Vec::new(),
            joints: vec!["root".to_owned()],
            blend_shapes: vec!["Smile".to_owned()],
            blend_shape_weights: vec![(0.0, vec![0.0]), (12.0, vec![0.5]), (24.0, vec![1.0])],
        };
        let meshes = vec![mesh_with_target("Rig")];
        let paths = vec![SdfPath::new("/Rig/Mesh").expect("path")];
        let input =
            animation_input_from_skel(0, &["root".to_owned()], &anim, 24.0, &meshes, &paths, &[0])
                .expect("animation input")
                .expect("animated input");

        assert_eq!(input.times, vec![0.0, 1.0]);
        assert_eq!(input.weight_times, vec![0.0, 0.5, 1.0]);
        assert_eq!(
            input.translations[0],
            Some(vec![0.0, 0.0, 0.0, 2.0, 0.0, 0.0])
        );
        assert_eq!(input.weight_channels[0].weights, vec![0.0, 0.5, 1.0]);
    }
}
