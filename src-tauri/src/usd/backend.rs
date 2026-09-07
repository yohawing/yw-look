//! USD backend abstraction.
//!
//! `yw-look` keeps the parser implementation behind this trait so the
//! Tauri command layer never depends on a specific USD crate. The active
//! implementation is `OpenusdBackend`, a thin adapter over our fork of
//! `mxpv/openusd` (yohawing/openusd, currently on branch
//! `yw-look-phase4`).

use std::path::Path;

use super::stage_state::OpenStage;
use super::types::{
    AssetIssue, AttributeTimeSamples, ExtractGeometryOptions, PrimInspection, StageInspection,
    StageLoadPolicy, StageSummary, UsdLightInfo, VariantSelection,
};

/// Errors a USD backend can produce. Kept intentionally narrow so the
/// command layer can map them to user-facing diagnostics consistently.
#[derive(Debug)]
pub enum UsdError {
    /// The file could not be opened or read from disk.
    Io(String),
    /// The backend opened the file but failed to parse it.
    Parse(String),
    /// The backend could not apply or validate a requested variant selection.
    InvalidVariantSelection {
        prim_path: String,
        set_name: String,
        variant_name: String,
    },
}

impl std::fmt::Display for UsdError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UsdError::Io(message) => write!(f, "USD backend io error: {message}"),
            UsdError::Parse(message) => write!(f, "USD backend parse error: {message}"),
            UsdError::InvalidVariantSelection {
                prim_path,
                set_name,
                variant_name,
            } => write!(
                f,
                "USD_INVALID_VARIANT_SELECTION\tprimPath={prim_path}\t\
                 setName={set_name}\tvariantName={variant_name}"
            ),
        }
    }
}

impl std::error::Error for UsdError {}

/// Stage and prim inspection capability.
///
/// Implementations are expected to be cheap to construct and safe to
/// share across threads — Tauri's command runtime may invoke them from
/// a worker pool.
pub trait UsdInspectBackend: Send + Sync {
    /// Heavyweight inspection. Walks references / payloads according to
    /// `policy`. `StageLoadPolicy::NoPayloads` causes payload arcs to
    /// be surfaced as `CompositionArcState::Unloaded` instead of being
    /// composed.
    fn inspect_stage(
        &self,
        path: &Path,
        policy: StageLoadPolicy,
    ) -> Result<StageInspection, UsdError>;

    /// Variant-aware inspection entry point. Empty selections retain the
    /// legacy authored-selection behavior; unsupported non-empty selections
    /// return an explicit error so callers cannot mistake stale data for a
    /// variant-aware result.
    fn inspect_stage_with_variants(
        &self,
        path: &Path,
        policy: StageLoadPolicy,
        variant_selections: &[VariantSelection],
    ) -> Result<StageInspection, UsdError> {
        if variant_selections.is_empty() {
            return self.inspect_stage(path, policy);
        }
        Err(UsdError::Parse(
            "variant selections are not supported by this backend".into(),
        ))
    }

    /// Lightweight summary intended for the "show something instantly"
    /// UX path. Under `StageLoadPolicy::NoPayloads` the `mesh_count`
    /// reflects only composed payload-free geometry and
    /// `unloaded_payload_count` reports how many payload arcs were
    /// skipped.
    fn summarize_stage(
        &self,
        path: &Path,
        policy: StageLoadPolicy,
    ) -> Result<StageSummary, UsdError>;

    /// Variant-aware summary entry point. Empty selections retain the legacy
    /// authored-selection behavior; unsupported non-empty selections return
    /// an explicit error so callers cannot mistake stale data for a
    /// variant-aware result.
    fn summarize_stage_with_variants(
        &self,
        path: &Path,
        policy: StageLoadPolicy,
        variant_selections: &[VariantSelection],
    ) -> Result<StageSummary, UsdError> {
        if variant_selections.is_empty() {
            return self.summarize_stage(path, policy);
        }
        Err(UsdError::Parse(
            "variant selections are not supported by this backend".into(),
        ))
    }

