//! Maps the openusd fork's stage-query output onto yw-look's
//! backend-independent [`crate::usd::ir`] types.
//!
//! This is the only place the fork's `MeshData` / `MaterialData` /
//! `SkeletonData` / `SkelAnimationData` structs get converted away
//! from — every field moves across, so the conversion is free.

use crate::usd::ir;

impl From<openusd::stage::MeshData> for ir::MeshData {
    fn from(value: openusd::stage::MeshData) -> Self {
        Self {
            points: value.points,
            face_vertex_indices: value.face_vertex_indices,
            face_vertex_counts: value.face_vertex_counts,
            normals: value.normals,
            uvs: value.uvs,
            joint_indices: value.joint_indices,
            joint_weights: value.joint_weights,
            joints_per_vertex: value.joints_per_vertex,
            display_color: value.display_color,
        }
    }
}

impl From<openusd::stage::MaterialData> for ir::MaterialData {
    fn from(value: openusd::stage::MaterialData) -> Self {
        Self {
            diffuse_color: value.diffuse_color,
            metallic: value.metallic,
            roughness: value.roughness,
            opacity: value.opacity,
            emissive_color: value.emissive_color,
            diffuse_texture: value.diffuse_texture,
            wrap_s: value.wrap_s,
            wrap_t: value.wrap_t,
        }
    }
}

impl From<openusd::stage::SkeletonData> for ir::SkeletonData {
    fn from(value: openusd::stage::SkeletonData) -> Self {
        Self {
            joints: value.joints,
            bind_transforms: value.bind_transforms,
            rest_transforms: value.rest_transforms,
            parents: value.parents,
        }
    }
}

impl From<openusd::stage::SkelAnimationData> for ir::SkelAnimationData {
    fn from(value: openusd::stage::SkelAnimationData) -> Self {
        Self {
            times: value.times,
            translations: value.translations,
            rotations: value.rotations,
            scales: value.scales,
            joints: value.joints,
        }
    }
}
