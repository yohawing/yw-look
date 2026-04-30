//! USD inspection module.
//!
//! Splits cleanly into:
//!
//! - [`types`] — wire-level types shared with the frontend.
//! - [`backend`] — the [`backend::UsdBackend`] trait every parser
//!   implementation must satisfy.
//! - [`openusd_backend`] — the pure-Rust adapter over our fork of
//!   `mxpv/openusd`. Now opt-in via `backend-openusd-rs`; kept for
//!   parity testing and for Linux targets where the C++ backend is
//!   gated off (Phase 2.J).
//! - [`openusd_cpp_backend`] — the default implementation (Phase 2.J
//!   onward), backed by Pixar OpenUSD via a handwritten C shim.
//!   Active when the Cargo feature `backend-openusd-cpp` is on
//!   (enabled by default on Windows / macOS; see `docs/usd-cpp.md`).
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
pub use types::{AssetIssue, PrimInspection, StageInspection, StageLoadPolicy, StageSummary};

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
// Resolution rules (C++ wins whenever it is compiled in):
//   - `backend-openusd-cpp` alone            → `OpenusdCppBackend`
//   - `backend-openusd-cpp` + `-rs` together → `OpenusdCppBackend`
//   - `backend-openusd-rs` alone             → `OpenusdBackend`
//   - neither                                → compile error (at least
//     one backend must be enabled; the `default` feature pins the
//     Rust fork on for unopinionated invocations)
//
// Why the C++ backend wins when both features are on:
//
//   `cargo build --features backend-openusd-cpp` additively merges
//   with the `default = ["backend-openusd-rs"]` feature set, so
//   without `--no-default-features` a builder who just asked for the
//   C++ flavor would otherwise pay the 30-60 minute vcpkg + OpenUSD
//   source build and still end up running the Rust fork at runtime —
//   a silent downgrade with no indication that the opt-in request
//   was ignored. Making the C++ selection take precedence matches
//   user intent: compiling the cpp backend in means the caller wants
//   to use it.
//
//   Integration tests under `src-tauri/tests/` that compare the two
//   backends instantiate `OpenusdBackend::new()` and
//   `OpenusdCppBackend::new()` directly (not through `DefaultBackend`),
//   so this precedence change does not affect parity coverage.

#[cfg(feature = "backend-openusd-cpp")]
pub type DefaultBackend = OpenusdCppBackend;

#[cfg(all(
    feature = "backend-openusd-rs",
    not(feature = "backend-openusd-cpp"),
))]
pub type DefaultBackend = OpenusdBackend;

#[cfg(not(any(feature = "backend-openusd-rs", feature = "backend-openusd-cpp")))]
compile_error!(
    "At least one of the USD backend features must be enabled: \
     `backend-openusd-rs` or `backend-openusd-cpp` (default)."
);

// Phase 2.J: the C++ backend depends on a vcpkg-provided OpenUSD +
// LLVM toolchain that yw-look has not yet set up on Linux. Hard-fail
// at compile time so Linux builders receive a clear message instead
// of a hundred lines of cmake / bindgen errors. Drop back to the
// Rust fork with:
//   cargo build --no-default-features --features backend-openusd-rs
#[cfg(all(feature = "backend-openusd-cpp", target_os = "linux"))]
compile_error!(
    "`backend-openusd-cpp` is not supported on Linux. \
     Build with `--no-default-features --features backend-openusd-rs` \
     or switch to a Windows / macOS host."
);
