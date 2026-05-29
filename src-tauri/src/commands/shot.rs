use std::path::{Path, PathBuf};
use std::{env, fs};

use serde::Serialize;

use crate::shared::canonicalize_existing_path;
use crate::state::{ShotBatchCaseArgument, ShotCliCase, ShotCliConfig, ShotMode};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShotConfigPayload {
    case_index: usize,
    mode: ShotMode,
    input_path: String,
    file_name: String,
    extension: String,
    width: u32,
    height: u32,
    background: Option<String>,
}

fn parse_size_argument(value: &str) -> Result<(u32, u32), String> {
    let (w, h) = value
        .split_once(['x', 'X', '×'])
        .ok_or_else(|| format!("--size expects WxH (e.g. 1920x1080), got '{value}'"))?;
    let width: u32 = w
        .trim()
        .parse()
        .map_err(|error| format!("--size width '{w}' is not a u32: {error}"))?;
    let height: u32 = h
        .trim()
        .parse()
        .map_err(|error| format!("--size height '{h}' is not a u32: {error}"))?;
    if width == 0 || height == 0 {
        return Err(format!(
            "--size width/height must be > 0, got {width}x{height}"
        ));
    }
    if width > 8192 || height > 8192 {
        return Err(format!(
            "--size width/height capped at 8192, got {width}x{height}"
        ));
    }
    Ok((width, height))
}

fn resolve_shot_input(path: &Path) -> Result<PathBuf, String> {
    let normalized = canonicalize_existing_path(path).map_err(|error| format!("--in {error}"))?;
    if !normalized.is_file() {
        return Err(format!(
            "--in path '{}' is not a regular file",
            normalized.display()
        ));
    }
    Ok(normalized)
}

fn resolve_shot_output(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    fs::create_dir_all(&parent).map_err(|error| {
        format!(
            "failed to create --out parent directory '{}': {error}",
            parent.display()
        )
    })?;
    let normalized_parent =
        canonicalize_existing_path(&parent).map_err(|error| format!("--out parent {error}"))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("--out path '{}' has no file name", path.display()))?;
    Ok(normalized_parent.join(file_name))
}

fn to_shot_config_payload(case_index: usize, config: &ShotCliCase) -> ShotConfigPayload {
    let file_name = config
        .input_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();
    let extension = config
        .input_path
        .extension()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_lowercase();
    ShotConfigPayload {
        case_index,
        mode: config.mode,
        input_path: config.input_path.display().to_string(),
        file_name,
        extension,
        width: config.width,
        height: config.height,
        background: config.background.clone(),
    }
}

