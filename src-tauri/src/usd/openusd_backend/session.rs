use std::collections::HashSet;
use std::path::Path as StdPath;
use std::sync::Mutex;

use openusd::sdf::Path as SdfPath;
use openusd::usd::{InitialLoadSet, StagePopulationMask};
use openusd::usd::Stage;

use crate::usd::backend::{UsdError, UsdSessionBackend};
use crate::usd::stage_state::{OpenStage, RustStageSession};
use crate::usd::types::{ExtractGeometryOptions, StageLoadPolicy};

use super::extract_geometry_from_open_stage_rs;
use super::lights::detect_light_kind;
use super::mesh_visibility::is_mesh_active_and_visible;
use super::stage_fields::read_token_or_string_field;
use super::{OpenusdBackend, LEGACY_TRAVERSE_PREDICATE};

fn open_masked_load_all(
    path: &StdPath,
    mask_paths: impl IntoIterator<Item = SdfPath>,
) -> Result<Stage, UsdError> {
    let path_str = path
        .to_str()
        .ok_or_else(|| UsdError::Io(format!("non-UTF8 path: {}", path.display())))?;
    Stage::builder()
        .load(InitialLoadSet::LoadAll)
        .mask(StagePopulationMask::new(mask_paths))
        .open(path_str)
        .map_err(|e| UsdError::Parse(e.to_string()))
}

fn is_rust_session_mask_prim(stage: &Stage, prim_path: &SdfPath) -> bool {
    if is_mesh_active_and_visible(stage, prim_path) || detect_light_kind(stage, prim_path).is_some()
    {
        return true;
    }

    matches!(
        read_token_or_string_field(stage, prim_path.clone()).as_deref(),
        Some("Camera" | "PointInstancer")
    )
}

fn open_rust_session_stage_with_loaded_payloads(
    stage_path: &StdPath,
    base_stage: &Stage,
    loaded_payload_paths: &HashSet<String>,
) -> Result<Stage, UsdError> {
    let mut mask_paths = HashSet::<SdfPath>::new();
    base_stage
        .traverse(LEGACY_TRAVERSE_PREDICATE, |prim_path| {
            if is_rust_session_mask_prim(base_stage, prim_path) {
                mask_paths.insert(prim_path.clone());
            }
        })
        .map_err(|e| UsdError::Parse(e.to_string()))?;

    for prim_path in loaded_payload_paths {
        let path = SdfPath::new(prim_path)
            .map_err(|e| UsdError::Parse(format!("invalid payload prim path {prim_path}: {e}")))?;
        mask_paths.insert(path);
    }

    if mask_paths.is_empty() {
        return OpenusdBackend::open(stage_path, StageLoadPolicy::NoPayloads);
    }

    // The Rust openusd crate does not currently expose mutable per-prim load
    // rules. Reopen a LoadAll stage through a population mask instead: base
    // renderable prims keep the no-payload preview visible, while explicit
    // payload roots opt into composition.
    open_masked_load_all(stage_path, mask_paths)
}

impl UsdSessionBackend for OpenusdBackend {
    fn open_stage_session(
        &self,
        path: &StdPath,
        policy: StageLoadPolicy,
    ) -> Result<OpenStage, UsdError> {
        let stage = Self::open(path, policy)?;
        Ok(OpenStage::Rust(Mutex::new(RustStageSession {
            stage,
            loaded_payload_paths: HashSet::new(),
        })))
    }

    fn load_payload(&self, stage: &OpenStage, prim_path: &str) -> Result<(), UsdError> {
        let _ = SdfPath::new(prim_path)
            .map_err(|e| UsdError::Parse(format!("invalid payload prim path {prim_path}: {e}")))?;
        match stage {
            OpenStage::Rust(mutex) => {
                let mut session = mutex
                    .lock()
                    .map_err(|_| UsdError::Parse("stage Mutex was poisoned".to_string()))?;
                session.loaded_payload_paths.insert(prim_path.to_string());
                Ok(())
            }
        }
    }

    fn unload_payload(&self, stage: &OpenStage, prim_path: &str) -> Result<(), UsdError> {
        let _ = SdfPath::new(prim_path)
            .map_err(|e| UsdError::Parse(format!("invalid payload prim path {prim_path}: {e}")))?;
        match stage {
            OpenStage::Rust(mutex) => {
                let mut session = mutex
                    .lock()
                    .map_err(|_| UsdError::Parse("stage Mutex was poisoned".to_string()))?;
                session.loaded_payload_paths.remove(prim_path);
                Ok(())
            }
        }
    }

    fn extract_geometry_from_session(
        &self,
        stage: &OpenStage,
        stage_path: &StdPath,
        options: &ExtractGeometryOptions,
    ) -> Result<Vec<u8>, UsdError> {
        match stage {
            OpenStage::Rust(mutex) => {
                let session = mutex
                    .lock()
                    .map_err(|_| UsdError::Parse("stage Mutex was poisoned".to_string()))?;
                if session.loaded_payload_paths.is_empty() {
                    extract_geometry_from_open_stage_rs(&session.stage, stage_path, options)
                } else {
                    let stage_with_payloads = open_rust_session_stage_with_loaded_payloads(
                        stage_path,
                        &session.stage,
                        &session.loaded_payload_paths,
                    )?;
                    extract_geometry_from_open_stage_rs(&stage_with_payloads, stage_path, options)
                }
            }
        }
    }
}
