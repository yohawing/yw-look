use std::collections::{HashMap, HashSet};

use openusd::sdf::Path as SdfPath;
use openusd::usd::Stage;

use crate::usd::glb::{self, MeshInput};
use crate::usd::math::{identity_mat4, invert_mat4, mat4_f64_to_f32, mat4_mul};
use crate::usd::node_tree::{
    collect_node_payload_maps, emit_node_inputs, insert_ancestor_group_nodes,
};

use super::xform::compose_world_xform;

/// #46 Pass 1.5: build the topologically-sorted `NodeInput` tree from the
/// prim paths collected by Pass 1. Every ancestor Xform/Scope prim between
/// the stage root and each leaf (Mesh/Light/Camera/SkelRoot) is inserted as
/// a `NodeKind::Group` node. The result is topologically sorted so that
/// parent nodes always appear before their children.
///
/// Z-up -> Y-up correction is applied via a synthetic `__upAxis` node that
/// is NOT part of the returned slice -- `build_glb` inserts it automatically
/// when the slice is non-empty. The local_matrix stored on each NodeInput is
/// therefore relative to its USD parent prim (not world space).
pub(crate) fn build_node_tree(
    stage: &Stage,
    _mesh_paths: &[SdfPath],
    skin_slots: &HashMap<String, usize>,
    _mesh_skin_slots: &[Option<usize>],
    inputs: &[MeshInput],
    lights: &[glb::LightInput],
    cameras: &[glb::CameraInput],
    instancing: &[glb::InstancingInput],
    _up_correction: Option<&[f64; 16]>,
) -> Vec<glb::NodeInput> {
    let prototype_mesh_indices = instancing
        .iter()
        .map(|input| input.prototype_mesh_idx)
        .collect::<HashSet<_>>();
    let mut maps = collect_node_payload_maps(
        inputs,
        lights,
        cameras,
        skin_slots,
        |mesh_index, _| !prototype_mesh_indices.contains(&mesh_index),
        false,
    );
    for input in instancing {
        maps.path_to_kind.insert(
            input.instancer_prim_path.clone(),
            glb::NodeKind::PointInstancer,
        );
    }
    insert_ancestor_group_nodes(&mut maps.path_to_kind);

    // ---- Step 2: topological sort (ancestor before child) ---------------
    // Lexicographic order gives a correct
    // topological order for SdfPaths: "/A" always sorts before "/A/B".
    let mut sorted_paths: Vec<String> = maps.path_to_kind.keys().cloned().collect();
    sorted_paths.sort();

    // ---- Step 3: compute local matrices ---------------------------------
    // For each node we need local = parent_world^-1 * own_world.
    // We compute world matrices once and invert the parent.
    // For efficiency, we cache world matrices as we go (parents appear first).

    // Helper: world matrix for a prim path (as f64 column-major).
    // Applies up-axis correction at the top level only.
    let get_world_f64 = |path_str: &str| -> [f64; 16] {
        let Ok(sdf) = SdfPath::new(path_str) else {
            return identity_mat4();
        };
        let Ok(world) = compose_world_xform(stage, &sdf) else {
            return identity_mat4();
        };
        // Apply Z->Y up-axis correction to top-level prims only by
        // pre-multiplying. The correction has already been folded into
        // the `world` produced by compose_world_xform for meshes in Pass 2
        // (where it was applied per mesh). Here we do NOT apply it because
        // the `__upAxis` synthetic node in build_glb will carry it instead.
        // So we return the raw world matrix WITHOUT up-axis correction.
        world
    };

    emit_node_inputs(&maps, &sorted_paths, |path_str, parent_path| {
        // Local matrix = parent_world^-1 * own_world.
        // For top-level prims (no parent in our tree), local = world.
        let own_world = get_world_f64(path_str);
        let local_mat_f64 = if let Some(parent_path) = parent_path {
            // parent world = out[p_ni].local_matrix chain -- but since we have
            // the raw world we just invert the parent world and multiply.
            // Recompute parent world from its path.
            let parent_world = get_world_f64(parent_path);
            if let Some(inv_parent) = invert_mat4(&parent_world) {
                mat4_mul(&inv_parent, &own_world)
            } else {
                own_world
            }
        } else {
            own_world
        };
        mat4_f64_to_f32(&local_mat_f64)
    })
}
