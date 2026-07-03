//! Backend-independent USD skeleton, skinning, and blend-shape helpers.

use openusd::stage::MeshData;

/// Rewrites `mesh.joint_indices` so every influence references the
/// bound Skeleton's full joint order (what the GLB skin exposes)
/// rather than the mesh's local `skel:joints` subset. Influences
/// whose local joint can't be matched to the skeleton are dropped by
/// zeroing their weight; glTF normalizes weights per-vertex, so this
/// degrades gracefully for mildly malformed authoring.
///
/// No-op when the mesh has no joint influences authored, so the
/// caller can invoke this unconditionally on any rigged mesh.
pub(crate) fn remap_mesh_skin_indices(
    mesh: &mut MeshData,
    mesh_local_joints: &[String],
    skeleton_joints: &[String],
) {
    // Precompute local -> skeleton index, once per mesh. `None` means
    // the local joint isn't present in the skeleton: authoring bug or
    // stray entry, handled below by zeroing weights.
    let remap: Vec<Option<u32>> = mesh_local_joints
        .iter()
        .map(|local| {
            skeleton_joints
                .iter()
                .position(|s| s == local)
                .map(|i| i as u32)
        })
        .collect();

    let (Some(indices), Some(weights)) = (mesh.joint_indices.as_mut(), mesh.joint_weights.as_mut())
    else {
        return;
    };

    for (idx, w) in indices.iter_mut().zip(weights.iter_mut()) {
        let local = *idx as usize;
        match remap.get(local).and_then(|r| *r) {
            Some(skel_index) => *idx = skel_index,
            None => {
                // Unmatched local joint: zero the influence so the
                // vertex falls back to its other influences (or to
                // the rest pose if this was its only one).
                *idx = 0;
                *w = 0.0;
            }
        }
    }
}

/// Pack a single point's joint influences (USD-side variable count)
/// into the 4 fixed slots glTF wants. If the source has more than 4
/// influences we keep the 4 strongest by weight; if fewer, we zero-
/// pad and renormalize is left to the runtime (Three.js handles
/// non-unit weight totals on the GPU).
///
/// `max_joint` is the number of joints in the skeleton. Any index
/// >= `max_joint` is clamped to 0 and its weight zeroed so the GLB
/// never references a bone that doesn't exist in the skin's joints
/// array. HumanFemale hits this: USD's `primvars:skel:jointIndices`
/// can reference the **full** skeleton's joint list (≈109 joints)
/// while `Stage::skeleton_of` may return a subset (≈66) depending
/// on which payload/reference paths the fork could compose.
pub(crate) fn pack_skin_influences(
    src_idx: &[u32],
    src_w: &[f32],
    out_idx: &mut Vec<u16>,
    out_w: &mut Vec<f32>,
    max_joint: usize,
) {
    // Quick paths for the common 1..=4 cases.
    let n = src_idx.len();
    if n <= 4 {
        for i in 0..4 {
            if i < n && (src_idx[i] as usize) < max_joint {
                out_idx.push(src_idx[i] as u16);
                out_w.push(src_w[i]);
            } else {
                out_idx.push(0);
                out_w.push(0.0);
            }
        }
        return;
    }
    // n > 4: pick the four strongest weights. Stable sort by weight
    // desc keeps results deterministic across runs.
    let mut pairs: Vec<(usize, f32)> = (0..n).map(|i| (i, src_w[i])).collect();
    pairs.sort_by(|a, b| b.1.total_cmp(&a.1));
    for i in 0..4 {
        let (idx, w) = pairs[i];
        let ji = src_idx[idx] as usize;
        if ji < max_joint {
            out_idx.push(ji as u16);
            out_w.push(w);
        } else {
            out_idx.push(0);
            out_w.push(0.0);
        }
    }
}

/// Phase 6d: one morph target expanded to dense per-vertex offsets.
///
/// `offsets` is flat `[dx0, dy0, dz0, dx1, dy1, dz1, ...]` of length
/// `point_count * 3`, covering every vertex in the mesh. When the
/// authored USD data is sparse (`pointIndices` + a shorter `offsets`
/// array), blend-shape resolution fills unaffected vertices with zero
/// deltas.
/// Positions-only morph offsets; `normalOffsets` and `inbetweens` are
/// resolved or ignored in each backend's blend-shape resolver.
pub(crate) struct DenseBlendShape {
    pub name: String,
    pub offsets: Vec<f32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mesh_with_skin(indices: Option<Vec<u32>>, weights: Option<Vec<f32>>) -> MeshData {
        MeshData {
            points: vec![0.0; 3],
            face_vertex_indices: vec![0],
            face_vertex_counts: vec![1],
            normals: None,
            uvs: None,
            joint_indices: indices,
            joint_weights: weights,
            joints_per_vertex: 2,
            display_color: None,
        }
    }

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    fn pack(src_idx: &[u32], src_w: &[f32], max_joint: usize) -> (Vec<u16>, Vec<f32>) {
        let mut out_idx = Vec::new();
        let mut out_w = Vec::new();
        pack_skin_influences(src_idx, src_w, &mut out_idx, &mut out_w, max_joint);
        (out_idx, out_w)
    }

    #[test]
    fn remap_mesh_skin_indices_maps_local_indices_to_skeleton_indices() {
        let mut mesh = mesh_with_skin(Some(vec![0, 1, 1, 0]), Some(vec![0.5, 0.5, 0.25, 0.75]));

        remap_mesh_skin_indices(
            &mut mesh,
            &strings(&["Arm", "Hand"]),
            &strings(&["Root", "Arm", "Hand"]),
        );

        assert_eq!(mesh.joint_indices, Some(vec![1, 2, 2, 1]));
        assert_eq!(mesh.joint_weights, Some(vec![0.5, 0.5, 0.25, 0.75]));
    }

