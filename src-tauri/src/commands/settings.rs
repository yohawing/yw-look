use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::shared::{
    load_or_initialize_settings, resolve_app_data_dir, sanitize_settings, write_settings_file,
    SETTINGS_FILE_NAME,
};
use crate::state::{AppSettings, OptionalLoaderPackSettings};

const INSTALLER_MANAGED_OPTIONAL_LOADER_PACKS: &[(&str, &str)] = &[
    ("vrm-loader-pack", "vrm"),
    ("mmd-loader-pack", "mmd"),
    ("gaussian-splat-loader-pack", "gaussian-splat"),
    ("ifc-loader-pack", "ifc"),
];

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsPayload {
    pub(crate) settings_path: String,
    pub(crate) settings: AppSettings,
}

fn settings_path_from_dir(dir: &Path) -> PathBuf {
    dir.join(SETTINGS_FILE_NAME)
}

fn optional_loader_pack_settings_from_installer_markers(
    dir: &Path,
) -> BTreeMap<String, OptionalLoaderPackSettings> {
    let optional_loaders_dir = dir.join("optional-loaders");
    let mut settings = BTreeMap::new();

    for (pack_id, pack_dir_name) in INSTALLER_MANAGED_OPTIONAL_LOADER_PACKS {
        let pack_dir = optional_loaders_dir.join(pack_dir_name);
        if pack_dir.join(".removed").is_file() {
            settings.insert(
                (*pack_id).to_string(),
                OptionalLoaderPackSettings { enabled: false },
            );
        } else if pack_dir.join("manifest.json").is_file() {
            settings.insert(
                (*pack_id).to_string(),
                OptionalLoaderPackSettings { enabled: true },
            );
        }
    }

    settings
}

fn load_settings_from_path(dir: &Path) -> Result<(PathBuf, AppSettings), AppError> {
    let settings_path = settings_path_from_dir(dir);
    let settings =
        if settings_path.exists() {
            let raw = fs::read_to_string(&settings_path)
                .map_err(|error| AppError::Io(format!("failed to read settings file: {error}")))?;
            sanitize_settings(serde_json::from_str::<AppSettings>(&raw).map_err(|error| {
                AppError::Serde(format!("failed to parse settings file: {error}"))
            })?)
        } else {
            let defaults = sanitize_settings(AppSettings {
                optional_loader_packs: optional_loader_pack_settings_from_installer_markers(dir),
                ..AppSettings::default()
            });
            write_settings_file(&settings_path, &defaults)?;
            defaults
        };
    Ok((settings_path, settings))
}

fn save_settings_to_path(
    dir: &Path,
    settings: AppSettings,
) -> Result<(PathBuf, AppSettings), AppError> {
    let settings_path = settings_path_from_dir(dir);
    let settings = sanitize_settings(settings);
    write_settings_file(&settings_path, &settings)?;
    Ok((settings_path, settings))
}

