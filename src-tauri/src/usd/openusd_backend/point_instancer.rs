use std::collections::{BTreeMap, HashSet};

use openusd::sdf::Path as SdfPath;
use openusd::usd::Stage;

use crate::usd::glb::{decompose_trs_column_major, InstancingInput};
use crate::usd::math::{invert_mat4, mat4_f64_to_f32, mat4_mul, mat4_mul_f32, trs_to_mat4_f32};

use super::stage_query;
use super::xform::compose_world_xform;

#[derive(Default)]
struct InstanceTransforms {
    translations: Vec<[f32; 3]>,
    rotations: Vec<[f32; 4]>,
    scales: Vec<[f32; 3]>,
}

pub(crate) fn resolve_point_instancing(
    stage: &Stage,
    instancer_paths: &[SdfPath],
    input_source_paths: &[SdfPath],
) -> Vec<InstancingInput> {
    let mut resolved = Vec::new();

    for instancer_path in instancer_paths {
        let data = match stage_query::point_instancer_of(stage, instancer_path.clone()) {
            Ok(Some(data)) => data,
            Ok(None) => continue,
            Err(error) => {
                log::warn!(
                    "[usd-rs] failed to read PointInstancer '{}': {error}",
                    instancer_path
                );
                continue;
            }
        };
        let instancer_world = match compose_world_xform(stage, instancer_path) {
            Ok(matrix) => matrix,
            Err(error) => {
                log::warn!(
                    "[usd-rs] failed to compose PointInstancer transform '{}': {error}",
                    instancer_path
                );
                continue;
            }
        };
        let Some(instancer_world_inverse) = invert_mat4(&instancer_world) else {
            log::warn!(
                "[usd-rs] PointInstancer '{}' has a non-invertible transform",
                instancer_path
            );
            continue;
        };
        let invisible_ids: HashSet<i64> = data.invisible_ids.iter().copied().collect();
        let mut by_prototype = BTreeMap::<usize, InstanceTransforms>::new();

        for (instance_index, &prototype_index) in data.proto_indices.iter().enumerate() {
            let Ok(prototype_index) = usize::try_from(prototype_index) else {
                log::warn!(
                    "[usd-rs] PointInstancer '{}' has negative protoIndices[{instance_index}]",
                    instancer_path
                );
                continue;
            };
            if prototype_index >= data.prototypes.len() {
                log::warn!(
                    "[usd-rs] PointInstancer '{}' has out-of-range protoIndices[{instance_index}]={prototype_index}",
                    instancer_path
                );
                continue;
            }
            let id = data
                .ids
                .get(instance_index)
                .copied()
                .unwrap_or(instance_index as i64);
            if invisible_ids.contains(&id) {
                continue;
            }
            let Some(&translation) = data.positions.get(instance_index) else {
                log::warn!(
                    "[usd-rs] PointInstancer '{}' is missing positions[{instance_index}]",
                    instancer_path
                );
                continue;
            };
            let rotation = data
                .orientations
                .get(instance_index)
                .copied()
                .map(normalize_quaternion)
                .unwrap_or([0.0, 0.0, 0.0, 1.0]);
            let scale = data
                .scales
                .get(instance_index)
                .copied()
                .unwrap_or([1.0, 1.0, 1.0]);
            let transforms = by_prototype.entry(prototype_index).or_default();
            transforms.translations.push(translation);
            transforms.rotations.push(rotation);
            transforms.scales.push(scale);
        }

        for (prototype_index, prototype_path) in data.prototypes.iter().enumerate() {
            let matching_meshes = input_source_paths
                .iter()
                .enumerate()
                .filter_map(|(mesh_index, source_path)| {
                    is_same_or_descendant(source_path.as_str(), prototype_path.as_str())
                        .then_some(mesh_index)
                })
                .collect::<Vec<_>>();
            if matching_meshes.is_empty() {
                log::warn!(
                    "[usd-rs] PointInstancer '{}' prototype '{}' has no renderable Mesh descendant",
                    instancer_path,
                    prototype_path
                );
                continue;
            }

            let transforms = by_prototype.remove(&prototype_index).unwrap_or_default();
            for prototype_mesh_idx in matching_meshes {
                let mesh_world = match compose_world_xform(
                    stage,
                    &input_source_paths[prototype_mesh_idx],
                ) {
                    Ok(matrix) => matrix,
                    Err(error) => {
                        log::warn!(
                            "[usd-rs] failed to compose PointInstancer prototype mesh '{}': {error}",
                            input_source_paths[prototype_mesh_idx]
                        );
                        continue;
                    }
                };
                let prototype_relative =
                    mat4_f64_to_f32(&mat4_mul(&instancer_world_inverse, &mesh_world));
                let matrices = transforms
                    .translations
                    .iter()
                    .zip(&transforms.rotations)
                    .zip(&transforms.scales)
                    .map(|((&translation, &rotation), &scale)| {
                        mat4_mul_f32(
                            &trs_to_mat4_f32(translation, rotation, scale),
                            &prototype_relative,
                        )
                    })
                    .collect::<Vec<_>>();
                let decomposed = matrices
                    .iter()
                    .map(decompose_trs_column_major)
                    .collect::<Vec<_>>();
                resolved.push(InstancingInput {
                    prototype_mesh_idx,
                    parent_node_idx: None,
                    instancer_prim_path: instancer_path.to_string(),
                    translations: decomposed.iter().map(|value| value.0).collect(),
                    rotations: decomposed.iter().map(|value| value.1).collect(),
                    scales: decomposed.iter().map(|value| value.2).collect(),
                    matrices,
                });
            }
        }
    }

    resolved
}

fn is_same_or_descendant(path: &str, ancestor: &str) -> bool {
    path == ancestor
        || path
            .strip_prefix(ancestor)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

fn normalize_quaternion(value: [f32; 4]) -> [f32; 4] {
    if !value.iter().all(|component| component.is_finite()) {
        return [0.0, 0.0, 0.0, 1.0];
    }
    let length_squared = value
        .iter()
        .map(|component| component * component)
        .sum::<f32>();
    if length_squared <= f32::EPSILON {
        return [0.0, 0.0, 0.0, 1.0];
    }
    let inverse_length = length_squared.sqrt().recip();
    value.map(|component| component * inverse_length)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn descendant_matching_respects_path_boundaries() {
        assert!(is_same_or_descendant("/Root/Proto", "/Root/Proto"));
        assert!(is_same_or_descendant("/Root/Proto/Mesh", "/Root/Proto"));
        assert!(!is_same_or_descendant(
            "/Root/PrototypeOther",
            "/Root/Proto"
        ));
    }

    #[test]
    fn quaternion_normalization_falls_back_for_invalid_values() {
        assert_eq!(
            normalize_quaternion([0.0, 0.0, 0.0, 2.0]),
            [0.0, 0.0, 0.0, 1.0]
        );
        assert_eq!(
            normalize_quaternion([f32::NAN, 0.0, 0.0, 1.0]),
            [0.0, 0.0, 0.0, 1.0]
        );
    }
}