    #[test]
    fn remap_mesh_skin_indices_zeroes_unmatched_local_joint() {
        let mut mesh = mesh_with_skin(Some(vec![0, 1]), Some(vec![0.4, 0.6]));

        remap_mesh_skin_indices(
            &mut mesh,
            &strings(&["Arm", "Missing"]),
            &strings(&["Root", "Arm"]),
        );

        assert_eq!(mesh.joint_indices, Some(vec![1, 0]));
        assert_eq!(mesh.joint_weights, Some(vec![0.4, 0.0]));
    }

    #[test]
    fn remap_mesh_skin_indices_is_noop_without_complete_skin_payload() {
        let mut no_indices = mesh_with_skin(None, Some(vec![1.0]));
        remap_mesh_skin_indices(
            &mut no_indices,
            &strings(&["Arm"]),
            &strings(&["Root", "Arm"]),
        );
        assert_eq!(no_indices.joint_indices, None);
        assert_eq!(no_indices.joint_weights, Some(vec![1.0]));

        let mut no_weights = mesh_with_skin(Some(vec![0]), None);
        remap_mesh_skin_indices(
            &mut no_weights,
            &strings(&["Arm"]),
            &strings(&["Root", "Arm"]),
        );
        assert_eq!(no_weights.joint_indices, Some(vec![0]));
        assert_eq!(no_weights.joint_weights, None);
    }

    #[test]
    fn remap_mesh_skin_indices_zeroes_out_of_range_local_index() {
        let mut mesh = mesh_with_skin(Some(vec![3]), Some(vec![1.0]));

        remap_mesh_skin_indices(&mut mesh, &strings(&["Arm"]), &strings(&["Root", "Arm"]));

        assert_eq!(mesh.joint_indices, Some(vec![0]));
        assert_eq!(mesh.joint_weights, Some(vec![0.0]));
    }

    #[test]
    fn remap_mesh_skin_indices_zeroes_when_local_joint_list_is_empty() {
        let mut mesh = mesh_with_skin(Some(vec![0]), Some(vec![1.0]));

        remap_mesh_skin_indices(&mut mesh, &[], &strings(&["Root", "Arm"]));

        assert_eq!(mesh.joint_indices, Some(vec![0]));
        assert_eq!(mesh.joint_weights, Some(vec![0.0]));
    }

    #[test]
    fn remap_mesh_skin_indices_uses_first_matching_skeleton_joint() {
        let mut mesh = mesh_with_skin(Some(vec![0]), Some(vec![1.0]));

        remap_mesh_skin_indices(
            &mut mesh,
            &strings(&["Arm"]),
            &strings(&["Root", "Arm", "Arm"]),
        );

        assert_eq!(mesh.joint_indices, Some(vec![1]));
        assert_eq!(mesh.joint_weights, Some(vec![1.0]));
    }

    #[test]
    fn remap_mesh_skin_indices_only_processes_paired_indices_and_weights() {
        let mut mesh = mesh_with_skin(Some(vec![0, 1]), Some(vec![0.25]));

        remap_mesh_skin_indices(
            &mut mesh,
            &strings(&["Arm", "Hand"]),
            &strings(&["Root", "Arm", "Hand"]),
        );

        assert_eq!(mesh.joint_indices, Some(vec![1, 1]));
        assert_eq!(mesh.joint_weights, Some(vec![0.25]));
    }

    #[test]
    fn pack_skin_influences_pads_one_influence_to_four_slots() {
        let (indices, weights) = pack(&[2], &[0.75], 4);

        assert_eq!(indices, vec![2, 0, 0, 0]);
        assert_eq!(weights, vec![0.75, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn pack_skin_influences_zeroes_joint_index_at_or_above_max_joint() {
        let (indices, weights) = pack(&[1, 3, 2], &[0.2, 0.7, 0.1], 3);

        assert_eq!(indices, vec![1, 0, 2, 0]);
        assert_eq!(weights, vec![0.2, 0.0, 0.1, 0.0]);
    }

    #[test]
    fn pack_skin_influences_passes_through_four_or_fewer_without_sorting() {
        let (indices, weights) = pack(&[3, 1, 2, 0], &[0.1, 0.8, 0.3, 0.2], 4);

        assert_eq!(indices, vec![3, 1, 2, 0]);
        assert_eq!(weights, vec![0.1, 0.8, 0.3, 0.2]);
    }

    #[test]
    fn pack_skin_influences_selects_top_four_by_weight() {
        let (indices, weights) = pack(&[0, 1, 2, 3, 4, 5], &[0.1, 0.9, 0.3, 0.7, 0.2, 0.5], 6);

        assert_eq!(indices, vec![1, 3, 5, 2]);
        assert_eq!(weights, vec![0.9, 0.7, 0.5, 0.3]);
    }

    #[test]
    fn pack_skin_influences_stable_sort_preserves_index_order_on_tied_weights() {
        let (indices, weights) = pack(&[10, 11, 12, 13, 14], &[0.5, 0.8, 0.8, 0.8, 0.1], 20);

        assert_eq!(indices, vec![11, 12, 13, 10]);
        assert_eq!(weights, vec![0.8, 0.8, 0.8, 0.5]);
    }

    #[test]
    fn pack_skin_influences_empty_input_pads_four_zeros() {
        let (indices, weights) = pack(&[], &[], 4);

        assert_eq!(indices, vec![0, 0, 0, 0]);
        assert_eq!(weights, vec![0.0, 0.0, 0.0, 0.0]);
    }
}
