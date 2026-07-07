use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::AppError;
use crate::shared::current_app_version;
use crate::state::StartupBenchCliConfig;

const APP_RESULT_FILE: &str = "startup-bench-app-result.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartupBenchConfigPayload {
    enabled: bool,
    out_dir: String,
    app_version: String,
    os: String,
    arch: String,
    process_id: Option<u32>,
    mode: String,
    packaged: bool,
    node_version: Option<String>,
}

fn normalize_startup_bench_out_dir(path: &Path) -> Result<PathBuf, AppError> {
    fs::create_dir_all(path).map_err(|error| {
        AppError::Io(format!(
            "failed to create startup bench output directory: {error}"
        ))
    })?;
    Ok(path.to_path_buf())
}

pub(crate) fn parse_startup_bench_cli_config() -> Result<Option<StartupBenchCliConfig>, AppError> {
    let args: Vec<String> = env::args().collect();
    parse_startup_bench_cli_config_from_args(&args)
}

fn parse_startup_bench_cli_config_from_args(
    args: &[String],
) -> Result<Option<StartupBenchCliConfig>, AppError> {
    if !args.iter().any(|arg| arg == "--startup-bench") {
        return Ok(None);
    }

    let mut out_dir: Option<PathBuf> = None;
    let mut node_version: Option<String> = None;
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--startup-bench-out" => {
                index += 1;
                let value = args.get(index).ok_or_else(|| {
                    AppError::Internal("--startup-bench-out requires a path".into())
                })?;
                out_dir = Some(PathBuf::from(value));
            }
            "--startup-bench-node-version" => {
                index += 1;
                node_version = args.get(index).cloned();
            }
            _ => {}
        }
        index += 1;
    }

    let out_dir = normalize_startup_bench_out_dir(&out_dir.ok_or_else(|| {
        AppError::Internal("--startup-bench requires --startup-bench-out <dir>".into())
    })?)?;

    Ok(Some(StartupBenchCliConfig {
        out_dir,
        node_version,
    }))
}

#[tauri::command]
pub(crate) fn get_startup_bench_config(
    app: tauri::AppHandle,
    config: tauri::State<'_, Option<StartupBenchCliConfig>>,
) -> Result<Option<StartupBenchConfigPayload>, AppError> {
    let Some(config) = config.as_ref() else {
        return Ok(None);
    };

    Ok(Some(StartupBenchConfigPayload {
        enabled: true,
        out_dir: config.out_dir.display().to_string(),
        app_version: current_app_version(&app),
        os: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
        process_id: Some(std::process::id()),
        mode: if cfg!(debug_assertions) {
            "dev".to_string()
        } else {
            "release".to_string()
        },
        packaged: !cfg!(debug_assertions),
        node_version: config.node_version.clone(),
    }))
}

#[tauri::command]
pub(crate) fn finish_startup_bench(
    app: tauri::AppHandle,
    config: tauri::State<'_, Option<StartupBenchCliConfig>>,
    result: serde_json::Value,
) {
    let exit_code = if let Some(config) = config.as_ref() {
        match write_startup_bench_result(&config.out_dir, &result) {
            Ok(()) => 0,
            Err(error) => {
                log::error!("startup bench failed to write result: {error}");
                eprintln!("startup bench failed to write result: {error}");
                1
            }
        }
    } else {
        log::error!("startup bench finish called without enabled config");
        eprintln!("startup bench finish called without enabled config");
        1
    };

    app.exit(exit_code);
    std::process::exit(exit_code);
}

fn write_startup_bench_result(out_dir: &Path, result: &serde_json::Value) -> Result<(), AppError> {
    let out_dir = normalize_startup_bench_out_dir(out_dir)?;
    let payload = serde_json::to_string_pretty(result).map_err(|error| {
        AppError::Serde(format!("failed to serialize startup bench result: {error}"))
    })?;
    fs::write(out_dir.join(APP_RESULT_FILE), format!("{payload}\n"))
        .map_err(|error| AppError::Io(format!("failed to write startup bench result: {error}")))?;
    Ok(())
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
    fn parses_startup_bench_cli_config() {
        let root = unique_temp_dir("startup-bench-cli");
        fs::create_dir_all(&root).expect("create temp root");

        let args = vec![
            "yw-look".to_string(),
            "--startup-bench".to_string(),
            "--startup-bench-out".to_string(),
            root.display().to_string(),
            "--startup-bench-node-version".to_string(),
            "v22.0.0".to_string(),
        ];
        let config = parse_startup_bench_cli_config_from_args(&args)
            .expect("parse startup bench cli")
            .expect("startup bench config");

        assert_eq!(config.out_dir, root);
        assert_eq!(config.node_version.as_deref(), Some("v22.0.0"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_startup_bench_without_out_dir() {
        let args = vec!["yw-look".to_string(), "--startup-bench".to_string()];
        let error = parse_startup_bench_cli_config_from_args(&args)
            .expect_err("missing out dir should fail");
        assert!(error.to_string().contains("--startup-bench-out"));
    }
}
