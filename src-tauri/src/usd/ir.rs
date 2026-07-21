//! Backend-independent intermediate representation (IR) for extracted
//! USD data.
//!
//! `geometry.rs`, `skel.rs`, and `extract_shared.rs` operate purely on
//! these types so they stay usable by any USD backend. Each backend
//! maps its own native stage-query output into these structs at its
//! own boundary (currently `openusd_backend/`) so the processing layer
//! never depends on a specific USD parser crate. This is what lets the
//! backend move off the fork's `yw_look_compat` surface onto upstream
//! `openusd` APIs (USD-NATIVE-01) without touching the processing
//! layer.

/// A triangulated-input-ready USD Mesh prim's authored attributes,
/// before triangulation / face-varying expansion.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct MeshData {
    pub points: Vec<f32>,
    pub face_vertex_indices: Vec<i32>,
    pub face_vertex_counts: Vec<i32>,
    pub normals: Option<Vec<f32>>,
    pub uvs: Option<Vec<f32>>,
    pub joint_indices: Option<Vec<u32>>,
    pub joint_weights: Option<Vec<f32>>,
    pub joints_per_vertex: usize,
    pub display_color: Option<Vec<f32>>,
}

/// Scalar PBR factors resolved from a bound `UsdPreviewSurface`
/// material.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct MaterialData {
    pub diffuse_color: Option<[f32; 3]>,
    pub metallic: Option<f32>,
    pub roughness: Option<f32>,
    pub opacity: Option<f32>,
    pub emissive_color: Option<[f32; 3]>,
    pub diffuse_texture: Option<String>,
    pub wrap_s: Option<String>,
    pub wrap_t: Option<String>,
}

/// A UsdSkel Skeleton prim's joint hierarchy and bind/rest transforms.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct SkeletonData {
    pub joints: Vec<String>,
    pub bind_transforms: Vec<[f32; 16]>,
    pub rest_transforms: Vec<[f32; 16]>,
    pub parents: Vec<Option<usize>>,
}

/// A UsdSkel SkelAnimation prim's per-joint TRS time samples.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct SkelAnimationData {
    pub times: Vec<f64>,
    pub translations: Vec<Vec<f32>>,
    pub rotations: Vec<Vec<f32>>,
    pub scales: Vec<Vec<f32>>,
    pub joints: Vec<String>,
}
