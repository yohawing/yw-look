use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use tauri::Manager;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::{env, fs, thread};

use crate::shared::{format_byte_limit, normalize_file_path, read_limited_file};

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const ALEMBIC_TOOL_PLATFORM_DIR: &str = "x64-windows";
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const ALEMBIC_TOOL_PLATFORM_DIR: &str = "arm64-osx";
#[cfg(not(any(
    all(target_os = "windows", target_arch = "x86_64"),
    all(target_os = "macos", target_arch = "aarch64")
)))]
const ALEMBIC_TOOL_PLATFORM_DIR: &str = "";
#[cfg(target_os = "windows")]
const ALEMBIC_TO_OBJ_BINARY_NAME: &str = "abc_to_obj.exe";
#[cfg(not(target_os = "windows"))]
const ALEMBIC_TO_OBJ_BINARY_NAME: &str = "abc_to_obj";
const ALEMBIC_MAX_INPUT_BYTES: u64 = 512 * 1024 * 1024;
const ALEMBIC_MAX_OUTPUT_BYTES: u64 = 128 * 1024 * 1024;
const ALEMBIC_MAX_STDERR_BYTES: u64 = 64 * 1024;
const ALEMBIC_HELPER_TIMEOUT: Duration = Duration::from_secs(60);

fn resolve_alembic_tool_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if ALEMBIC_TOOL_PLATFORM_DIR.is_empty() {
        return Err(format!(
            "Alembic preview is not bundled for this platform ({}-{}).",
            env::consts::OS,
            env::consts::ARCH
        ));
    }

    let relative_path = PathBuf::from("alembic-tools")
        .join(ALEMBIC_TOOL_PLATFORM_DIR)
        .join(ALEMBIC_TO_OBJ_BINARY_NAME);
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(&relative_path);
    if dev_path.is_file() {
        return Ok(dev_path);
    }

    let resource_path = app
        .path()
        .resource_dir()
        .map_err(|error| format!("failed to resolve app resources directory: {error}"))?
        .join(&relative_path);
    if resource_path.is_file() {
        return Ok(resource_path);
    }

    Err(format!(
        "Alembic preview helper is not bundled for this platform: {}",
        relative_path.display()
    ))
}

fn run_alembic_helper(tool_path: &Path, input_path: &Path) -> Result<String, String> {
    let temp_root = env::temp_dir();
    let nonce = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default()
    );
    let stdout_path = temp_root.join(format!("yw-look-alembic-{nonce}.obj"));
    let stderr_path = temp_root.join(format!("yw-look-alembic-{nonce}.err"));

    let cleanup = |stdout_path: &Path, stderr_path: &Path| {
        let _ = fs::remove_file(stdout_path);
        let _ = fs::remove_file(stderr_path);
    };

    let stdout_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&stdout_path)
        .map_err(|error| format!("failed to create Alembic helper stdout file: {error}"))?;
    let stderr_file = match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&stderr_path)
    {
        Ok(file) => file,
        Err(error) => {
            cleanup(&stdout_path, &stderr_path);
            return Err(format!(
                "failed to create Alembic helper stderr file: {error}"
            ));
        }
    };

    let mut child = Command::new(tool_path)
        .arg(input_path)
        .current_dir(input_path.parent().unwrap_or_else(|| Path::new(".")))
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .spawn()
        .map_err(|error| {
            cleanup(&stdout_path, &stderr_path);
            format!(
                "failed to launch Alembic preview helper {}: {error}",
                tool_path.display()
            )
        })?;

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                for (path, max_bytes, label) in [
                    (
                        stdout_path.as_path(),
                        ALEMBIC_MAX_OUTPUT_BYTES,
                        "preview output",
                    ),
                    (stderr_path.as_path(), ALEMBIC_MAX_STDERR_BYTES, "stderr"),
                ] {
                    let size = fs::metadata(path)
                        .map(|metadata| metadata.len())
                        .unwrap_or(0);
                    if size > max_bytes {
                        let _ = child.kill();
                        let _ = child.wait();
                        cleanup(&stdout_path, &stderr_path);
                        return Err(format!(
                            "Alembic preview {label} exceeded {}.",
                            format_byte_limit(max_bytes)
                        ));
                    }
                }

                if started.elapsed() > ALEMBIC_HELPER_TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    cleanup(&stdout_path, &stderr_path);
                    return Err(format!(
                        "Alembic preview helper timed out after {} seconds.",
                        ALEMBIC_HELPER_TIMEOUT.as_secs()
                    ));
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(error) => {
                cleanup(&stdout_path, &stderr_path);
                return Err(format!(
                    "failed to wait for Alembic preview helper: {error}"
                ));
            }
        }
    };

    if !status.success() {
        let stderr_bytes = match read_limited_file(&stderr_path, ALEMBIC_MAX_STDERR_BYTES, "stderr")
        {
            Ok(bytes) => bytes,
            Err(error) => {
                cleanup(&stdout_path, &stderr_path);
                return Err(error);
            }
        };
        let stderr = String::from_utf8_lossy(&stderr_bytes).trim().to_string();
        cleanup(&stdout_path, &stderr_path);
        return Err(if stderr.is_empty() {
            format!("Alembic preview helper exited with status {status}.")
        } else {
            stderr
        });
    }

    let stdout = match read_limited_file(&stdout_path, ALEMBIC_MAX_OUTPUT_BYTES, "preview output") {
        Ok(bytes) => bytes,
        Err(error) => {
            cleanup(&stdout_path, &stderr_path);
            return Err(error);
        }
    };
    cleanup(&stdout_path, &stderr_path);
    String::from_utf8(stdout)
        .map_err(|error| format!("Alembic preview helper returned non-UTF8 preview data: {error}"))
}

#[tauri::command]
pub(crate) fn convert_alembic_to_preview(
    app: tauri::AppHandle,
    path: String,
) -> Result<String, String> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let input_size = fs::metadata(&normalized)
        .map_err(|error| format!("failed to inspect Alembic input: {error}"))?
        .len();
    if input_size > ALEMBIC_MAX_INPUT_BYTES {
        return Err(format!(
            "Alembic preview input exceeded {} MiB.",
            ALEMBIC_MAX_INPUT_BYTES / 1024 / 1024
        ));
    }

    let extension = normalized
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != "abc" {
        return Err(format!(
            "Alembic preview only accepts .abc files: {}",
            normalized.display()
        ));
    }

    let tool_path = resolve_alembic_tool_path(&app)?;
    run_alembic_helper(&tool_path, &normalized)
}
