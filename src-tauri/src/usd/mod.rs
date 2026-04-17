//! USD inspection module.
//!
//! Splits cleanly into:
//!
//! - [`types`] — wire-level types shared with the frontend.
//! - [`backend`] — the [`backend::UsdBackend`] trait every parser
//!   implementation must satisfy.
//! - [`openusd_backend`] — the default implementation, a thin adapter
//!   over our fork of `mxpv/openusd`. Active when the Cargo feature
//!   `backend-openusd-rs` is on (enabled by default).
//! - [`openusd_cpp_backend`] — an alternative implementation backed
//!   by Pixar OpenUSD via a handwritten C shim. Active when the
//!   Cargo feature `backend-openusd-cpp` is on (inspector-only PoC;
//!   see `docs/usd-cpp.md`).
//! - [`glb`] — Phase 3 GLB serializer that turns extracted USDC mesh
//!   data into a binary glTF blob the frontend's `GLTFLoader` can
//!   consume.
//! - [`cpp_sys`] — safe Rust wrapper over the C shim. Present only
//!   when the C++ backend is compiled in.

pub mod backend;
pub mod glb;
pub mod openusd_backend;
pub mod types;

#[cfg(feature = "backend-openusd-cpp")]
pub mod cpp_sys;
#[cfg(feature = "backend-openusd-cpp")]
pub mod openusd_cpp_backend;

pub use backend::{UsdBackend, UsdError};
pub use openusd_backend::OpenusdBackend;
pub use types::{AssetIssue, StageInspection, StageLoadPolicy, StageSummary};

#[cfg(feature = "backend-openusd-cpp")]
pub use openusd_cpp_backend::OpenusdCppBackend;

// ---------------------------------------------------------------------------
// Backend selection
// ---------------------------------------------------------------------------
//
// `DefaultBackend` names the backend the Tauri command layer will
// instantiate at app startup. Which concrete type it points at is
// decided at compile time by the Cargo features in `Cargo.toml`.
//
// Resolution rules:
//   - `backend-openusd-cpp` alone   → `OpenusdCppBackend`
//   - `backend-openusd-rs` alone    → `OpenusdBackend`
//   - both                          → `OpenusdBackend` (Rust fork wins
//     because it covers the full PoC + geometry surface; the C++ side
//     is inspector-only for now)
//   - neither                       → compile error (Cargo forbids
//     empty feature sets by convention here: the `default` feature
//     pins the Rust fork on)

#[cfg(all(
    feature = "backend-openusd-cpp",
    not(feature = "backend-openusd-rs"),
))]
pub type DefaultBackend = OpenusdCppBackend;

#[cfg(feature = "backend-openusd-rs")]
pub type DefaultBackend = OpenusdBackend;

#[cfg(not(any(feature = "backend-openusd-rs", feature = "backend-openusd-cpp")))]
compile_error!(
    "At least one of the USD backend features must be enabled: \
     `backend-openusd-rs` (default) or `backend-openusd-cpp`."
);
