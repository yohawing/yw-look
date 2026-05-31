use std::path::{Path, PathBuf};
use std::{env, fs};

use serde::Serialize;

use crate::error::AppError;
use crate::shared::{
    canonicalize_existing_path, canonicalize_existing_parent, current_app_version,
    ensure_path_within, repo_root,
};
use crate::state::BenchCliConfig;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BenchConfigPayload {
    enabled: bool,
    models_path: String,
    repo_root: String,
    out_dir: String,
    case_ids: Vec<String>,
    mode: String,
    app_version: String,
    os: String,
    arch: String,
    node_version: Option<String>,
}

fn bench_artifacts_root(repo_root: &Path) -> PathBuf {
    repo_root.join("artifacts").join("bench")
}

fn normalize_bench_repo_root(path: &Path) -> Result<PathBuf, AppError> {
    let normalized = canonicalize_existing_path(path)?;
    let expected = canonicalize_existing_path(&repo_root()?)?;
    if normalized != expected {
        return Err(AppError::Internal(format!(
            "bench repo root '{}' must match '{}'",
            normalized.display(),
            expected.display()
        )));
    }
    Ok(normalized)
}

fn normalize_bench_models_path(path: &Path, repo_root: &Path) -> Result<PathBuf, AppError> {
    let normalized = canonicalize_existing_path(path)?;
    let samples_root = canonicalize_existing_path(&repo_root.join("samples").join("private"))?;
    ensure_path_within(&normalized, &samples_root, "bench models")?;
    Ok(normalized)
}

fn normalize_bench_out_dir(path: &Path, repo_root: &Path) -> Result<PathBuf, AppError> {
    let parent = canonicalize_existing_parent(path)?;
    let root = bench_artifacts_root(repo_root);
    fs::create_dir_all(&root)
        .map_err(|error| AppError::Io(format!("failed to create bench artifacts root: {error}")))?;
    let normalized_root = canonicalize_existing_path(&root)?;
    ensure_path_within(&parent, &normalized_root, "bench output")?;
    fs::create_dir_all(path)
        .map_err(|error| AppError::Io(format!("failed to create bench output directory: {error}")))?;
    canonicalize_existing_path(path)
}

pub(crate) fn parse_bench_cli_config() -> Result<Option<BenchCliConfig>, AppError> {
    let args: Vec<String> = env::args().collect();
    if !args.iter().any(|arg| arg == "--bench-load") {
        return Ok(None);
    }

    let mut models_path: Option<PathBuf> = None;
    let mut bench_repo_root: Option<PathBuf> = None;
    let mut out_dir: Option<PathBuf> = None;
    let mut case_ids: Vec<String> = Vec::new();
    let mut visible = false;
    let mut node_version: Option<String> = None;
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--bench-models" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| AppError::Internal("--bench-models requires a path".into()))?;
                models_path = Some(PathBuf::from(value));
            }
            "--bench-repo-root" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| AppError::Internal("--bench-repo-root requires a path".into()))?;
                bench_repo_root = Some(PathBuf::from(value));
            }
            "--bench-out" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| AppError::Internal("--bench-out requires a path".into()))?;
                out_dir = Some(PathBuf::from(value));
            }
            "--bench-node-version" => {
                index += 1;
                node_version = args.get(index).cloned();
            }
            "--bench-case" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| AppError::Internal("--bench-case requires an id".into()))?;
                case_ids.push(value.clone());
            }
            "--bench-visible" => {
                visible = true;
            }
            _ => {}
        }
        index += 1;
    }

    let bench_repo_root = normalize_bench_repo_root(
        &bench_repo_root
            .ok_or_else(|| AppError::Internal("--bench-load requires --bench-repo-root <path>".into()))?,
    )?;
    let models_path = normalize_bench_models_path(
        &models_path.ok_or_else(|| AppError::Internal("--bench-load requires --bench-models <path>".into()))?,
        &bench_repo_root,
    )?;
    let out_dir = normalize_bench_out_dir(
        &out_dir.ok_or_else(|| AppError::Internal("--bench-load requires --bench-out <dir>".into()))?,
        &bench_repo_root,
    )?;

    Ok(Some(BenchCliConfig {
        models_path,
        repo_root: bench_repo_root,
        out_dir,
        case_ids,
        visible,
        node_version,
    }))
}

#[tauri::command]
pub(crate) fn get_bench_config(
    app: tauri::AppHandle,
    config: tauri::State<'_, Option<BenchCliConfig>>,
) -> Result<Option<BenchConfigPayload>, AppError> {
    let Some(config) = config.as_ref() else {
        return Ok(None);
    };

    Ok(Some(BenchConfigPayload {
        enabled: true,
        models_path: config.models_path.display().to_string(),
        repo_root: config.repo_root.display().to_string(),
        out_dir: config.out_dir.display().to_string(),
        case_ids: config.case_ids.clone(),
        mode: if cfg!(debug_assertions) {
            "dev".to_string()
        } else {
            "release".to_string()
        },
        app_version: current_app_version(&app),
        os: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
        node_version: config.node_version.clone(),
    }))
}

#[tauri::command]
pub(crate) fn write_bench_report(
    config: tauri::State<'_, Option<BenchCliConfig>>,
    report_json: String,
    report_markdown: String,
) -> Result<(), AppError> {
    let Some(config) = config.as_ref() else {
        return Err(AppError::Internal("bench mode is not enabled".into()));
    };
    let out_dir = normalize_bench_out_dir(&config.out_dir, &config.repo_root)?;
    fs::write(out_dir.join("report.json"), report_json)
        .map_err(|error| AppError::Io(format!("failed to write report.json: {error}")))?;
    fs::write(out_dir.join("report.md"), report_markdown)
        .map_err(|error| AppError::Io(format!("failed to write report.md: {error}")))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn write_bench_status(
    config: tauri::State<'_, Option<BenchCliConfig>>,
    status_json: String,
) -> Result<(), AppError> {
    let Some(config) = config.as_ref() else {
        return Err(AppError::Internal("bench mode is not enabled".into()));
    };
    let out_dir = normalize_bench_out_dir(&config.out_dir, &config.repo_root)?;
    fs::write(out_dir.join("status.json"), status_json)
        .map_err(|error| AppError::Io(format!("failed to write status.json: {error}")))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn write_bench_screenshot(
    config: tauri::State<'_, Option<BenchCliConfig>>,
    file_name: String,
    png_bytes: Vec<u8>,
) -> Result<(), AppError> {
    let Some(config) = config.as_ref() else {
        return Err(AppError::Internal("bench mode is not enabled".into()));
    };
    if !file_name.ends_with(".png")
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains("..")
    {
        return Err(AppError::Internal(format!(
            "invalid bench screenshot file name: {file_name}"
        )));
    }

    let out_dir = normalize_bench_out_dir(&config.out_dir, &config.repo_root)?;
    let screenshots_dir = out_dir.join("screenshots");
    fs::create_dir_all(&screenshots_dir)
        .map_err(|error| AppError::Io(format!("failed to create screenshots directory: {error}")))?;
    fs::write(screenshots_dir.join(file_name), png_bytes)
        .map_err(|error| AppError::Io(format!("failed to write screenshot: {error}")))?;
    Ok(())
}

#[tauri::command]
pub(crate) fn finish_bench_run(app: tauri::AppHandle, exit_code: i32) {
    app.exit(exit_code);
}
