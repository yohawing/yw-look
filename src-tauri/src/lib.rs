pub mod commands;
pub mod shared;
pub mod state;
pub mod usd;

use tauri::Manager;
use url::Url;

use crate::commands::alembic::convert_alembic_to_preview;
use crate::commands::bench::{
    finish_bench_run, get_bench_config, parse_bench_cli_config, write_bench_report,
    write_bench_screenshot, write_bench_status,
};
use crate::commands::diagnostics::{
    load_diagnostics_snapshot, load_process_memory_metrics, log_diagnostic_event,
};
use crate::commands::files::{
    get_startup_file, inspect_asset, list_supported_siblings, load_format_support,
    load_recent_files, open_file_dialog, read_binary_file, resolve_selected_file,
};
use crate::commands::integrations::load_supported_extensions;
use crate::commands::settings::{load_settings, load_update_configuration, save_settings};
use crate::commands::shot::{
    finish_shot_run, get_shot_batch_config, get_shot_config, parse_shot_cli_config,
    write_shot_batch_output, write_shot_output,
};
use crate::commands::updater::{check_for_update, install_pending_update};
use crate::commands::usd::{
    backendCapabilities, close_stage_session, collect_asset_issues, extract_geometry,
    extract_geometry_session, flatten_stage, inspect_attribute_time_samples, inspect_prim,
    inspect_stage, inspect_usd_lights, load_payload, open_stage_session, requires_glb_preview,
    summarize_stage, unload_payload,
};
use crate::state::{
    PendingOpenFiles, PendingUpdateState, UsdBackendState,
};
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
        pending.0.lock().unwrap().extend(paths.iter().cloned());
    }

    for path in &paths {
        let payload = path.display().to_string();
        if let Err(error) = app.emit(OPEN_FILE_EVENT, payload) {
            eprintln!("failed to emit open-file event: {error}");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let bench_cli_config = parse_bench_cli_config().expect("failed to parse bench CLI args");
    let shot_cli_config = parse_shot_cli_config().expect("failed to parse shot CLI args");
    if bench_cli_config.is_some() && shot_cli_config.is_some() {
        panic!("--bench-load cannot be combined with --shot/--check");
    }

    let app = tauri::Builder::default()
        .setup(move |app| {
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())
                .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;

            app.manage(PendingUpdateState::default());
            app.manage(PendingOpenFiles::default());
            app.manage(UsdBackendState::new(DefaultBackend::new()));
            app.manage(StageRegistry::new());
            app.manage(bench_cli_config.clone());
            app.manage(shot_cli_config.clone());

            let is_cli = bench_cli_config.is_some() || shot_cli_config.is_some();
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
                .is_some_and(|config| config.visible);

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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            load_update_configuration,
            open_file_dialog,
            resolve_selected_file,
            list_supported_siblings,
            read_binary_file,
            convert_alembic_to_preview,
            get_startup_file,
            load_recent_files,
            load_supported_extensions,
            log_diagnostic_event,
            load_diagnostics_snapshot,
            load_process_memory_metrics,
            get_bench_config,
            write_bench_report,
            write_bench_status,
            write_bench_screenshot,
            finish_bench_run,
            get_shot_config,
            get_shot_batch_config,
            write_shot_output,
            write_shot_batch_output,
            finish_shot_run,
            check_for_update,
            install_pending_update,
            inspect_asset,
            load_format_support,
            backendCapabilities,
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
