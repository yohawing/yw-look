use std::io::Read as _;
use std::path::PathBuf;
use std::sync::{MutexGuard, TryLockError};

use crate::error::AppError;
use crate::shared::{normalize_file_path, USD_TASK_LOCK};
use crate::state::UsdBackendState;
use crate::usd::{
    types::{ExtractGeometryOptions, VariantSelection},
    AssetIssue, AttributeTimeSamples, PrimInspection, StageInspection, StageLoadPolicy,
    StageRegistry, StageSessionHandle, StageSummary, UsdError, UsdLightInfo,
};

const USD_TASK_BUSY: &str = "USD_TASK_BUSY";
const USD_FAST_DECISION_SCAN_BYTES: usize = 64 * 1024;
const USDC_MAGIC: &[u8] = b"PXR-USDC";
const USD_XFORM_TIME_SAMPLES_MARKER: &[u8] = b".timeSamples";
const USD_GLTF_BACKEND_KEYWORDS: [&[u8]; 4] =
    [b"subLayers", b"references", b"payload", b"PointInstancer"];

fn map_usd_error(error: UsdError) -> AppError {
    AppError::Usd(error.to_string())
}

fn recover_poisoned_usd_lock(
    guard: std::sync::PoisonError<MutexGuard<'static, ()>>,
) -> MutexGuard<'static, ()> {
    log::warn!("[usd] USD task lock was poisoned; continuing with recovered lock");
    guard.into_inner()
}

fn lock_usd_task(background: bool) -> Result<MutexGuard<'static, ()>, AppError> {
    if background {
        return match USD_TASK_LOCK.try_lock() {
            Ok(guard) => Ok(guard),
            Err(TryLockError::WouldBlock) => Err(AppError::Internal(USD_TASK_BUSY.into())),
            Err(TryLockError::Poisoned(guard)) => Ok(recover_poisoned_usd_lock(guard)),
        };
    }

    match USD_TASK_LOCK.lock() {
        Ok(guard) => Ok(guard),
        Err(guard) => Ok(recover_poisoned_usd_lock(guard)),
    }
}

async fn run_blocking_usd<T, F>(task: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, UsdError> + Send + 'static,
    T: Send + 'static,
{
    run_usd_task(false, task).await
}

async fn run_background_usd<T, F>(task: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, UsdError> + Send + 'static,
    T: Send + 'static,
{
    run_usd_task(true, task).await
}

async fn run_maybe_background_usd<T, F>(background: Option<bool>, task: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, UsdError> + Send + 'static,
    T: Send + 'static,
{
    if background.unwrap_or(false) {
        run_background_usd(task).await
    } else {
        run_blocking_usd(task).await
    }
}

async fn run_usd_task<T, F>(background: bool, task: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, UsdError> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_usd_task(background)?;
        task().map_err(map_usd_error)
    })
    .await
    .map_err(|e| AppError::Internal(format!("USD task join error: {e}")))?
}

fn fast_usd_requires_glb_preview(path: &std::path::Path) -> Option<bool> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    if matches!(extension.as_str(), "usd" | "usdc") {
        return Some(true);
    }
    if extension != "usda" {
        return None;
    }

    let mut file = std::fs::File::open(path).ok()?;
    let mut bytes = Vec::with_capacity(USD_FAST_DECISION_SCAN_BYTES);
    std::io::Read::by_ref(&mut file)
        .take(USD_FAST_DECISION_SCAN_BYTES as u64)
        .read_to_end(&mut bytes)
        .ok()?;

    if bytes.starts_with(USDC_MAGIC) {
        return Some(true);
    }
    if USD_GLTF_BACKEND_KEYWORDS.iter().any(|keyword| {
        bytes
            .windows(keyword.len())
            .any(|window| window == *keyword)
    }) {
        return Some(true);
    }
    if bytes
        .windows(USD_XFORM_TIME_SAMPLES_MARKER.len())
        .any(|window| window == USD_XFORM_TIME_SAMPLES_MARKER)
    {
        // Let the OpenUSD backend confirm that the sampled property is an
        // authored Xform animation before choosing the GLB route.
        return None;
    }
    if bytes.len() < USD_FAST_DECISION_SCAN_BYTES {
        return Some(false);
    }
    None
}

#[tauri::command]
pub(crate) async fn backend_capabilities(
    backend: tauri::State<'_, UsdBackendState>,
) -> Result<crate::state::BackendCapabilities, AppError> {
    Ok(backend.capabilities())
}

#[tauri::command]
pub(crate) async fn inspect_stage(
    backend: tauri::State<'_, UsdBackendState>,
    path: String,
    policy: Option<StageLoadPolicy>,
    background: Option<bool>,
    variant_selections: Option<Vec<VariantSelection>>,
) -> Result<StageInspection, AppError> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let handle = backend.inspect();
    let policy = policy.unwrap_or_default();
    let variant_selections = variant_selections.unwrap_or_default();
    run_maybe_background_usd(background, move || {
        handle.inspect_stage_with_variants(&normalized, policy, &variant_selections)
    })
    .await
}

