use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use crate::error::AppError;
use crate::usd::{
    DefaultBackend, StageLoadPolicy, UsdGeometryBackend, UsdInspectBackend, UsdSessionBackend,
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
    #[serde(default)]
    pub(crate) morph_weights: Vec<f64>,
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
    pub(crate) morph_weights: Vec<f64>,
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
pub(crate) struct PendingOpenFiles {
    paths: Mutex<Vec<PathBuf>>,
    cli_args_consumed: AtomicBool,
}

impl PendingOpenFiles {
    pub(crate) fn enqueue(&self, paths: impl IntoIterator<Item = PathBuf>) {
        crate::shared::lock_or_recover(&self.paths, "pending open files").extend(paths);
    }

    pub(crate) fn drain(&self) -> Vec<PathBuf> {
        let mut paths = crate::shared::lock_or_recover(&self.paths, "pending open files");
        std::mem::take(&mut *paths)
    }

    pub(crate) fn take_cli_args_once(&self) -> bool {
        !self.cli_args_consumed.swap(true, Ordering::AcqRel)
    }
}

#[cfg(test)]
mod pending_open_files_tests {
    use super::*;

    #[test]
    fn drain_returns_every_queued_path_once() {
        let state = PendingOpenFiles::default();
        state.enqueue([PathBuf::from("first.glb"), PathBuf::from("second.usda")]);

        assert_eq!(
            state.drain(),
            vec![PathBuf::from("first.glb"), PathBuf::from("second.usda")]
        );
        assert!(state.drain().is_empty());
    }

    #[test]
    fn cli_arguments_are_consumed_once() {
        let state = PendingOpenFiles::default();
        assert!(state.take_cli_args_once());
        assert!(!state.take_cli_args_once());
    }
}

const MAX_FBX_CANCEL_TOMBSTONES: usize = 1024;

enum FbxImportRequest {
    Active(Arc<AtomicBool>),
    CancelledBeforeRegistration,
}

#[derive(Default)]
pub(crate) struct FbxImportState(Mutex<BTreeMap<String, FbxImportRequest>>);

impl FbxImportState {
    pub(crate) fn register(
        &self,
        request_id: String,
        flag: Arc<AtomicBool>,
    ) -> Result<(), AppError> {
        let mut requests = crate::shared::lock_or_recover(&self.0, "FBX import requests");
        match requests.entry(request_id) {
            std::collections::btree_map::Entry::Vacant(entry) => {
                entry.insert(FbxImportRequest::Active(flag));
                Ok(())
            }
            std::collections::btree_map::Entry::Occupied(mut entry) => match entry.get() {
                FbxImportRequest::Active(_) => {
                    Err(AppError::Fbx("requestId is already active".into()))
                }
                FbxImportRequest::CancelledBeforeRegistration => {
                    flag.store(true, Ordering::Relaxed);
                    entry.insert(FbxImportRequest::Active(flag));
                    Ok(())
                }
            },
        }
    }

    pub(crate) fn cancel(&self, request_id: String) -> bool {
        let mut requests = crate::shared::lock_or_recover(&self.0, "FBX import requests");
        if let Some(request) = requests.get(&request_id) {
            if let FbxImportRequest::Active(flag) = request {
                flag.store(true, Ordering::Relaxed);
                return true;
            }
            return true;
        }
        requests.insert(request_id, FbxImportRequest::CancelledBeforeRegistration);
        while requests.len() > MAX_FBX_CANCEL_TOMBSTONES {
            let stale = requests.iter().find_map(|(id, request)| {
                matches!(request, FbxImportRequest::CancelledBeforeRegistration).then(|| id.clone())
            });
            let Some(stale) = stale else { break };
            requests.remove(&stale);
        }
        true
    }

    pub(crate) fn remove(&self, request_id: &str) {
        crate::shared::lock_or_recover(&self.0, "FBX import requests").remove(request_id);
    }
}

#[cfg(test)]
mod fbx_import_state_tests {
    use super::*;

    #[test]
    fn pre_cancel_is_observed_at_registration() {
        let state = FbxImportState::default();
        assert!(state.cancel("pre-cancelled".into()));
        let flag = Arc::new(AtomicBool::new(false));
        state
            .register("pre-cancelled".into(), Arc::clone(&flag))
            .unwrap();
        assert!(flag.load(Ordering::Relaxed));
        state.remove("pre-cancelled");
    }

    #[test]
    fn duplicate_registration_does_not_replace_active_flag() {
        let state = FbxImportState::default();
        let first = Arc::new(AtomicBool::new(false));
        state.register("same".into(), Arc::clone(&first)).unwrap();
        let second = Arc::new(AtomicBool::new(false));
        assert!(state.register("same".into(), second).is_err());
        assert!(state.cancel("same".into()));
        assert!(first.load(Ordering::Relaxed));
        state.remove("same");
    }
}

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackendCapabilities {
    pub(crate) inspect: bool,
    pub(crate) geometry: bool,
    pub(crate) session: bool,
}

pub(crate) struct UsdBackendState {
    inspect: Arc<dyn UsdInspectBackend>,
    geometry: Option<Arc<dyn UsdGeometryBackend>>,
    session: Option<Arc<dyn UsdSessionBackend>>,
}

impl UsdBackendState {
    pub(crate) fn new(backend: DefaultBackend) -> Self {
        let backend = Arc::new(backend);
        Self {
            inspect: backend.clone() as Arc<dyn UsdInspectBackend>,
            geometry: Some(backend.clone() as Arc<dyn UsdGeometryBackend>),
            session: Some(backend.clone() as Arc<dyn UsdSessionBackend>),
        }
    }

    pub(crate) fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            inspect: true,
            geometry: self.geometry.is_some(),
            session: self.session.is_some(),
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

    pub(crate) fn session(&self) -> Result<Arc<dyn UsdSessionBackend>, AppError> {
        self.session
            .as_ref()
            .map(Arc::clone)
            .ok_or_else(|| AppError::Internal("USD backend capability unavailable: session".into()))
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