    /// Asset hygiene checks: broken references, suspicious metadata, etc.
    /// Always runs under the default `LoadAll` policy — issue collection
    /// wants to see every arc regardless of deferred-load UI state.
    fn collect_asset_issues(&self, path: &Path) -> Result<Vec<AssetIssue>, UsdError>;

    /// Variant-aware asset issue entry point. Empty selections retain the
    /// legacy authored-selection behavior; unsupported non-empty selections
    /// return an explicit error so callers cannot mistake stale data for a
    /// variant-aware result.
    fn collect_asset_issues_with_variants(
        &self,
        path: &Path,
        variant_selections: &[VariantSelection],
    ) -> Result<Vec<AssetIssue>, UsdError> {
        if variant_selections.is_empty() {
            return self.collect_asset_issues(path);
        }
        Err(UsdError::Parse(
            "variant selections are not supported by this backend".into(),
        ))
    }

    /// Phase 3: returns `true` if the root layer of the stage is the binary
    /// USDC crate format, `false` if it's USDA text. Kept as a primitive
    /// for tests and diagnostics — the frontend should consult
    /// `requires_glb_preview` instead, which also accounts for
    /// composition arcs.
    #[allow(dead_code)] // diagnostic-only, exercised by `#[cfg(test)]` paths
    fn root_layer_is_binary(&self, path: &Path) -> Result<bool, UsdError>;

    /// Phase 3: decides whether the frontend should route this file through
    /// the Rust GLB extraction pipeline instead of Three.js `USDLoader.parse`.
    ///
    /// Returns `true` when either is true:
    ///   - the root layer is binary USDC, or
    ///   - the composed stage has more than one layer (sublayers,
    ///     references, payloads).
    ///
    /// `USDLoader.parse` only sees the single text buffer yw-look hands
    /// it — it has no hook to follow external asset paths — so any file
    /// that depends on another layer will render empty through the JS
    /// path even if every file in the chain is USDA. The GLB pipeline,
    /// on the other hand, uses the fully-composed openusd `Stage`, so it
    /// transparently handles references and (loaded-mode) payloads.
    fn requires_glb_preview(&self, path: &Path) -> Result<bool, UsdError>;

    /// #28: per-prim attribute / relationship / metadata inspector.
    /// Returns a [`PrimInspection`] containing all authored attributes,
    /// relationships, and metadata on the prim at `prim_path`.
    ///
    /// `path` is the USD file; `prim_path` is a SdfPath string
    /// (e.g. `"/World/Hero/Body"`).
    ///
    /// Backends that do not yet implement this should return
    /// `Err(UsdError::Parse("not supported on this backend".into()))`.
    fn inspect_prim(&self, path: &Path, prim_path: &str) -> Result<PrimInspection, UsdError>;

    /// #37: enumerates up to `max_samples` time samples on the named
    /// attribute and computes optional numeric statistics. `path` is the
    /// USD file; `prim_path` and `attr_name` identify the attribute.
    /// `max_samples` caps the number of returned samples (statistics are
    /// computed only over the returned subset). Backends that do not yet
    /// implement this should return
    /// `Err(UsdError::Parse("not supported on this backend".into()))`.
    fn inspect_attribute_time_samples(
        &self,
        path: &Path,
        prim_path: &str,
        attr_name: &str,
        max_samples: usize,
    ) -> Result<AttributeTimeSamples, UsdError>;
}

/// Mesh extraction / GLB generation capability.
pub trait UsdGeometryBackend: Send + Sync {
    /// Phase 3: extracts all Mesh prims from the stage and serializes them
    /// to a self-contained GLB binary, returned as raw bytes. The frontend
    /// receives this via `tauri::ipc::Response` and feeds it to
    /// `GLTFLoader.parseAsync`. `policy` is forwarded to the backend so
    /// `NoPayloads` builds a GLB containing only payload-free meshes.
    fn extract_geometry_glb(
        &self,
        path: &Path,
        policy: StageLoadPolicy,
    ) -> Result<Vec<u8>, UsdError>;

