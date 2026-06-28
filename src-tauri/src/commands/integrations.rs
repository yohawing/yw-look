use serde::Serialize;
use std::collections::HashSet;

use crate::commands::loader_packs::{
    load_optional_loader_manifests, OptionalLoaderPackManifest, KNOWN_OPTIONAL_LOADER_EXTENSIONS,
};
use crate::error::AppError;
use crate::shared::{load_or_initialize_settings, FILE_ASSOCIATION_EXTENSIONS};
use crate::state::AppSettings;

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

fn optional_loader_pack_enabled(settings: &AppSettings, pack_id: &str) -> bool {
    settings
        .optional_loader_packs
        .get(pack_id)
        .map(|pack_settings| pack_settings.enabled)
        .unwrap_or(true)
}

fn supported_file_association_extensions(
    settings: &AppSettings,
    manifests: &[OptionalLoaderPackManifest],
) -> Vec<String> {
    let enabled_optional_extensions = manifests
        .iter()
        .filter(|manifest| optional_loader_pack_enabled(settings, &manifest.id))
        .flat_map(|manifest| manifest.extensions.iter().map(String::as_str))
        .collect::<HashSet<_>>();

    FILE_ASSOCIATION_EXTENSIONS
        .iter()
        .filter(|extension| {
            !KNOWN_OPTIONAL_LOADER_EXTENSIONS.contains(extension)
                || enabled_optional_extensions.contains(*extension)
        })
        .map(|extension| format!(".{extension}"))
        .collect()
}

#[tauri::command]
pub(crate) fn load_supported_extensions(
    app: tauri::AppHandle,
) -> Result<IntegrationPayload, AppError> {
    let (_, settings) = load_or_initialize_settings(&app)?;
    let manifests = load_optional_loader_manifests(app)?;

    Ok(IntegrationPayload {
        file_associations_enabled: settings.file_associations_enabled,
        install_strategy: file_association_install_strategy(),
        supported_extensions: supported_file_association_extensions(&settings, &manifests),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::OptionalLoaderPackSettings;

    fn manifest(id: &str, extensions: &[&str]) -> OptionalLoaderPackManifest {
        OptionalLoaderPackManifest {
            id: id.to_string(),
            name: id.to_string(),
            version: "0.1.0".to_string(),
            extensions: extensions
                .iter()
                .map(|extension| (*extension).to_string())
                .collect(),
            entry: "loader.js".to_string(),
            pack_path: "pack".to_string(),
            entry_path: "pack/loader.js".to_string(),
        }
    }

    #[test]
    fn supported_extensions_exclude_missing_optional_loader_packs() {
        let settings = AppSettings::default();

        let extensions = supported_file_association_extensions(&settings, &[]);

        assert!(extensions.contains(&".glb".to_string()));
        assert!(!extensions.contains(&".pmx".to_string()));
        assert!(!extensions.contains(&".splat".to_string()));
    }

    #[test]
    fn supported_extensions_include_enabled_installed_optional_loader_packs() {
        let settings = AppSettings::default();
        let manifests = vec![manifest("mmd-loader-pack", &["pmd", "pmx", "vmd"])];

        let extensions = supported_file_association_extensions(&settings, &manifests);

        assert!(extensions.contains(&".pmx".to_string()));
        assert!(extensions.contains(&".pmd".to_string()));
        assert!(extensions.contains(&".vmd".to_string()));
    }

    #[test]
    fn supported_extensions_exclude_disabled_optional_loader_packs() {
        let settings = AppSettings {
            optional_loader_packs: std::iter::once((
                "mmd-loader-pack".to_string(),
                OptionalLoaderPackSettings { enabled: false },
            ))
            .collect(),
            ..AppSettings::default()
        };
        let manifests = vec![manifest("mmd-loader-pack", &["pmd", "pmx", "vmd"])];

        let extensions = supported_file_association_extensions(&settings, &manifests);

        assert!(extensions.contains(&".glb".to_string()));
        assert!(!extensions.contains(&".pmx".to_string()));
        assert!(!extensions.contains(&".pmd".to_string()));
        assert!(!extensions.contains(&".vmd".to_string()));
    }
}
