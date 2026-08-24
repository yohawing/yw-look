use std::path::PathBuf;
use std::sync::{atomic::AtomicBool, Arc};

use tauri::State;

use crate::error::AppError;
use crate::shared::normalize_file_path;
use crate::state::FbxImportState;

const MAX_FBX_INPUT_BYTES: u64 = 2 * 1024 * 1024 * 1024;

struct RequestGuard<'a> {
    state: &'a FbxImportState,
    request_id: String,
}

impl Drop for RequestGuard<'_> {
    fn drop(&mut self) {
        self.state.remove(&self.request_id);
    }
}

#[tauri::command]
pub(crate) async fn convert_fbx_to_preview(
    path: String,
    request_id: String,
    state: State<'_, FbxImportState>,
) -> Result<tauri::ipc::Response, AppError> {
    if request_id.trim().is_empty() || request_id.len() > 128 {
        return Err(AppError::Fbx(
            "requestId must contain 1 to 128 characters".into(),
        ));
    }
    let normalized = normalize_file_path(PathBuf::from(path))?;
    if normalized
        .extension()
        .and_then(|v| v.to_str())
        .is_none_or(|v| !v.eq_ignore_ascii_case("fbx"))
    {
        return Err(AppError::Fbx(format!(
            "native FBX preview only accepts .fbx files: {}",
            normalized.display()
        )));
    }
    let size = std::fs::metadata(&normalized)?.len();
    if size > MAX_FBX_INPUT_BYTES {
        return Err(AppError::Fbx(
            "FBX input exceeds the 2 GiB safety limit".into(),
        ));
    }
    let flag = Arc::new(AtomicBool::new(false));
    state.register(request_id.clone(), Arc::clone(&flag))?;
    let _guard = RequestGuard {
        state: &state,
        request_id,
    };
    let result =
        tauri::async_runtime::spawn_blocking(move || crate::fbx::convert(&normalized, flag))
            .await
            .map_err(|error| AppError::Fbx(format!("native FBX worker failed: {error}")))??;
    Ok(tauri::ipc::Response::new(result))
}

#[tauri::command]
pub(crate) fn cancel_fbx_import(request_id: String, state: State<'_, FbxImportState>) -> bool {
    // Keep a bounded tombstone when cancellation wins the scheduling race and
    // arrives before the async command has registered its request.
    state.cancel(request_id)
}