pub(crate) fn parse_shot_cli_config() -> Result<Option<ShotCliConfig>, String> {
    let args: Vec<String> = env::args().collect();
    let shot_batch_index = args.iter().position(|arg| arg == "--shot-batch");
    let shot_batch_file_index = args.iter().position(|arg| arg == "--shot-batch-file");
    let shot_flag = args.iter().any(|arg| arg == "--shot");
    let check_flag = args.iter().any(|arg| arg == "--check");
    if shot_batch_index.is_none() && shot_batch_file_index.is_none() && !shot_flag && !check_flag {
        return Ok(None);
    }
    if shot_batch_index.is_some() && shot_batch_file_index.is_some() {
        return Err("--shot-batch and --shot-batch-file are mutually exclusive".to_string());
    }
    if (shot_batch_index.is_some() || shot_batch_file_index.is_some()) && (shot_flag || check_flag)
    {
        return Err("--shot-batch cannot be combined with --shot or --check".to_string());
    }
    if let Some(index) = shot_batch_index.or(shot_batch_file_index) {
        let raw_value = args.get(index + 1).ok_or_else(|| {
            if shot_batch_index.is_some() {
                "--shot-batch requires a JSON array".to_string()
            } else {
                "--shot-batch-file requires a JSON file path".to_string()
            }
        })?;
        let value = if shot_batch_file_index.is_some() {
            fs::read_to_string(raw_value).map_err(|error| {
                format!("failed to read --shot-batch-file '{}': {error}", raw_value)
            })?
        } else {
            raw_value.clone()
        };
        let batch_cases = serde_json::from_str::<Vec<ShotBatchCaseArgument>>(&value)
            .map_err(|error| format!("failed to parse --shot-batch JSON: {error}"))?;
        if batch_cases.is_empty() {
            return Err("--shot-batch requires at least one case".to_string());
        }
        let cases = batch_cases
            .into_iter()
            .map(|case| {
                if case.width == 0 || case.height == 0 {
                    return Err(format!(
                        "--shot-batch width/height must be > 0, got {}x{}",
                        case.width, case.height
                    ));
                }
                if case.width > 8192 || case.height > 8192 {
                    return Err(format!(
                        "--shot-batch width/height capped at 8192, got {}x{}",
                        case.width, case.height
                    ));
                }
                Ok(ShotCliCase {
                    mode: ShotMode::Shot,
                    input_path: resolve_shot_input(&case.input_path)?,
                    output_path: Some(resolve_shot_output(&case.output_path)?),
                    width: case.width,
                    height: case.height,
                    background: case.background,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        return Ok(Some(ShotCliConfig { cases }));
    }
    if shot_flag && check_flag {
        return Err("--shot and --check are mutually exclusive".to_string());
    }
    let mode = if shot_flag {
        ShotMode::Shot
    } else {
        ShotMode::Check
    };

    let mut input_path: Option<PathBuf> = None;
    let mut output_path: Option<PathBuf> = None;
    let mut size: Option<(u32, u32)> = None;
    let mut background: Option<String> = None;
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--in" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "--in requires a path".to_string())?;
                input_path = Some(PathBuf::from(value));
            }
            "--out" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "--out requires a path".to_string())?;
                output_path = Some(PathBuf::from(value));
            }
            "--size" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "--size requires WxH".to_string())?;
                size = Some(parse_size_argument(value)?);
            }
            "--bg" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "--bg requires a value".to_string())?;
                background = Some(value.clone());
            }
            _ => {}
        }
        index += 1;
    }

    let input_path = resolve_shot_input(&input_path.ok_or_else(|| {
        format!(
            "--{} requires --in <path>",
            if mode == ShotMode::Shot {
                "shot"
            } else {
                "check"
            }
        )
    })?)?;

    let output_path = match mode {
        ShotMode::Shot => {
            Some(resolve_shot_output(&output_path.ok_or_else(|| {
                "--shot requires --out <path>".to_string()
            })?)?)
        }
        ShotMode::Check => None,
    };

    let (width, height) = size.unwrap_or((1024, 768));

    Ok(Some(ShotCliConfig {
        cases: vec![ShotCliCase {
            mode,
            input_path,
            output_path,
            width,
            height,
            background,
        }],
    }))
}

#[tauri::command]
pub(crate) fn get_shot_config(
    config: tauri::State<'_, Option<ShotCliConfig>>,
) -> Result<Option<ShotConfigPayload>, String> {
    let Some(config) = config.as_ref() else {
        return Ok(None);
    };
    Ok(config
        .cases
        .first()
        .map(|shot_case| to_shot_config_payload(0, shot_case)))
}

#[tauri::command]
pub(crate) fn get_shot_batch_config(
    config: tauri::State<'_, Option<ShotCliConfig>>,
) -> Result<Vec<ShotConfigPayload>, String> {
    let Some(config) = config.as_ref() else {
        return Ok(Vec::new());
    };
    Ok(config
        .cases
        .iter()
        .enumerate()
        .map(|(case_index, shot_case)| to_shot_config_payload(case_index, shot_case))
        .collect())
}

#[tauri::command]
pub(crate) fn write_shot_output(
    config: tauri::State<'_, Option<ShotCliConfig>>,
    png_bytes: Vec<u8>,
) -> Result<String, String> {
    let Some(config) = config.as_ref() else {
        return Err("shot mode is not enabled".to_string());
    };
    let Some(shot_case) = config.cases.first() else {
        return Err("shot mode has no configured cases".to_string());
    };
    let Some(output_path) = shot_case.output_path.as_ref() else {
        return Err("--out is not configured (check mode does not write images)".to_string());
    };
    fs::write(output_path, &png_bytes)
        .map_err(|error| format!("failed to write shot output: {error}"))?;
    Ok(output_path.display().to_string())
}

#[tauri::command]
pub(crate) fn write_shot_batch_output(
    config: tauri::State<'_, Option<ShotCliConfig>>,
    case_index: usize,
    png_bytes: Vec<u8>,
) -> Result<String, String> {
    let Some(config) = config.as_ref() else {
        return Err("shot batch mode is not enabled".to_string());
    };
    let Some(shot_case) = config.cases.get(case_index) else {
        return Err(format!("shot batch case index out of range: {case_index}"));
    };
    let Some(output_path) = shot_case.output_path.as_ref() else {
        return Err("shot batch case has no output path".to_string());
    };
    fs::write(output_path, &png_bytes)
        .map_err(|error| format!("failed to write shot batch output: {error}"))?;
    Ok(output_path.display().to_string())
}

#[tauri::command]
pub(crate) fn finish_shot_run(app: tauri::AppHandle, exit_code: i32) {
    app.exit(exit_code);
}
