//! USD inspection module.
//!
//! Splits cleanly into:
//!
//! - [`types`] — wire-level types shared with the frontend.
//! - [`backend`] — capability traits every parser implementation can
//!   implement independently.
//! - [`openusd_backend`] — the pure-Rust adapter over our fork of
//!   `mxpv/openusd`, selected by the `backend-openusd-rs` feature.
//! - [`glb`] — Phase 3 GLB serializer that turns extracted USDC mesh
//!   data into a binary glTF blob the frontend's `GLTFLoader` can
//!   consume.
//! - [`asset_resolution`] / [`extract_shared`] / [`geometry`] /
//!   [`lights`] / [`material`] / [`math`] / [`node_tree`] /
//!   [`prim_path`] / [`skel`] / [`texture_loader`] — small
//!   backend-independent helpers used by the Rust extraction path.

pub mod asset_resolution;
pub mod backend;
pub mod extract_shared;
pub mod geometry;
pub mod glb;
pub mod lights;
pub mod material;
pub mod math;
pub mod node_tree;
pub mod openusd_backend;
pub mod prim_path;
pub mod skel;
pub mod stage_state;
pub mod texture_loader;
pub mod types;

pub use backend::{
    UsdError, UsdGeometryBackend, UsdInspectBackend, UsdLightBackend, UsdSessionBackend,
    UsdSourceBackend,
};
pub use openusd_backend::OpenusdBackend;
pub use stage_state::{OpenSession, OpenStage, StageRegistry, StageSessionHandle};
pub use types::{
    AssetIssue, AttributeTimeSamples, PrimInspection, StageInspection, StageLoadPolicy,
    StageSummary, UsdLightInfo,
};

// There is no second USD implementation to select or accidentally enable.
pub type DefaultBackend = OpenusdBackend;
