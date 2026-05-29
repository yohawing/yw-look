use serde::Serialize;

use crate::shared::{load_or_initialize_settings, FILE_ASSOCIATION_EXTENSIONS};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IntegrationPayload {
    pub(crate) file_associations_enabled: bool,
    pub(crate) install_strategy: String,
    pub(crate) supported_extensions: Vec<String>,
}

fn file_association_install_strategy() -> String {
    #[cfg(windows)]
    {
        return "NSIS and MSI installers register supported file associations on Windows. The runtime toggle remains as a local preference until installer-level opt-in wiring is added.".to_string();
    }

    #[cfg(target_os = "macos")]
    {
        return "macOS bundles register supported document types through CFBundleDocumentTypes. Runtime file-association toggles are not used on macOS.".to_string();
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        return "This platform does not currently install file associations.".to_string();
    }
}

#[tauri::command]
pub(crate) fn load_supported_extensions(app: tauri::AppHandle) -> Result<IntegrationPayload, String> {
    let (_, settings) = load_or_initialize_settings(&app)?;

    Ok(IntegrationPayload {
        file_associations_enabled: settings.file_associations_enabled,
        install_strategy: file_association_install_strategy(),
        supported_extensions: FILE_ASSOCIATION_EXTENSIONS
            .iter()
            .map(|extension| format!(".{extension}"))
            .collect(),
    })
}
