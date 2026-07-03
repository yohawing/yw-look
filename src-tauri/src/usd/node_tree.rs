//! Backend-independent helpers for building GLB node hierarchy inputs.

use std::collections::{HashMap, HashSet};

use super::glb::{self, MeshInput};
use super::prim_path::{ancestor_group_paths, basename_from_prim_path, parent_prim_path};

pub(crate) struct NodePayloadMaps {
    pub(crate) path_to_kind: HashMap<String, glb::NodeKind>,
    pub(crate) path_to_mesh_idx: HashMap<String, usize>,
    pub(crate) path_to_light_idx: HashMap<String, usize>,
    pub(crate) path_to_camera_idx: HashMap<String, usize>,
    pub(crate) path_to_skel_idx: HashMap<String, usize>,
}

pub(crate) fn collect_node_payload_maps<F>(
    inputs: &[MeshInput],
    lights: &[glb::LightInput],
    cameras: &[glb::CameraInput],
    skin_slots: &HashMap<String, usize>,
    mut include_mesh: F,
    require_absolute_paths: bool,
) -> NodePayloadMaps
where
    F: FnMut(usize, &MeshInput) -> bool,
{
    let mut maps = NodePayloadMaps {
        path_to_kind: HashMap::new(),
        path_to_mesh_idx: HashMap::new(),
        path_to_light_idx: HashMap::new(),
        path_to_camera_idx: HashMap::new(),
        path_to_skel_idx: HashMap::new(),
    };

    for (mi, input) in inputs.iter().enumerate() {
        if !include_mesh(mi, input) {
            continue;
        }
        let path = input.name.clone();
        if !accept_path(&path, require_absolute_paths) {
            continue;
        }
        maps.path_to_kind.insert(path.clone(), glb::NodeKind::Mesh);
        maps.path_to_mesh_idx.insert(path, mi);
    }

    for (li, light) in lights.iter().enumerate() {
        let path = light.name.clone();
        if !accept_path(&path, require_absolute_paths) {
            continue;
        }
        maps.path_to_kind.insert(path.clone(), glb::NodeKind::Light);
        maps.path_to_light_idx.insert(path, li);
    }

    for (ci, camera) in cameras.iter().enumerate() {
        let path = camera.name.clone();
        if !accept_path(&path, require_absolute_paths) {
            continue;
        }
        maps.path_to_kind
            .insert(path.clone(), glb::NodeKind::Camera);
        maps.path_to_camera_idx.insert(path, ci);
    }

    for (skel_path, &slot_idx) in skin_slots {
        maps.path_to_kind
            .insert(skel_path.clone(), glb::NodeKind::SkelRoot);
        maps.path_to_skel_idx.insert(skel_path.clone(), slot_idx);
    }

    insert_ancestor_group_nodes(&mut maps.path_to_kind);
    maps
}

pub(crate) fn insert_ancestor_group_nodes(path_to_kind: &mut HashMap<String, glb::NodeKind>) {
    let leaf_paths: Vec<String> = path_to_kind.keys().cloned().collect();
    for path in &leaf_paths {
        for parent in ancestor_group_paths(path) {
            path_to_kind
                .entry(parent.to_string())
                .or_insert(glb::NodeKind::Group);
        }
    }
}

pub(crate) fn emit_node_inputs<F>(
    maps: &NodePayloadMaps,
    sorted_paths: &[String],
    mut local_matrix_for: F,
) -> Vec<glb::NodeInput>
where
    F: FnMut(&str, Option<&str>) -> [f32; 16],
{
    let mut path_to_ni_idx: HashMap<String, usize> = HashMap::new();
    for (idx, path) in sorted_paths.iter().enumerate() {
        path_to_ni_idx.insert(path.clone(), idx);
    }

    let mut out = Vec::with_capacity(sorted_paths.len());
    for path in sorted_paths {
        let parent_path = parent_prim_path(path);
        let parent = parent_path.and_then(|parent| path_to_ni_idx.get(parent).copied());
        let local_matrix = local_matrix_for(path, parent_path.filter(|_| parent.is_some()));

        out.push(glb::NodeInput {
            prim_path: path.clone(),
            basename: basename_from_prim_path(path),
            parent,
            local_matrix,
            kind: *maps
                .path_to_kind
                .get(path)
                .expect("sorted path must exist in node kind map"),
            mesh_payload_idx: maps.path_to_mesh_idx.get(path).copied(),
            light_payload_idx: maps.path_to_light_idx.get(path).copied(),
            camera_payload_idx: maps.path_to_camera_idx.get(path).copied(),
            skin_payload_idx: maps.path_to_skel_idx.get(path).copied(),
        });
    }
    out
}

