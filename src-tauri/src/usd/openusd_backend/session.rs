use std::collections::HashSet;
use std::path::Path as StdPath;
use std::sync::Mutex;

use openusd::sdf::Path as SdfPath;
use openusd::usd::{InitialLoadSet, LoadPolicy, Stage};

use crate::usd::backend::{UsdError, UsdSessionBackend};
use crate::usd::stage_state::{OpenStage, RustStageSession};
use crate::usd::types::{ExtractGeometryOptions, StageLoadPolicy};

use super::extract_geometry_from_open_stage_rs;
use super::variants::apply_variant_selections;
use super::OpenusdBackend;

fn open_rust_session_stage_with_loaded_payloads(
    stage_path: &StdPath,
    base_stage: &Stage,
    loaded_payload_paths: &HashSet<String>,
    variant_selections: &[crate::usd::types::VariantSelection],
) -> Result<Stage, UsdError> {
    // Stage clones share Rc-backed composition, so the persistent session
    // stage must never receive either variant or load-rule edits. Reopen with
    // the session's original policy, load only the explicit payload roots with
    // upstream's native load rules, then apply the requested variant state.
    // Loading first is required when a requested variant set is authored under
    // a payload root: the inner prim is not composed while the stage is in its
    // initial NoPayloads state. This avoids the old population-mask workaround,
    // which could include every renderable payload encountered while
    // rebuilding the mask.
    let stage = OpenusdBackend::open(stage_path, session_stage_policy(base_stage))?;
    for prim_path in loaded_payload_paths {
        let path = SdfPath::new(prim_path)
            .map_err(|e| UsdError::Parse(format!("invalid payload prim path {prim_path}: {e}")))?;
        stage
            .load(path, LoadPolicy::WithDescendants)
            .map_err(|e| UsdError::Parse(format!("failed to load payload {prim_path}: {e}")))?;
    }
    if !variant_selections.is_empty() {
        apply_variant_selections(&stage, variant_selections)?;
    }
    Ok(stage)
}

fn session_stage_policy(stage: &Stage) -> StageLoadPolicy {
    match stage.initial_load_set() {
        InitialLoadSet::LoadAll => StageLoadPolicy::LoadAll,
        InitialLoadSet::LoadNone => StageLoadPolicy::NoPayloads,
    }
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
                if session.loaded_payload_paths.is_empty() && options.variant_selections.is_empty()
                {
                    extract_geometry_from_open_stage_rs(&session.stage, stage_path, options)
                } else {
                    let stage_with_payloads = if session.loaded_payload_paths.is_empty() {
                        let stage =
                            OpenusdBackend::open(stage_path, session_stage_policy(&session.stage))?;
                        apply_variant_selections(&stage, &options.variant_selections)?;
                        stage
                    } else {
                        open_rust_session_stage_with_loaded_payloads(
                            stage_path,
                            &session.stage,
                            &session.loaded_payload_paths,
                            &options.variant_selections,
                        )?
                    };
                    extract_geometry_from_open_stage_rs(&stage_with_payloads, stage_path, options)
                }
            }
        }
    }
}
