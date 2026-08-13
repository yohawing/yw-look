pub mod commands;
pub mod error;
pub mod shared;
pub mod state;
pub mod usd;

#[cfg(test)]
mod ipc_type_exports;

#[cfg(any(target_os = "macos", target_os = "ios"))]
use std::path::PathBuf;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::Emitter;
use tauri::Manager;
use url::Url;

use crate::commands::alembic::convert_alembic_to_preview;
use crate::commands::bench::{
    finish_bench_run, get_bench_config, parse_bench_cli_config, read_bench_manifest,
    write_bench_report, write_bench_screenshot, write_bench_status,
};
use crate::commands::diagnostics::{
    clear_crash_marker, initialize_crash_marker, load_crash_recovery_status,
    load_diagnostics_snapshot, load_process_memory_metrics, log_diagnostic_event, open_app_log_dir,
};
use crate::commands::file_associations::{open_default_apps_settings, sync_file_associations};
use crate::commands::files::{
    get_startup_file, inspect_asset, list_supported_siblings, load_format_support,
    load_recent_files, open_file_dialog, read_binary_file, read_binary_file_prefix,
    resolve_selected_file, resolve_selected_files,
};
use crate::commands::loader_packs::{
    install_optional_loader_pack, load_optional_loader_manifests, remove_optional_loader_pack,
};
use crate::commands::psd::decode_psd;
use crate::commands::settings::{load_settings, load_update_configuration, save_settings};
use crate::commands::shot::{
    finish_shot_run, get_shot_batch_config, get_shot_config, parse_shot_cli_config,
    write_shot_batch_output, write_shot_output,
};
use crate::commands::startup_bench::{
    finish_startup_bench, get_startup_bench_config, parse_startup_bench_cli_config,
};
use crate::commands::updater::{check_for_update, install_pending_update};
use crate::commands::usd::{
    backend_capabilities, close_stage_session, collect_asset_issues, extract_geometry,
    extract_geometry_session, flatten_stage, inspect_attribute_time_samples, inspect_prim,
    inspect_stage, inspect_usd_lights, load_payload, open_stage_session, requires_glb_preview,
    summarize_stage, unload_payload,
};
use crate::state::{PendingOpenFiles, PendingUpdateState, UsdBackendState};
use crate::usd::{DefaultBackend, StageRegistry};

#[cfg(any(target_os = "macos", target_os = "ios"))]
const OPEN_FILE_EVENT: &str = "yw-look://open-file";

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn handle_opened_urls(app: &tauri::AppHandle, urls: Vec<Url>) {
    let paths: Vec<PathBuf> = urls
        .into_iter()
        .filter_map(|url| {
            if url.scheme() == "file" {
                url.to_file_path().ok()
            } else {
                None
            }
        })
        .collect();

    if paths.is_empty() {
        return;
    }

    if let Some(pending) = app.try_state::<PendingOpenFiles>() {
        crate::shared::lock_or_recover(&pending.0, "pending open files")
            .extend(paths.iter().cloned());
    }

    for path in &paths {
        let payload = path.display().to_string();
        if let Err(error) = app.emit(OPEN_FILE_EVENT, payload) {
            log::error!("failed to emit open-file event: {error}");
        }
    }
}

