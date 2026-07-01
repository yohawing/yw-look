use std::path::{Path, PathBuf};
use std::{env, fs};

use serde::Serialize;

use crate::error::AppError;
use crate::shared::canonicalize_existing_path;
use crate::state::{ShotBatchCaseArgument, ShotCliCase, ShotCliConfig, ShotMode};
use crate::usd::StageLoadPolicy;

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
    usd_load_policy: StageLoadPolicy,
}

fn parse_size_argument(value: &str) -> Result<(u32, u32), AppError> {
    let (w, h) = value.split_once(['x', 'X', '×']).ok_or_else(|| {
        AppError::Internal(format!(
            "--size expects WxH (e.g. 1920x1080), got '{value}'"
        ))
    })?;
    let width: u32 = w
        .trim()
        .parse()
        .map_err(|error| AppError::Internal(format!("--size width '{w}' is not a u32: {error}")))?;
    let height: u32 = h.trim().parse().map_err(|error| {
        AppError::Internal(format!("--size height '{h}' is not a u32: {error}"))
    })?;
    if width == 0 || height == 0 {
        return Err(AppError::Internal(format!(
            "--size width/height must be > 0, got {width}x{height}"
        )));
    }
    if width > 8192 || height > 8192 {
        return Err(AppError::Internal(format!(
            "--size width/height capped at 8192, got {width}x{height}"
        )));
    }
    Ok((width, height))
}

fn parse_usd_load_policy_argument(value: &str) -> Result<StageLoadPolicy, AppError> {
    match value {
        "loadAll" | "load-all" | "all" => Ok(StageLoadPolicy::LoadAll),
        "noPayloads" | "no-payloads" | "deferred" => Ok(StageLoadPolicy::NoPayloads),
        _ => Err(AppError::Internal(format!(
            "--usd-load-policy expects loadAll or noPayloads, got '{value}'"
        ))),
    }
}

fn resolve_shot_input(path: &Path) -> Result<PathBuf, AppError> {
    let normalized =
        canonicalize_existing_path(path).map_err(|error| AppError::Io(format!("--in {error}")))?;
    if !normalized.is_file() {
        return Err(AppError::Internal(format!(
            "--in path '{}' is not a regular file",
            normalized.display()
        )));
    }
    Ok(normalized)
}

fn resolve_shot_output(path: &Path) -> Result<PathBuf, AppError> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    fs::create_dir_all(&parent).map_err(|error| {
        AppError::Io(format!(
            "failed to create --out parent directory '{}': {error}",
            parent.display()
        ))
    })?;
    let normalized_parent = canonicalize_existing_path(&parent)
        .map_err(|error| AppError::Io(format!("--out parent {error}")))?;
    let file_name = path.file_name().ok_or_else(|| {
        AppError::Internal(format!("--out path '{}' has no file name", path.display()))
    })?;
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
        usd_load_policy: config.usd_load_policy,
    }
}

pub(crate) fn parse_shot_cli_config() -> Result<Option<ShotCliConfig>, AppError> {
    let args: Vec<String> = env::args().collect();
    parse_shot_cli_config_from_args(&args)
}