    /// Round 1.5 (#32 / #31 plumbing): options-aware variant of
    /// `extract_geometry_glb`. Default delegates to the policy-only method,
    /// ignoring `variant_selections` and `purpose_modes`. Backends that
    /// support those features override this method to consume the options.
    /// Frontend / Tauri command callers should prefer this method so variant
    /// / purpose changes take effect on backends that implement them.
    fn extract_geometry_glb_with_options(
        &self,
        path: &Path,
        options: &ExtractGeometryOptions,
    ) -> Result<Vec<u8>, UsdError> {
        self.extract_geometry_glb(path, options.policy)
    }
}

/// USD light detail inspection capability.
pub trait UsdLightBackend: Send + Sync {
    /// #35 — enumerates all UsdLux light prims in the stage and returns
    /// their detailed attributes (intensity, color, exposure, color
    /// temperature, specular/diffuse multipliers, shaping cone, dome texture).
    ///
    /// The Rust backend returns `Err(UsdError::Parse("not supported"))`
    /// because the openusd crate does not yet expose UsdLux APIs. Callers
    /// should treat an error from this method as "no USD light detail
    /// available" and fall back to the Three.js-derived `LightEntry` list.
    fn inspect_usd_lights(&self, path: &Path) -> Result<Vec<UsdLightInfo>, UsdError>;

    /// Variant-aware light inspection entry point. Empty selections retain
    /// the legacy authored-selection behavior; unsupported non-empty
    /// selections return an explicit error so callers cannot mistake stale
    /// data for a variant-aware result.
    fn inspect_usd_lights_with_variants(
        &self,
        path: &Path,
        variant_selections: &[VariantSelection],
    ) -> Result<Vec<UsdLightInfo>, UsdError> {
        if variant_selections.is_empty() {
            return self.inspect_usd_lights(path);
        }
        Err(UsdError::Parse(
            "variant selections are not supported by this backend".into(),
        ))
    }
}

/// Stateful stage session / per-prim payload capability.
pub trait UsdSessionBackend: Send + Sync {
    /// Opens `path` under `policy` and returns a backend-specific stage
    /// handle that the caller stores in `StageRegistry`. Unlike
    /// `extract_geometry_glb`, this does NOT keep the stage alive only for
    /// the duration of the call — the `OpenStage` is meant to persist until
    /// `close_stage_session` / the registry drops it.
    ///
    /// The Rust backend returns `OpenStage::Rust(...)`.
    fn open_stage_session(
        &self,
        path: &Path,
        policy: StageLoadPolicy,
    ) -> Result<OpenStage, UsdError>;

    /// Loads the payload arc(s) rooted at `prim_path` on an open stage.
    ///
    /// The Rust backend tracks requested payload roots and reopens a masked
    /// LoadAll stage for extraction because the crate does not expose mutable
    /// per-prim load rules.
    fn load_payload(&self, stage: &OpenStage, prim_path: &str) -> Result<(), UsdError>;

    /// Unloads the payload arc(s) rooted at `prim_path` on an open stage.
    ///
    /// Same backend caveat as [`Self::load_payload`].
    fn unload_payload(&self, stage: &OpenStage, prim_path: &str) -> Result<(), UsdError>;

    /// Runs the GLB extraction pipeline on an already-open stage (i.e. the
    /// same `extract_geometry_from_open_stage` helper, but reached through the
    /// registry rather than reopening the file).
    ///
    /// `stage_path` is the original USD file path the session was opened
    /// from — required by the texture loader so USDZ archives and relative
    /// asset references resolve correctly.
    fn extract_geometry_from_session(
        &self,
        stage: &OpenStage,
        stage_path: &Path,
        options: &ExtractGeometryOptions,
    ) -> Result<Vec<u8>, UsdError>;
}

#[cfg(test)]
mod tests {
    use super::UsdError;

    #[test]
    fn invalid_variant_selection_display_is_stable_for_frontend_parsing() {
        let message = UsdError::InvalidVariantSelection {
            prim_path: "/World/Hero".to_string(),
            set_name: "look".to_string(),
            variant_name: "Damaged".to_string(),
        }
        .to_string();

        assert_eq!(
            message,
            "USD_INVALID_VARIANT_SELECTION\tprimPath=/World/Hero\t\
             setName=look\tvariantName=Damaged"
        );
    }
}