fn install_panic_hook() {
    static INSTALLED: std::sync::Once = std::sync::Once::new();
    INSTALLED.call_once(|| {
        let default_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            let location = info
                .location()
                .map(|location| format!("{}:{}", location.file(), location.line()))
                .unwrap_or_else(|| "unknown location".to_string());
            let payload = info
                .payload()
                .downcast_ref::<&str>()
                .map(|message| (*message).to_string())
                .or_else(|| info.payload().downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "panic payload was not a string".to_string());
            let backtrace = std::backtrace::Backtrace::force_capture();
            log::error!(
                target: "yw_look::panic",
                "panic at {location}: {payload}\nBacktrace:\n{backtrace}"
            );
            default_hook(info);
        }));
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let bench_cli_config = parse_bench_cli_config().expect("failed to parse bench CLI args");
    let shot_cli_config = parse_shot_cli_config().expect("failed to parse shot CLI args");
    let startup_bench_cli_config =
        parse_startup_bench_cli_config().expect("failed to parse startup bench CLI args");
    if bench_cli_config.is_some() && shot_cli_config.is_some() {
        panic!("--bench-load cannot be combined with --shot/--check");
    }
    if startup_bench_cli_config.is_some()
        && (bench_cli_config.is_some() || shot_cli_config.is_some())
    {
        panic!("--startup-bench cannot be combined with --bench-load or --shot/--check");
    }

    let app = tauri::Builder::default()
        .setup(move |app| {
            app.handle()
                .plugin(
                    tauri_plugin_log::Builder::new()
                        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                        .max_file_size(512_000)
                        .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                        .target(tauri_plugin_log::Target::new(
                            tauri_plugin_log::TargetKind::Webview,
                        ))
                        .build(),
                )
                .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
            install_panic_hook();

            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())
                .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;

            app.manage(PendingUpdateState::default());
            app.manage(PendingOpenFiles::default());
            app.manage(UsdBackendState::new(DefaultBackend::new()));
            app.manage(StageRegistry::new());
            app.manage(bench_cli_config.clone());
            app.manage(shot_cli_config.clone());
            app.manage(startup_bench_cli_config.clone());

            let is_cli = bench_cli_config.is_some()
                || shot_cli_config.is_some()
                || startup_bench_cli_config.is_some();
            if !is_cli {
                app.manage(initialize_crash_marker(&app.handle())?);
            }
            let entry_url: Option<&str> = if bench_cli_config.is_some() {
                Some("http://localhost:1420/?entry=bench")
            } else if shot_cli_config.is_some() {
                Some("http://localhost:1420/?entry=shot")
            } else {
                None
            };

            let window = app.get_webview_window("main").ok_or_else(|| {
                Box::<dyn std::error::Error>::from(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    "main window was not created",
                ))
            })?;

            let keep_window_visible = bench_cli_config
                .as_ref()
                .is_some_and(|config| config.visible)
                || startup_bench_cli_config.is_some();

            if is_cli && !keep_window_visible {
                window
                    .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                        x: -20000,
                        y: -20000,
                    }))
                    .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
                window
                    .show()
                    .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
            } else {
                window
                    .show()
                    .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
            }

            if let Some(url) = entry_url {
                window
                    .navigate(
                        Url::parse(url)
                            .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?,
                    )
                    .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
            }
            if !is_cli {
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if matches!(
                        event,
                        tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
                    ) {
                        clear_crash_marker(&app_handle);
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            load_update_configuration,
            open_file_dialog,
            resolve_selected_file,
            resolve_selected_files,
            list_supported_siblings,
            read_binary_file,
            read_binary_file_prefix,
            convert_alembic_to_preview,
            get_startup_file,
            load_recent_files,
            load_optional_loader_manifests,
            install_optional_loader_pack,
            remove_optional_loader_pack,
            decode_psd,
            sync_file_associations,
            open_default_apps_settings,
            log_diagnostic_event,
            load_diagnostics_snapshot,
            load_crash_recovery_status,
            open_app_log_dir,
            load_process_memory_metrics,
            get_bench_config,
            read_bench_manifest,
            write_bench_report,
            write_bench_status,
            write_bench_screenshot,
            finish_bench_run,
            get_shot_config,
            get_shot_batch_config,
            write_shot_output,
            write_shot_batch_output,
            finish_shot_run,
            get_startup_bench_config,
            finish_startup_bench,
            check_for_update,
            install_pending_update,
            inspect_asset,
            load_format_support,
            backend_capabilities,
            inspect_stage,
            summarize_stage,
            collect_asset_issues,
            requires_glb_preview,
            extract_geometry,
            inspect_prim,
            inspect_attribute_time_samples,
            flatten_stage,
            inspect_usd_lights,
            open_stage_session,
            close_stage_session,
            load_payload,
            unload_payload,
            extract_geometry_session
        ])
        .build(tauri::generate_context!())
        .expect("error while building yw-look");

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Opened { urls } = event {
            handle_opened_urls(app_handle, urls);
        }
    });

    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    app.run(|_, _| {});
}
