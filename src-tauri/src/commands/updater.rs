use serde::Serialize;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

use crate::error::AppError;
use crate::shared::{
    current_app_version, load_or_initialize_settings, lock_or_recover, DEFAULT_UPDATER_ENDPOINT,
    DEFAULT_UPDATER_PUBLIC_KEY,
};
use crate::state::{AppSettings, PendingUpdateState};

#[cfg_attr(test, derive(ts_rs::TS))]
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

#[cfg_attr(test, derive(ts_rs::TS))]
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

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateCheckPayload {
    pub(crate) configuration: UpdateConfigurationPayload,
    pub(crate) update: Option<UpdateMetadataPayload>,
}

#[cfg_attr(test, derive(ts_rs::TS))]
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

pub(crate) fn compiled_update_configuration() -> serde_json::Value {
    serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "debugBuild": cfg!(debug_assertions),
        "source": "compile-time environment",
        "endpoint": default_updater_endpoint(),
        "publicKey": default_updater_public_key(),
    })
}

fn effective_updater_endpoint(settings: &AppSettings) -> Option<String> {
    settings
        .update_endpoint_override
        .clone()
        .or_else(default_updater_endpoint)
}

/// The pubkey override exists only for local update-feed testing. It takes
/// effect solely when the insecure-endpoint toggle is on and the effective
/// endpoint is loopback. In every other configuration the compiled-in key
/// remains authoritative.
fn pubkey_override_permitted(settings: &AppSettings) -> bool {
    settings.allow_insecure_update_endpoint
        && effective_updater_endpoint(settings)
            .as_deref()
            .is_some_and(is_loopback_update_endpoint)
}

fn effective_updater_public_key(settings: &AppSettings) -> Option<String> {
    settings
        .update_public_key_override
        .clone()
        .filter(|_| pubkey_override_permitted(settings))
        .or_else(default_updater_public_key)
}

fn is_loopback_update_endpoint(endpoint: &str) -> bool {
    Url::parse(endpoint).is_ok_and(|url| {
        url.scheme() == "http"
            && url.username().is_empty()
            && url.password().is_none()
            && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
    })
}

pub(crate) fn build_update_configuration_payload(
    app: &tauri::AppHandle,
    settings: &AppSettings,
) -> UpdateConfigurationPayload {
    build_update_configuration_payload_for_version(current_app_version(app), settings)
}

fn build_update_configuration_payload_for_version(
    current_version: String,
    settings: &AppSettings,
) -> UpdateConfigurationPayload {
    let default_endpoint = default_updater_endpoint();
    let default_pubkey = default_updater_public_key();
    let effective_endpoint = effective_updater_endpoint(settings);
    let effective_pubkey = effective_updater_public_key(settings);

    UpdateConfigurationPayload {
        current_version,
        default_endpoint,
        default_pubkey_available: default_pubkey.is_some(),
        effective_endpoint,
        effective_pubkey_available: effective_pubkey.is_some(),
        using_override_endpoint: settings.update_endpoint_override.is_some(),
        using_override_pubkey: settings.update_public_key_override.is_some()
            && pubkey_override_permitted(settings),
        allow_insecure_update_endpoint: settings.allow_insecure_update_endpoint,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings_with_pubkey_override() -> AppSettings {
        AppSettings {
            update_public_key_override: Some("test override key".to_string()),
            ..AppSettings::default()
        }
    }

    #[test]
    fn loopback_endpoint_detection_accepts_only_local_http_hosts() {
        for endpoint in [
            "http://127.0.0.1:8080/x",
            "http://localhost:9000/latest.json",
            "http://[::1]/f",
        ] {
            assert!(is_loopback_update_endpoint(endpoint), "{endpoint}");
        }
        for endpoint in [
            "https://github.com/example/latest.json",
            "http://192.168.1.5/latest.json",
            "http://evil.example/latest.json",
            "http://localhost.evil.example/latest.json",
            "http://127.0.0.1.evil.example/latest.json",
            "http://127.0.0.1@evil.example/latest.json",
            "http://user@localhost/latest.json",
            "http://127.0.0.10/latest.json",
            "not a URL",
        ] {
            assert!(!is_loopback_update_endpoint(endpoint), "{endpoint}");
        }
    }

    #[test]
    fn pubkey_override_is_ignored_without_insecure_toggle() {
        let settings = settings_with_pubkey_override();
        assert_ne!(
            effective_updater_public_key(&settings).as_deref(),
            settings.update_public_key_override.as_deref()
        );
    }

    #[test]
    fn pubkey_override_is_ignored_for_non_loopback_endpoint() {
        let settings = AppSettings {
            allow_insecure_update_endpoint: true,
            update_endpoint_override: Some("https://attacker.example/latest.json".to_string()),
            ..settings_with_pubkey_override()
        };
        assert_ne!(
            effective_updater_public_key(&settings).as_deref(),
            settings.update_public_key_override.as_deref()
        );
    }

    #[test]
    fn pubkey_override_is_used_for_explicit_loopback_testing() {
        let settings = AppSettings {
            allow_insecure_update_endpoint: true,
            update_endpoint_override: Some("http://127.0.0.1:1430/latest.json".to_string()),
            ..settings_with_pubkey_override()
        };
        assert_eq!(
            effective_updater_public_key(&settings),
            settings.update_public_key_override
        );
    }

    #[test]
    fn configuration_reports_inactive_pubkey_override() {
        let settings = settings_with_pubkey_override();
        let payload = build_update_configuration_payload_for_version("1.2.3".into(), &settings);
        assert!(!payload.using_override_pubkey);
    }

    #[test]
    fn configuration_reports_active_loopback_pubkey_override() {
        let settings = AppSettings {
            allow_insecure_update_endpoint: true,
            update_endpoint_override: Some("http://localhost:1430/latest.json".to_string()),
            ..settings_with_pubkey_override()
        };
        let payload = build_update_configuration_payload_for_version("1.2.3".into(), &settings);
        assert!(payload.using_override_pubkey);
        assert!(payload.effective_pubkey_available);
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

    let endpoint = Url::parse(&endpoint).map_err(|error| {
        AppError::Internal(format!("failed to parse updater endpoint: {error}"))
    })?;

    app.updater_builder()
        .pubkey(pubkey)
        .endpoints(vec![endpoint])
        .map_err(|error| {
            AppError::Internal(format!("failed to configure updater endpoints: {error}"))
        })?
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
