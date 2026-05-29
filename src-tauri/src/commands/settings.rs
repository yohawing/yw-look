use serde::Serialize;

use crate::error::AppError;
use crate::shared::{
    load_or_initialize_settings, resolve_settings_path, sanitize_settings, write_settings_file,
};
use crate::state::AppSettings;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsPayload {
    pub(crate) settings_path: String,
    pub(crate) settings: AppSettings,
}

#[tauri::command]
pub(crate) fn load_settings(app: tauri::AppHandle) -> Result<SettingsPayload, AppError> {
    let (settings_path, settings) = load_or_initialize_settings(&app)?;

    Ok(SettingsPayload {
        settings_path: settings_path.display().to_string(),
        settings,
    })
}

#[tauri::command]
pub(crate) fn save_settings(
    app: tauri::AppHandle,
    settings: AppSettings,
) -> Result<SettingsPayload, AppError> {
    let settings_path = resolve_settings_path(&app)?;
    let settings = sanitize_settings(settings);
    write_settings_file(&settings_path, &settings)?;

    Ok(SettingsPayload {
        settings_path: settings_path.display().to_string(),
        settings,
    })
}

#[tauri::command]
pub(crate) fn load_update_configuration(
    app: tauri::AppHandle,
) -> Result<crate::commands::updater::UpdateConfigurationPayload, AppError> {
    let (_, settings) = load_or_initialize_settings(&app)?;
    Ok(crate::commands::updater::build_update_configuration_payload(&app, &settings))
}