#[tauri::command]
pub(crate) async fn inspect_attribute_time_samples(
    backend: tauri::State<'_, UsdBackendState>,
    path: String,
    prim_path: String,
    attr_name: String,
    max_samples: Option<usize>,
) -> Result<AttributeTimeSamples, AppError> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let cap = max_samples.unwrap_or(100);
    let handle = backend.inspect();
    run_blocking_usd(move || {
        handle.inspect_attribute_time_samples(&normalized, &prim_path, &attr_name, cap)
    })
    .await
}

#[tauri::command]
pub(crate) async fn inspect_prim(
    backend: tauri::State<'_, UsdBackendState>,
    path: String,
    prim_path: String,
) -> Result<PrimInspection, AppError> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let handle = backend.inspect();
    run_blocking_usd(move || handle.inspect_prim(&normalized, &prim_path)).await
}

#[tauri::command]
pub(crate) async fn inspect_usd_lights(
    backend: tauri::State<'_, UsdBackendState>,
    path: String,
    background: Option<bool>,
    variant_selections: Option<Vec<VariantSelection>>,
) -> Result<Vec<UsdLightInfo>, AppError> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let handle = backend.light()?;
    let variant_selections = variant_selections.unwrap_or_default();
    run_maybe_background_usd(background, move || {
        handle.inspect_usd_lights_with_variants(&normalized, &variant_selections)
    })
    .await
}

#[tauri::command]
pub(crate) async fn summarize_stage(
    backend: tauri::State<'_, UsdBackendState>,
    path: String,
    policy: Option<StageLoadPolicy>,
    background: Option<bool>,
    variant_selections: Option<Vec<VariantSelection>>,
) -> Result<StageSummary, AppError> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let handle = backend.inspect();
    let policy = policy.unwrap_or_default();
    let variant_selections = variant_selections.unwrap_or_default();
    run_maybe_background_usd(background, move || {
        handle.summarize_stage_with_variants(&normalized, policy, &variant_selections)
    })
    .await
}

#[tauri::command]
pub(crate) async fn collect_asset_issues(
    backend: tauri::State<'_, UsdBackendState>,
    path: String,
    background: Option<bool>,
    variant_selections: Option<Vec<VariantSelection>>,
) -> Result<Vec<AssetIssue>, AppError> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let handle = backend.inspect();
    let variant_selections = variant_selections.unwrap_or_default();
    run_maybe_background_usd(background, move || {
        handle.collect_asset_issues_with_variants(&normalized, &variant_selections)
    })
    .await
}

#[tauri::command]
pub(crate) async fn requires_glb_preview(
    backend: tauri::State<'_, UsdBackendState>,
    path: String,
) -> Result<bool, AppError> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    if let Some(decision) = fast_usd_requires_glb_preview(&normalized) {
        return Ok(decision);
    }
    let handle = backend.inspect();
    run_blocking_usd(move || handle.requires_glb_preview(&normalized)).await
}

#[tauri::command]
pub(crate) async fn extract_geometry(
    backend: tauri::State<'_, UsdBackendState>,
    path: String,
    policy: Option<StageLoadPolicy>,
    options: Option<ExtractGeometryOptions>,
    background: Option<bool>,
) -> Result<tauri::ipc::Response, AppError> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let handle = backend.geometry()?;
    let resolved_options =
        options.unwrap_or_else(|| ExtractGeometryOptions::from(policy.unwrap_or_default()));
    let bytes = run_maybe_background_usd(background, move || {
        handle.extract_geometry_glb_with_options(&normalized, &resolved_options)
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub(crate) async fn flatten_stage(
    backend: tauri::State<'_, UsdBackendState>,
    path: String,
) -> Result<String, AppError> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let handle = backend.source()?;
    run_blocking_usd(move || handle.flatten_stage(&normalized)).await
}

#[tauri::command]
pub(crate) async fn open_stage_session(
    backend: tauri::State<'_, UsdBackendState>,
    registry: tauri::State<'_, StageRegistry>,
    path: String,
    policy: Option<StageLoadPolicy>,
    background: Option<bool>,
) -> Result<StageSessionHandle, AppError> {
    let normalized = normalize_file_path(PathBuf::from(path.clone()))?;
    let handle = backend.session()?;
    let policy = policy.unwrap_or_default();
    let open_stage = run_maybe_background_usd(background, move || {
        handle.open_stage_session(&normalized, policy)
    })
    .await?;

    let session = crate::usd::OpenSession {
        path: PathBuf::from(path),
        policy,
        stage: open_stage,
    };
    let sh = registry.insert(session);
    Ok(sh)
}

#[tauri::command]
pub(crate) async fn close_stage_session(
    registry: tauri::State<'_, StageRegistry>,
    handle: StageSessionHandle,
) -> Result<(), AppError> {
    registry.remove(handle).ok_or_else(|| {
        AppError::Internal(format!("close_stage_session: unknown handle {}", handle.0))
    })?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn load_payload(
    app: tauri::AppHandle,
    backend: tauri::State<'_, UsdBackendState>,
    handle: StageSessionHandle,
    prim_path: String,
) -> Result<(), AppError> {
    use tauri::Manager;
    let backend_handle = backend.session()?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), AppError> {
        let _guard = lock_usd_task(false)?;
        let registry = app.state::<StageRegistry>();
        let session = registry.get(handle).ok_or_else(|| {
            AppError::Internal(format!("load_payload: unknown session handle {}", handle.0))
        })?;
        backend_handle
            .load_payload(&session.stage, &prim_path)
            .map_err(map_usd_error)
    })
    .await
    .map_err(|e| AppError::Internal(format!("USD task join error: {e}")))?
}

