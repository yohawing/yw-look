use serde::Serialize;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

use crate::error::AppError;
use crate::shared::{
    current_app_version, load_or_initialize_settings, lock_or_recover,
    DEFAULT_UPDATER_ENDPOINT, DEFAULT_UPDATER_PUBLIC_KEY,
};
use crate::state::{AppSettings, PendingUpdateState};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateConfigurationPayload {
    pub(crate) current_version: String,
    pub(crate) default_endpoint: Option<String>,
    pub(crate) default_pubkey_available: bool,
    pub(crate) effective_endpoint: Option<String>,
    pub(crate) effective_pubkey_available: bool,
    pub(crate) using_override_endpoint: bool,
    pub(crate) using_override_pubkey: bool,
    pub(crate) allow_insecure_update_endpoint: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateMetadataPayload {
    version: String,
    current_version: String,
    notes: Option<String>,
    pub_date: Option<String>,
    target: String,
    download_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateCheckPayload {
    pub(crate) configuration: UpdateConfigurationPayload,
    pub(crate) update: Option<UpdateMetadataPayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateInstallPayload {
    installed_version: String,
    restart_required: bool,
    note: String,
}

fn default_updater_endpoint() -> Option<String> {
    DEFAULT_UPDATER_ENDPOINT
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn default_updater_public_key() -> Option<String> {
    DEFAULT_UPDATER_PUBLIC_KEY
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn effective_updater_endpoint(settings: &AppSettings) -> Option<String> {
    settings
        .update_endpoint_override
        .clone()
        .or_else(default_updater_endpoint)
}

fn effective_updater_public_key(settings: &AppSettings) -> Option<String> {
    settings
        .update_public_key_override
        .clone()
        .or_else(default_updater_public_key)
}

fn is_loopback_update_endpoint(endpoint: &str) -> bool {
    endpoint.starts_with("http://127.0.0.1")
        || endpoint.starts_with("http://localhost")
        || endpoint.starts_with("http://[::1]")
}

pub(crate) fn build_update_configuration_payload(
    app: &tauri::AppHandle,
    settings: &AppSettings,
) -> UpdateConfigurationPayload {
    let default_endpoint = default_updater_endpoint();
    let default_pubkey = default_updater_public_key();
    let effective_endpoint = effective_updater_endpoint(settings);
    let effective_pubkey = effective_updater_public_key(settings);

    UpdateConfigurationPayload {
        current_version: current_app_version(app),
        default_endpoint,
        default_pubkey_available: default_pubkey.is_some(),
        effective_endpoint,
        effective_pubkey_available: effective_pubkey.is_some(),
        using_override_endpoint: settings.update_endpoint_override.is_some(),
        using_override_pubkey: settings.update_public_key_override.is_some(),
        allow_insecure_update_endpoint: settings.allow_insecure_update_endpoint,
    }
}

fn update_metadata_payload(update: &tauri_plugin_updater::Update) -> UpdateMetadataPayload {
    UpdateMetadataPayload {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        pub_date: update.date.map(|date| date.to_string()),
        target: update.target.clone(),
        download_url: update.download_url.to_string(),
    }
}

fn build_updater(
    app: &tauri::AppHandle,
    settings: &AppSettings,
) -> Result<tauri_plugin_updater::Updater, AppError> {
    let endpoint = effective_updater_endpoint(settings)
        .ok_or_else(|| AppError::Internal("no updater endpoint configured".into()))?;
    let pubkey = effective_updater_public_key(settings)
        .ok_or_else(|| AppError::Internal("no updater public key configured".into()))?;

    if !settings.allow_insecure_update_endpoint && endpoint.starts_with("http://") {
        return Err(AppError::Internal(
            "refusing insecure update endpoint; enable the local override toggle for loopback testing"
                .into(),
        ));
    }

    if settings.allow_insecure_update_endpoint && !is_loopback_update_endpoint(&endpoint) {
        return Err(AppError::Internal(
            "insecure update endpoints are restricted to localhost or 127.0.0.1".into(),
        ));
    }

    let endpoint = Url::parse(&endpoint)
        .map_err(|error| AppError::Internal(format!("failed to parse updater endpoint: {error}")))?;

    app.updater_builder()
        .pubkey(pubkey)
        .endpoints(vec![endpoint])
        .map_err(|error| AppError::Internal(format!("failed to configure updater endpoints: {error}")))?
        .build()
        .map_err(|error| AppError::Internal(format!("failed to build updater client: {error}")))
}

#[tauri::command]
pub(crate) async fn check_for_update(
    app: tauri::AppHandle,
    pending_update: tauri::State<'_, PendingUpdateState>,
) -> Result<UpdateCheckPayload, AppError> {
    let (_, settings) = load_or_initialize_settings(&app)?;
    let configuration = build_update_configuration_payload(&app, &settings);
    let update = build_updater(&app, &settings)?
        .check()
        .await
        .map_err(|error| AppError::Internal(format!("failed to check for updates: {error}")))?;

    let payload = UpdateCheckPayload {
        configuration,
        update: update.as_ref().map(update_metadata_payload),
    };

    *lock_or_recover(&pending_update.0, "pending update") = update;

    Ok(payload)
}

#[tauri::command]
pub(crate) async fn install_pending_update(
    pending_update: tauri::State<'_, PendingUpdateState>,
) -> Result<UpdateInstallPayload, AppError> {
    let update = lock_or_recover(&pending_update.0, "pending update")
        .take()
        .ok_or_else(|| {
            AppError::Internal("no pending update is available; run a check first".into())
        })?;
    let installed_version = update.version.clone();

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| AppError::Internal(format!("failed to install update: {error}")))?;

    Ok(UpdateInstallPayload {
        installed_version,
        restart_required: !cfg!(windows),
        note: if cfg!(windows) {
            "Windows will close the app and hand over to the installer.".to_string()
        } else {
            "Restart the app after installation to load the new version.".to_string()
        },
    })
}
