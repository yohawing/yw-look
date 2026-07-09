use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::error::AppError;
use crate::usd::{
    DefaultBackend, StageLoadPolicy, UsdGeometryBackend, UsdInspectBackend, UsdLightBackend,
    UsdSessionBackend, UsdSourceBackend,
};

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct AppSettings {
    pub(crate) version: u32,
    pub(crate) recent_files_limit: usize,
    pub(crate) diagnostics_log_level: String,
    pub(crate) file_associations_enabled: bool,
    pub(crate) optional_loader_packs: BTreeMap<String, OptionalLoaderPackSettings>,
    pub(crate) update_endpoint_override: Option<String>,
    pub(crate) update_public_key_override: Option<String>,
    pub(crate) allow_insecure_update_endpoint: bool,
    #[allow(dead_code)]
    pub(crate) auto_check_for_updates: bool,
}

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct OptionalLoaderPackSettings {
    pub(crate) enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShotBatchCaseArgument {
    pub(crate) input_path: PathBuf,
    pub(crate) output_path: PathBuf,
    pub(crate) motion_path: Option<PathBuf>,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) background: Option<String>,
    pub(crate) usd_load_policy: Option<StageLoadPolicy>,
}

#[derive(Debug, Clone)]
pub(crate) struct BenchCliConfig {
    pub(crate) models_path: PathBuf,
    pub(crate) repo_root: PathBuf,
    pub(crate) out_dir: PathBuf,
    pub(crate) case_ids: Vec<String>,
    pub(crate) visible: bool,
    pub(crate) node_version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ShotMode {
    Shot,
    Check,
}

#[derive(Debug, Clone)]
pub(crate) struct ShotCliCase {
    pub(crate) mode: ShotMode,
    pub(crate) input_path: PathBuf,
    pub(crate) output_path: Option<PathBuf>,
    pub(crate) motion_path: Option<PathBuf>,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) background: Option<String>,
    pub(crate) usd_load_policy: StageLoadPolicy,
}

#[derive(Debug, Clone)]
pub(crate) struct ShotCliConfig {
    pub(crate) cases: Vec<ShotCliCase>,
}

#[derive(Debug, Clone)]
pub(crate) struct StartupBenchCliConfig {
    pub(crate) out_dir: PathBuf,
    pub(crate) node_version: Option<String>,
}

#[derive(Default)]
pub(crate) struct PendingUpdateState(pub(crate) Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(Default)]
pub(crate) struct PendingOpenFiles(pub(crate) Mutex<Vec<PathBuf>>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackendCapabilities {
    pub(crate) inspect: bool,
    pub(crate) geometry: bool,
    pub(crate) source: bool,
    pub(crate) session: bool,
    pub(crate) light: bool,
}

pub(crate) struct UsdBackendState {
    inspect: Arc<dyn UsdInspectBackend>,
    geometry: Option<Arc<dyn UsdGeometryBackend>>,
    source: Option<Arc<dyn UsdSourceBackend>>,
    session: Option<Arc<dyn UsdSessionBackend>>,
    light: Option<Arc<dyn UsdLightBackend>>,
}

impl UsdBackendState {
    #[cfg(feature = "backend-openusd-cpp")]
    pub(crate) fn new(backend: DefaultBackend) -> Self {
        let backend = Arc::new(backend);
        Self {
            inspect: backend.clone() as Arc<dyn UsdInspectBackend>,
            geometry: Some(backend.clone() as Arc<dyn UsdGeometryBackend>),
            source: Some(backend.clone() as Arc<dyn UsdSourceBackend>),
            session: Some(backend.clone() as Arc<dyn UsdSessionBackend>),
            light: Some(backend as Arc<dyn UsdLightBackend>),
        }
    }

    #[cfg(all(feature = "backend-openusd-rs", not(feature = "backend-openusd-cpp")))]
    pub(crate) fn new(backend: DefaultBackend) -> Self {
        let backend = Arc::new(backend);
        Self {
            inspect: backend.clone() as Arc<dyn UsdInspectBackend>,
            geometry: Some(backend.clone() as Arc<dyn UsdGeometryBackend>),
            source: None,
            session: Some(backend.clone() as Arc<dyn UsdSessionBackend>),
            light: None,
        }
    }

    pub(crate) fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            inspect: true,
            geometry: self.geometry.is_some(),
            source: self.source.is_some(),
            session: self.session.is_some(),
            light: self.light.is_some(),
        }
    }

    pub(crate) fn inspect(&self) -> Arc<dyn UsdInspectBackend> {
        Arc::clone(&self.inspect)
    }

    pub(crate) fn geometry(&self) -> Result<Arc<dyn UsdGeometryBackend>, AppError> {
        self.geometry.as_ref().map(Arc::clone).ok_or_else(|| {
            AppError::Internal("USD backend capability unavailable: geometry".into())
        })
    }

    pub(crate) fn source(&self) -> Result<Arc<dyn UsdSourceBackend>, AppError> {
        self.source
            .as_ref()
            .map(Arc::clone)
            .ok_or_else(|| AppError::Internal("USD backend capability unavailable: source".into()))
    }

    pub(crate) fn session(&self) -> Result<Arc<dyn UsdSessionBackend>, AppError> {
        self.session
            .as_ref()
            .map(Arc::clone)
            .ok_or_else(|| AppError::Internal("USD backend capability unavailable: session".into()))
    }

    pub(crate) fn light(&self) -> Result<Arc<dyn UsdLightBackend>, AppError> {
        self.light
            .as_ref()
            .map(Arc::clone)
            .ok_or_else(|| AppError::Internal("USD backend capability unavailable: light".into()))
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            version: 5,
            recent_files_limit: 20,
            diagnostics_log_level: "info".to_string(),
            file_associations_enabled: false,
            optional_loader_packs: BTreeMap::new(),
            update_endpoint_override: None,
            update_public_key_override: None,
            allow_insecure_update_endpoint: false,
            auto_check_for_updates: false,
        }
    }
}

impl Default for OptionalLoaderPackSettings {
    fn default() -> Self {
        Self { enabled: true }
    }
}