#[tauri::command]
pub(crate) async fn unload_payload(
    app: tauri::AppHandle,
    backend: tauri::State<'_, UsdBackendState>,
    handle: StageSessionHandle,
    prim_path: String,
) -> Result<(), AppError> {
    use tauri::Manager;
    let backend_handle = backend.session()?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), AppError> {
        let _guard = lock_usd_task(false)?;
        let registry = app.state::<StageRegistry>();
        let session = registry.get(handle).ok_or_else(|| {
            AppError::Internal(format!(
                "unload_payload: unknown session handle {}",
                handle.0
            ))
        })?;
        backend_handle
            .unload_payload(&session.stage, &prim_path)
            .map_err(map_usd_error)
    })
    .await
    .map_err(|e| AppError::Internal(format!("USD task join error: {e}")))?
}

#[tauri::command]
pub(crate) async fn extract_geometry_session(
    app: tauri::AppHandle,
    backend: tauri::State<'_, UsdBackendState>,
    handle: StageSessionHandle,
    options: Option<ExtractGeometryOptions>,
    policy: Option<StageLoadPolicy>,
) -> Result<tauri::ipc::Response, AppError> {
    use tauri::Manager;
    let resolved_options =
        options.unwrap_or_else(|| ExtractGeometryOptions::from(policy.unwrap_or_default()));
    let backend_handle = backend.session()?;
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, AppError> {
        let _guard = lock_usd_task(false)?;
        let registry = app.state::<StageRegistry>();
        let session = registry.get(handle).ok_or_else(|| {
            AppError::Internal(format!(
                "extract_geometry_session: unknown session handle {}",
                handle.0
            ))
        })?;
        backend_handle
            .extract_geometry_from_session(&session.stage, &session.path, &resolved_options)
            .map_err(map_usd_error)
    })
    .await
    .map_err(|e| AppError::Internal(format!("USD task join error: {e}")))??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::{tempdir, TempDir};

    fn write_usda(name: &str, bytes: &[u8]) -> (TempDir, std::path::PathBuf) {
        let dir = tempdir().expect("tempdir");
        let path = dir.path().join(name);
        std::fs::write(&path, bytes).expect("write usda");
        (dir, path)
    }

    #[test]
    fn fast_usd_requires_glb_preview_detects_prefix_composition() {
        let (_dir, path) = write_usda(
            "composed.usda",
            b"#usda 1.0\ndef Xform \"Root\" (references = @asset.usda@) {}",
        );

        assert_eq!(fast_usd_requires_glb_preview(&path), Some(true));
    }

    #[test]
    fn fast_usd_requires_glb_preview_detects_point_instancer() {
        let (_dir, path) = write_usda(
            "instancer.usda",
            b"#usda 1.0\ndef PointInstancer \"Instances\" {}",
        );

        assert_eq!(fast_usd_requires_glb_preview(&path), Some(true));
    }

    #[test]
    fn fast_usd_requires_glb_preview_accepts_small_plain_usda() {
        let (_dir, path) = write_usda("plain.usda", b"#usda 1.0\ndef Xform \"Root\" {}");

        assert_eq!(fast_usd_requires_glb_preview(&path), Some(false));
    }

    #[test]
    fn fast_usd_requires_glb_preview_defers_small_time_sampled_usda() {
        let (_dir, path) = write_usda(
            "animated_xform.usda",
            b"#usda 1.0\ndef Xform \"Root\" { double3 xformOp:translate.timeSamples = { 1: (0, 0, 0), 2: (1, 0, 0) } }",
        );

        assert_eq!(fast_usd_requires_glb_preview(&path), None);
    }

    #[test]
    fn fast_usd_requires_glb_preview_defers_saturated_plain_prefix() {
        let mut bytes = b"#usda 1.0\n".to_vec();
        bytes.resize(USD_FAST_DECISION_SCAN_BYTES, b' ');
        let (_dir, path) = write_usda("large.usda", &bytes);

        assert_eq!(fast_usd_requires_glb_preview(&path), None);
    }
}