/// Orders node paths by authored stage traversal. Paths not present in
/// `maps` are ignored, repeated traversal paths are emitted once, and
/// map keys missing from traversal are appended in lexicographic order
/// for deterministic fallback output.
#[cfg_attr(not(feature = "backend-openusd-cpp"), allow(dead_code))]
pub(crate) fn order_node_paths_by_traversal(
    maps: &NodePayloadMaps,
    traversal_paths: &[String],
) -> Vec<String> {
    let mut ordered_paths = Vec::with_capacity(maps.path_to_kind.len());
    let mut emitted: HashSet<String> = HashSet::new();
    for path in traversal_paths {
        if maps.path_to_kind.contains_key(path) && emitted.insert(path.clone()) {
            ordered_paths.push(path.clone());
        }
    }
    if emitted.len() < maps.path_to_kind.len() {
        let mut leftovers: Vec<String> = maps
            .path_to_kind
            .keys()
            .filter(|path| !emitted.contains(*path))
            .cloned()
            .collect();
        leftovers.sort();
        ordered_paths.extend(leftovers);
    }
    ordered_paths
}

fn accept_path(path: &str, require_absolute_paths: bool) -> bool {
    !require_absolute_paths || path.starts_with('/')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity_matrix() -> [f32; 16] {
        [
            1.0, 0.0, 0.0, 0.0, //
            0.0, 1.0, 0.0, 0.0, //
            0.0, 0.0, 1.0, 0.0, //
            0.0, 0.0, 0.0, 1.0,
        ]
    }

    fn mesh_input(name: &str) -> MeshInput {
        MeshInput {
            name: name.to_string(),
            world_matrix: identity_matrix(),
            positions: Vec::new(),
            indices: Vec::new(),
            normals: None,
            uvs: None,
            colors: None,
            joint_indices: None,
            joint_weights: None,
            material_index: 0,
            skin_index: None,
            morph_targets: Vec::new(),
            morph_weights: Vec::new(),
            purpose: None,
        }
    }

    fn maps_with_paths(paths: &[&str]) -> NodePayloadMaps {
        let mut path_to_kind = HashMap::new();
        for path in paths {
            path_to_kind.insert((*path).to_string(), glb::NodeKind::Group);
        }
        NodePayloadMaps {
            path_to_kind,
            path_to_mesh_idx: HashMap::new(),
            path_to_light_idx: HashMap::new(),
            path_to_camera_idx: HashMap::new(),
            path_to_skel_idx: HashMap::new(),
        }
    }

    #[test]
    fn collect_maps_inserts_leaf_payloads_and_ancestor_groups() {
        let inputs = vec![mesh_input("/Root/Geom/Cube"), mesh_input("synthetic")];
        let maps = collect_node_payload_maps(&inputs, &[], &[], &HashMap::new(), |_, _| true, true);

        assert_eq!(
            maps.path_to_kind.get("/Root/Geom/Cube"),
            Some(&glb::NodeKind::Mesh)
        );
        assert_eq!(
            maps.path_to_kind.get("/Root/Geom"),
            Some(&glb::NodeKind::Group)
        );
        assert_eq!(maps.path_to_kind.get("/Root"), Some(&glb::NodeKind::Group));
        assert!(!maps.path_to_kind.contains_key("synthetic"));
        assert_eq!(maps.path_to_mesh_idx.get("/Root/Geom/Cube"), Some(&0));
    }

    #[test]
    fn collect_maps_honors_mesh_filter_and_path_policy() {
        let inputs = vec![mesh_input("/Root/Visible"), mesh_input("/Root/Prototype")];
        let maps =
            collect_node_payload_maps(&inputs, &[], &[], &HashMap::new(), |mi, _| mi == 0, true);

        assert_eq!(
            maps.path_to_kind.get("/Root/Visible"),
            Some(&glb::NodeKind::Mesh)
        );
        assert!(!maps.path_to_kind.contains_key("/Root/Prototype"));
        assert_eq!(maps.path_to_kind.get("/Root"), Some(&glb::NodeKind::Group));
    }

    #[test]
    fn collect_maps_allows_synthetic_mesh_paths_when_not_required_absolute() {
        let inputs = vec![mesh_input("synthetic")];
        let maps =
            collect_node_payload_maps(&inputs, &[], &[], &HashMap::new(), |_, _| true, false);

        assert_eq!(
            maps.path_to_kind.get("synthetic"),
            Some(&glb::NodeKind::Mesh)
        );
        assert_eq!(maps.path_to_mesh_idx.get("synthetic"), Some(&0));
    }

    #[test]
    fn emit_node_inputs_assigns_parent_and_payload_indices() {
        let inputs = vec![mesh_input("/Root/Cube")];
        let maps = collect_node_payload_maps(&inputs, &[], &[], &HashMap::new(), |_, _| true, true);
        let sorted_paths = vec!["/Root".to_string(), "/Root/Cube".to_string()];

        let nodes = emit_node_inputs(&maps, &sorted_paths, |_path, _parent| identity_matrix());

        assert_eq!(nodes[0].prim_path, "/Root");
        assert_eq!(nodes[0].parent, None);
        assert_eq!(nodes[0].kind, glb::NodeKind::Group);
        assert_eq!(nodes[1].prim_path, "/Root/Cube");
        assert_eq!(nodes[1].parent, Some(0));
        assert_eq!(nodes[1].mesh_payload_idx, Some(0));
    }

    #[test]
    fn emit_node_inputs_uses_world_matrix_when_parent_is_not_emitted() {
        let inputs = vec![mesh_input("/Root/Cube")];
        let maps = collect_node_payload_maps(&inputs, &[], &[], &HashMap::new(), |_, _| true, true);
        let sorted_paths = vec!["/Root/Cube".to_string()];

        let nodes = emit_node_inputs(&maps, &sorted_paths, |_, parent| {
            assert_eq!(parent, None);
            identity_matrix()
        });

        assert_eq!(nodes[0].prim_path, "/Root/Cube");
        assert_eq!(nodes[0].parent, None);
    }

    #[test]
    fn order_by_traversal_follows_stage_sequence() {
        let maps = maps_with_paths(&["/C", "/A", "/A/B"]);
        let traversal = vec!["/A".to_string(), "/A/B".to_string(), "/C".to_string()];

        let ordered = order_node_paths_by_traversal(&maps, &traversal);

        assert_eq!(ordered, vec!["/A", "/A/B", "/C"]);
    }

    #[test]
    fn order_by_traversal_appends_missing_paths_lexicographically() {
        let maps = maps_with_paths(&["/A", "/C", "/B", "/Z"]);
        let traversal = vec!["/C".to_string(), "/A".to_string()];

        let ordered = order_node_paths_by_traversal(&maps, &traversal);

        assert_eq!(ordered, vec!["/C", "/A", "/B", "/Z"]);
    }

    #[test]
    fn order_by_traversal_deduplicates_repeated_paths() {
        let maps = maps_with_paths(&["/A", "/B"]);
        let traversal = vec!["/A".to_string(), "/A".to_string(), "/B".to_string()];

        let ordered = order_node_paths_by_traversal(&maps, &traversal);

        assert_eq!(ordered, vec!["/A", "/B"]);
    }

    #[test]
    fn order_by_traversal_ignores_paths_not_in_kind_map() {
        let maps = maps_with_paths(&["/A", "/B"]);
        let traversal = vec!["/Ignored".to_string(), "/B".to_string()];

        let ordered = order_node_paths_by_traversal(&maps, &traversal);

        assert_eq!(ordered, vec!["/B", "/A"]);
    }

    #[test]
    fn order_by_traversal_empty_traversal_falls_back_to_lexicographic() {
        let maps = maps_with_paths(&["/C", "/A", "/B"]);

        let ordered = order_node_paths_by_traversal(&maps, &[]);

        assert_eq!(ordered, vec!["/A", "/B", "/C"]);
    }
}