fn parse_shot_cli_config_from_args(args: &[String]) -> Result<Option<ShotCliConfig>, AppError> {
    let shot_batch_index = args.iter().position(|arg| arg == "--shot-batch");
    let shot_batch_file_index = args.iter().position(|arg| arg == "--shot-batch-file");
    let shot_flag = args.iter().any(|arg| arg == "--shot");
    let check_flag = args.iter().any(|arg| arg == "--check");
    if shot_batch_index.is_none() && shot_batch_file_index.is_none() && !shot_flag && !check_flag {
        return Ok(None);
    }
    if shot_batch_index.is_some() && shot_batch_file_index.is_some() {
        return Err(AppError::Internal(
            "--shot-batch and --shot-batch-file are mutually exclusive".into(),
        ));
    }
    if (shot_batch_index.is_some() || shot_batch_file_index.is_some()) && (shot_flag || check_flag)
    {
        return Err(AppError::Internal(
            "--shot-batch cannot be combined with --shot or --check".into(),
        ));
    }
    if let Some(index) = shot_batch_index.or(shot_batch_file_index) {
        let raw_value = args.get(index + 1).ok_or_else(|| {
            if shot_batch_index.is_some() {
                AppError::Internal("--shot-batch requires a JSON array".into())
            } else {
                AppError::Internal("--shot-batch-file requires a JSON file path".into())
            }
        })?;
        let value = if shot_batch_file_index.is_some() {
            fs::read_to_string(raw_value).map_err(|error| {
                AppError::Io(format!(
                    "failed to read --shot-batch-file '{}': {error}",
                    raw_value
                ))
            })?
        } else {
            raw_value.clone()
        };
        let batch_cases =
            serde_json::from_str::<Vec<ShotBatchCaseArgument>>(&value).map_err(|error| {
                AppError::Serde(format!("failed to parse --shot-batch JSON: {error}"))
            })?;
        if batch_cases.is_empty() {
            return Err(AppError::Internal(
                "--shot-batch requires at least one case".into(),
            ));
        }
        let cases = batch_cases
            .into_iter()
            .map(|case| {
                if case.width == 0 || case.height == 0 {
                    return Err(AppError::Internal(format!(
                        "--shot-batch width/height must be > 0, got {}x{}",
                        case.width, case.height
                    )));
                }
                if case.width > 8192 || case.height > 8192 {
                    return Err(AppError::Internal(format!(
                        "--shot-batch width/height capped at 8192, got {}x{}",
                        case.width, case.height
                    )));
                }
                Ok(ShotCliCase {
                    mode: ShotMode::Shot,
                    input_path: resolve_shot_input(&case.input_path)?,
                    output_path: Some(resolve_shot_output(&case.output_path)?),
                    width: case.width,
                    height: case.height,
                    background: case.background,
                    usd_load_policy: case.usd_load_policy.unwrap_or_default(),
                })
            })
            .collect::<Result<Vec<_>, AppError>>()?;
        return Ok(Some(ShotCliConfig { cases }));
    }
    if shot_flag && check_flag {
        return Err(AppError::Internal(
            "--shot and --check are mutually exclusive".into(),
        ));
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
    let mut usd_load_policy = StageLoadPolicy::LoadAll;
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--in" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| AppError::Internal("--in requires a path".into()))?;
                input_path = Some(PathBuf::from(value));
            }
            "--out" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| AppError::Internal("--out requires a path".into()))?;
                output_path = Some(PathBuf::from(value));
            }
            "--size" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| AppError::Internal("--size requires WxH".into()))?;
                size = Some(parse_size_argument(value)?);
            }
            "--bg" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| AppError::Internal("--bg requires a value".into()))?;
                background = Some(value.clone());
            }
            "--usd-load-policy" => {
                index += 1;
                let value = args.get(index).ok_or_else(|| {
                    AppError::Internal("--usd-load-policy requires a value".into())
                })?;
                usd_load_policy = parse_usd_load_policy_argument(value)?;
            }
            _ => {}
        }
        index += 1;
    }

    let input_path = resolve_shot_input(&input_path.ok_or_else(|| {
        AppError::Internal(format!(
            "--{} requires --in <path>",
            if mode == ShotMode::Shot {
                "shot"
            } else {
                "check"
            }
        ))
    })?)?;

    let output_path = match mode {
        ShotMode::Shot => {
            Some(resolve_shot_output(&output_path.ok_or_else(|| {
                AppError::Internal("--shot requires --out <path>".into())
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
            usd_load_policy,
        }],
    }))
}

#[tauri::command]
pub(crate) fn get_shot_config(
    config: tauri::State<'_, Option<ShotCliConfig>>,
) -> Result<Option<ShotConfigPayload>, AppError> {
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
) -> Result<Vec<ShotConfigPayload>, AppError> {
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
) -> Result<String, AppError> {
    let Some(config) = config.as_ref() else {
        return Err(AppError::Internal("shot mode is not enabled".into()));
    };
    let Some(shot_case) = config.cases.first() else {
        return Err(AppError::Internal(
            "shot mode has no configured cases".into(),
        ));
    };
    let Some(output_path) = shot_case.output_path.as_ref() else {
        return Err(AppError::Internal(
            "--out is not configured (check mode does not write images)".into(),
        ));
    };
    fs::write(output_path, &png_bytes)
        .map_err(|error| AppError::Io(format!("failed to write shot output: {error}")))?;
    Ok(output_path.display().to_string())
}

