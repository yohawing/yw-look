//! USD inspection module.
//!
//! Splits cleanly into:
//!
//! - [`types`] — wire-level types shared with the frontend.
//! - [`backend`] — the [`backend::UsdBackend`] trait every parser
//!   implementation must satisfy.
//! - [`openusd_backend`] — the concrete implementation used in the app,
//!   a thin adapter over our fork of `mxpv/openusd`.
//! - [`glb`] — Phase 3 GLB serializer that turns extracted USDC mesh data
//!   into a binary glTF blob the frontend's `GLTFLoader` can consume.

pub mod backend;
pub mod glb;
pub mod openusd_backend;
pub mod types;

pub use backend::{UsdBackend, UsdError};
pub use openusd_backend::OpenusdBackend;
pub use types::{AssetIssue, StageInspection, StageLoadPolicy, StageSummary};
