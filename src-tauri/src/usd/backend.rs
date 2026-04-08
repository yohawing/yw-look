//! USD backend abstraction.
//!
//! `yw-look` keeps the parser implementation behind this trait so the
//! Tauri command layer never depends on a specific USD crate. The active
//! implementation is `OpenusdBackend`, a thin adapter over our fork of
//! `mxpv/openusd` (yohawing/openusd, branch `yw-look-phase1`).

use std::path::Path;

use super::types::{AssetIssue, StageInspection, StageSummary};

/// Errors a USD backend can produce. Kept intentionally narrow so the
/// command layer can map them to user-facing diagnostics consistently.
#[derive(Debug)]
pub enum UsdError {
    /// The file could not be opened or read from disk.
    Io(String),
    /// The backend opened the file but failed to parse it.
    Parse(String),
}

impl std::fmt::Display for UsdError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UsdError::Io(message) => write!(f, "USD backend io error: {message}"),
            UsdError::Parse(message) => write!(f, "USD backend parse error: {message}"),
        }
    }
}

impl std::error::Error for UsdError {}

/// The single contract every USD parser implementation must satisfy.
///
/// Implementations are expected to be cheap to construct and safe to
/// share across threads — Tauri's command runtime may invoke them from
/// a worker pool.
pub trait UsdBackend: Send + Sync {
    /// Heavyweight inspection. May walk references / payloads.
    fn inspect_stage(&self, path: &Path) -> Result<StageInspection, UsdError>;

    /// Lightweight summary intended for the "show something instantly"
    /// UX path. Implementations should avoid touching payloads.
    fn summarize_stage(&self, path: &Path) -> Result<StageSummary, UsdError>;

    /// Asset hygiene checks: broken references, suspicious metadata, etc.
    fn collect_asset_issues(&self, path: &Path) -> Result<Vec<AssetIssue>, UsdError>;
}