#[tauri::command]
pub(crate) fn write_shot_batch_output(
    config: tauri::State<'_, Option<ShotCliConfig>>,
    case_index: usize,
    png_bytes: Vec<u8>,
) -> Result<String, AppError> {
    let Some(config) = config.as_ref() else {
        return Err(AppError::Internal("shot batch mode is not enabled".into()));
    };
    let Some(shot_case) = config.cases.get(case_index) else {
        return Err(AppError::Internal(format!(
            "shot batch case index out of range: {case_index}"
        )));
    };
    let Some(output_path) = shot_case.output_path.as_ref() else {
        return Err(AppError::Internal(
            "shot batch case has no output path".into(),
        ));
    };
    fs::write(output_path, &png_bytes)
        .map_err(|error| AppError::Io(format!("failed to write shot batch output: {error}")))?;
    Ok(output_path.display().to_string())
}

#[tauri::command]
pub(crate) fn finish_shot_run(app: tauri::AppHandle, exit_code: i32) {
    app.exit(exit_code);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after UNIX_EPOCH")
            .as_nanos();
        std::env::temp_dir().join(format!("yw-look-{name}-{}-{suffix}", std::process::id()))
    }

    #[test]
    fn parses_shot_batch_file_contents() {
        let root = unique_temp_dir("shot-batch-file");
        fs::create_dir_all(&root).expect("create temp root");
        let input_path = root.join("input.glb");
        let output_path = root.join("out").join("shot.png");
        let config_path = root.join("batch.json");
        fs::write(&input_path, b"placeholder").expect("write input");

        let config_json = serde_json::json!([
            {
                "inputPath": input_path,
                "outputPath": output_path,
                "width": 320,
                "height": 180,
                "background": "transparent",
                "usdLoadPolicy": "noPayloads"
            }
        ]);
        fs::write(&config_path, config_json.to_string()).expect("write config");

        let args = vec![
            "yw-look".to_string(),
            "--shot-batch-file".to_string(),
            config_path.display().to_string(),
        ];
        let config = parse_shot_cli_config_from_args(&args)
            .expect("parse shot batch file")
            .expect("shot batch config");

        assert_eq!(config.cases.len(), 1);
        let case = &config.cases[0];
        assert_eq!(case.mode, ShotMode::Shot);
        assert_eq!(case.width, 320);
        assert_eq!(case.height, 180);
        assert_eq!(case.background.as_deref(), Some("transparent"));
        assert_eq!(case.usd_load_policy, StageLoadPolicy::NoPayloads);
        assert_eq!(case.input_path.file_name().unwrap(), "input.glb");
        assert_eq!(
            case.output_path.as_ref().unwrap().file_name().unwrap(),
            "shot.png"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn parses_check_usd_load_policy() {
        let root = unique_temp_dir("shot-check-usd-policy");
        fs::create_dir_all(&root).expect("create temp root");
        let input_path = root.join("input.usda");
        fs::write(&input_path, b"#usda 1.0\n").expect("write input");

        let args = vec![
            "yw-look".to_string(),
            "--check".to_string(),
            "--in".to_string(),
            input_path.display().to_string(),
            "--usd-load-policy".to_string(),
            "noPayloads".to_string(),
        ];
        let config = parse_shot_cli_config_from_args(&args)
            .expect("parse shot check")
            .expect("shot check config");

        assert_eq!(config.cases.len(), 1);
        let case = &config.cases[0];
        assert_eq!(case.mode, ShotMode::Check);
        assert_eq!(case.usd_load_policy, StageLoadPolicy::NoPayloads);

        let _ = fs::remove_dir_all(root);
    }
}
