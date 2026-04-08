//! USD inspection module.
//!
//! Splits cleanly into:
//!
//! - [`types`] — wire-level types shared with the frontend.
//! - [`backend`] — the [`backend::UsdBackend`] trait that every parser
//!   implementation must satisfy, plus a [`backend::StubBackend`] used
//!   while the real implementation is being prepared.

pub mod backend;
pub mod openusd_backend;
pub mod types;

pub use backend::{StubBackend, UsdBackend, UsdError};
pub use openusd_backend::OpenusdBackend;
pub use types::{
    AssetIssue, AssetIssueCode, AssetIssueLevel, CompositionArc, StageInspection, StageSummary,
};