#[tauri::command]
pub(crate) fn load_settings(app: tauri::AppHandle) -> Result<SettingsPayload, AppError> {
    let app_data_dir = resolve_app_data_dir(&app)?;
    let (settings_path, settings) = load_settings_from_path(&app_data_dir)?;

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
    let app_data_dir = resolve_app_data_dir(&app)?;
    let (settings_path, settings) = save_settings_to_path(&app_data_dir, settings)?;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::OptionalLoaderPackSettings;
    use serde_json::Value;
    use tempfile::tempdir;

    fn read_settings_value(path: &Path) -> Value {
        let raw = fs::read_to_string(path).expect("settings json should be readable");
        serde_json::from_str(&raw).expect("settings json should parse")
    }

    #[test]
    fn load_settings_creates_default_file_when_missing() {
        let dir = tempdir().expect("tempdir");

        let (settings_path, settings) = load_settings_from_path(dir.path()).expect("load settings");

        assert_eq!(settings_path, dir.path().join(SETTINGS_FILE_NAME));
        assert!(settings_path.exists());
        let file_settings: AppSettings =
            serde_json::from_value(read_settings_value(&settings_path)).expect("file settings");
        assert_eq!(
            serde_json::to_value(&file_settings).expect("file settings value"),
            serde_json::to_value(&settings).expect("returned settings value")
        );
    }

    #[test]
    fn load_settings_applies_defaults_for_incomplete_json() {
        let dir = tempdir().expect("tempdir");
        let settings_path = dir.path().join(SETTINGS_FILE_NAME);
        fs::write(&settings_path, r#"{"recentFilesLimit":5}"#).expect("write settings");

        let (_, settings) = load_settings_from_path(dir.path()).expect("load settings");

        assert_eq!(settings.version, 5);
        assert_eq!(settings.recent_files_limit, 5);
        assert_eq!(settings.diagnostics_log_level, "info");
        assert!(!settings.file_associations_enabled);
        assert!(settings.optional_loader_packs.is_empty());
        assert_eq!(settings.update_endpoint_override, None);
        assert_eq!(settings.update_public_key_override, None);
    }

    #[test]
    fn load_settings_uses_installer_loader_pack_markers_for_initial_defaults() {
        let dir = tempdir().expect("tempdir");
        let vrm_dir = dir.path().join("optional-loaders").join("vrm");
        let mmd_dir = dir.path().join("optional-loaders").join("mmd");
        let gaussian_dir = dir.path().join("optional-loaders").join("gaussian-splat");
        fs::create_dir_all(&vrm_dir).expect("create vrm marker dir");
        fs::create_dir_all(&mmd_dir).expect("create mmd marker dir");
        fs::create_dir_all(&gaussian_dir).expect("create gaussian marker dir");
        fs::write(vrm_dir.join("manifest.json"), "{}").expect("write vrm manifest marker");
        fs::write(mmd_dir.join(".removed"), "removed by installer\n").expect("write marker");
        fs::write(gaussian_dir.join("manifest.json"), "{}").expect("write manifest marker");

        let (settings_path, settings) = load_settings_from_path(dir.path()).expect("load settings");
        let json = read_settings_value(&settings_path);

        assert!(settings.optional_loader_packs["vrm-loader-pack"].enabled);
        assert!(!settings.optional_loader_packs["mmd-loader-pack"].enabled);
        assert!(settings.optional_loader_packs["gaussian-splat-loader-pack"].enabled);
        assert_eq!(
            json["optionalLoaderPacks"]["vrm-loader-pack"]["enabled"],
            serde_json::json!(true)
        );
        assert_eq!(
            json["optionalLoaderPacks"]["mmd-loader-pack"]["enabled"],
            serde_json::json!(false)
        );
        assert_eq!(
            json["optionalLoaderPacks"]["gaussian-splat-loader-pack"]["enabled"],
            serde_json::json!(true)
        );
    }

    #[test]
    fn load_settings_sanitizes_invalid_values() {
        let dir = tempdir().expect("tempdir");
        let settings_path = dir.path().join(SETTINGS_FILE_NAME);
        fs::write(
            &settings_path,
            r#"{
  "version": 0,
  "recentFilesLimit": 0,
  "diagnosticsLogLevel": "",
  "updateEndpointOverride": "   ",
  "updatePublicKeyOverride": "\t"
}"#,
        )
        .expect("write settings");

        let (_, settings) = load_settings_from_path(dir.path()).expect("load settings");

        assert_eq!(settings.version, 5);
        assert_eq!(settings.recent_files_limit, 1);
        assert_eq!(settings.diagnostics_log_level, "info");
        assert_eq!(settings.update_endpoint_override, None);
        assert_eq!(settings.update_public_key_override, None);
    }

    #[test]
    fn save_settings_sanitizes_and_writes_camel_case_json() {
        let dir = tempdir().expect("tempdir");
        let settings = AppSettings {
            version: 0,
            recent_files_limit: 0,
            diagnostics_log_level: "".to_string(),
            update_endpoint_override: Some(
                "  https://updates.example.test/feed.json  ".to_string(),
            ),
            update_public_key_override: Some("  ".to_string()),
            allow_insecure_update_endpoint: true,
            optional_loader_packs: std::iter::once((
                "mmd-loader-pack".to_string(),
                OptionalLoaderPackSettings { enabled: false },
            ))
            .collect(),
            ..AppSettings::default()
        };

        let (settings_path, saved) =
            save_settings_to_path(dir.path(), settings).expect("save settings");
        let json = read_settings_value(&settings_path);

        assert_eq!(saved.version, 5);
        assert_eq!(saved.recent_files_limit, 1);
        assert_eq!(saved.diagnostics_log_level, "info");
        assert!(!saved.optional_loader_packs["mmd-loader-pack"].enabled);
        assert_eq!(
            json["recentFilesLimit"],
            serde_json::json!(saved.recent_files_limit)
        );
        assert_eq!(json["diagnosticsLogLevel"], serde_json::json!("info"));
        assert_eq!(
            json["updateEndpointOverride"],
            serde_json::json!("https://updates.example.test/feed.json")
        );
        assert_eq!(json["updatePublicKeyOverride"], Value::Null);
        assert_eq!(
            json["optionalLoaderPacks"]["mmd-loader-pack"]["enabled"],
            serde_json::json!(false)
        );
        assert!(json.get("recent_files_limit").is_none());
        assert!(json.get("diagnostics_log_level").is_none());
    }

    #[test]
    fn load_settings_returns_serde_error_for_invalid_json() {
        let dir = tempdir().expect("tempdir");
        let settings_path = dir.path().join(SETTINGS_FILE_NAME);
        fs::write(&settings_path, "{ invalid json").expect("write settings");

        let err = load_settings_from_path(dir.path()).expect_err("invalid json should fail");

        assert!(matches!(err, AppError::Serde(_)));
    }
}
