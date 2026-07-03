use openusd::sdf::schema::FieldKey;
use openusd::sdf::{Path as SdfPath, Value as SdfValue};
use openusd::Stage;

use crate::usd::glb;
use crate::usd::math::{invert_mat4_f32, IDENTITY_MAT4_F32};

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
    let value: Option<SdfValue> = stage.field(attr_path, FieldKey::Default).ok()?;
    match value? {
        SdfValue::TokenVec(v) => Some(token_vec_to_strings(v)),
        SdfValue::StringVec(v) => Some(v),
        _ => None,
    }
}

/// Phase 5c E: convert a fork-level `SkeletonData` into a yw-look
/// `SkinInput` ready for the GLB writer.
///
/// `SkeletonData::{bind_transforms, rest_transforms}` are already
/// stored in **column-major** layout by the fork (matching glTF's
/// expectation), so we pass them through verbatim — Codex P1: an
/// earlier version mistakenly transposed both arrays which flipped
/// every joint transform.
///
/// `bindTransforms` are world-space bind transforms; glTF wants the
/// **inverse** of those for the `inverseBindMatrices` accessor, so
/// we invert each one before writing the GLB. `restTransforms` are
/// local-space bind-pose transforms and pass through unchanged for
/// use as the joint nodes' default TRS (the matrix is decomposed in
/// `glb.rs` because glTF disallows animating a node's `matrix`).
pub(crate) fn skin_input_from_skel(
    name: &str,
    skel: &openusd::stage::SkeletonData,
    _up_axis_correction: Option<&[f32; 16]>,
) -> glb::SkinInput {
    let joint_count = skel.joints.len();

    // Skeleton bind/rest transforms stay in their authored space
    // (Z-up for Z-up stages). The Z-up → Y-up rotation lives on the
    // mesh node's world matrix, which Three.js applies AFTER the
    // skinning computation (`meshMatrix * skin(vertex, joints)`).
    // Rotating the skeleton transforms here would double-rotate the
    // result because the mesh node already carries the correction.
    let rest_local_matrices: Vec<[f32; 16]> = skel.rest_transforms.clone();
    let inverse_bind_matrices: Vec<[f32; 16]> = skel
        .bind_transforms
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
        // The Rust fork doesn't expose the Skeleton prim's
        // composed world transform through `SkeletonData`, so we
        // can't easily recover the wrapper-node transform yw-look
        // uses on the cpp side to fix the scale mismatch between
        // skinned and unskinned meshes. Leave `None` until the
        // fork grows the field — assets that need it (ARKit
        // chameleon) should switch to the cpp backend in the
        // meantime.
        skel_root_matrix: None,
    }
}

fn pad_to_len<T: Clone>(mut v: Vec<T>, len: usize, fill: T) -> Vec<T> {
    while v.len() < len {
        v.push(fill.clone());
    }
    v.truncate(len);
    v
}

/// Phase 5c E: convert a fork-level `SkelAnimationData` into the
/// flattened-per-joint layout the GLB writer wants. Returns `None`
/// when the animation has no time samples.
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
    anim: &openusd::stage::SkelAnimationData,
    time_codes_per_second: f64,
) -> Option<glb::AnimationInput> {
    if anim.times.is_empty() {
        return None;
    }
    let frame_count = anim.times.len();
    let inv_tcps = if time_codes_per_second > 0.0 {
        1.0 / time_codes_per_second
    } else {
        1.0
    };
    let times: Vec<f32> = anim.times.iter().map(|&t| (t * inv_tcps) as f32).collect();

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
                if samples.is_empty() || samples.len() < frame_count {
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

    Some(glb::AnimationInput {
        name: "usd:SkelAnimation".to_string(),
        times,
        skin_index,
        translations,
        rotations,
        scales,
        // Phase 2.O: morph-target weight channels are resolved at
        // the cpp-backend level today (the fork's SkelAnimationData
        // doesn't yet expose `blendShapeWeights`). Rust-fork
        // animations stay static-rest for blend shapes until the
        // fork grows the field.
        weight_channels: Vec::new(),
    })
}
