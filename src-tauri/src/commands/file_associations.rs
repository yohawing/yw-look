#![allow(dead_code)]

use std::collections::BTreeSet;

use crate::commands::loader_packs::{OptionalLoaderPackManifest, KNOWN_OPTIONAL_LOADER_EXTENSIONS};
use crate::shared::{model_extensions, motion_extensions, texture_extensions};
use crate::state::AppSettings;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FileAssociationPlan {
    pub(crate) core_extensions: Vec<String>,
    pub(crate) optional_extensions: Vec<String>,
    pub(crate) effective_extensions: Vec<String>,
}

fn is_known_optional_extension(extension: &str) -> bool {
    KNOWN_OPTIONAL_LOADER_EXTENSIONS.contains(&extension)
}

fn pack_enabled(settings: &AppSettings, pack_id: &str) -> bool {
    settings
        .optional_loader_packs
        .get(pack_id)
        .map(|pack| pack.enabled)
        .unwrap_or(true)
}

pub(crate) fn resolve_core_extensions() -> Vec<String> {
    let mut extensions = BTreeSet::new();

    for extension in model_extensions()
        .iter()
        .chain(texture_extensions().iter())
        .chain(motion_extensions().iter())
    {
        if !is_known_optional_extension(extension) {
            extensions.insert(extension.clone());
        }
    }

    extensions.into_iter().collect()
}

pub(crate) fn resolve_file_association_plan(
    settings: &AppSettings,
    manifests: &[OptionalLoaderPackManifest],
) -> FileAssociationPlan {
    let core_extensions = resolve_core_extensions();
    let mut optional_extensions = BTreeSet::new();

    for manifest in manifests {
        if manifest.compatibility.state != "compatible" {
            continue;
        }
        if !pack_enabled(settings, &manifest.id) {
            continue;
        }
        for extension in &manifest.extensions {
            optional_extensions.insert(extension.clone());
        }
    }

    let optional_extensions: Vec<String> = optional_extensions.into_iter().collect();
    let effective_extensions = if settings.file_associations_enabled {
        let mut effective = BTreeSet::new();
        effective.extend(core_extensions.iter().cloned());
        effective.extend(optional_extensions.iter().cloned());
        effective.into_iter().collect()
    } else {
        Vec::new()
    };

    FileAssociationPlan {
        core_extensions,
        optional_extensions,
        effective_extensions,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::commands::loader_packs::OptionalLoaderPackCompatibility;
    use crate::state::OptionalLoaderPackSettings;

    fn compatible_manifest(id: &str, extensions: &[&str]) -> OptionalLoaderPackManifest {
        OptionalLoaderPackManifest {
            id: id.to_string(),
            name: "Test Pack".to_string(),
            version: "0.1.0".to_string(),
            minimum_app_version: None,
            maximum_app_version: None,
            compatibility: OptionalLoaderPackCompatibility {
                state: "compatible".to_string(),
                message: None,
            },
            extensions: extensions
                .iter()
                .map(|extension| (*extension).to_string())
                .collect(),
            entry: "loader.js".to_string(),
            pack_path: "/test".to_string(),
            entry_path: "/test/loader.js".to_string(),
        }
    }

    fn incompatible_manifest(id: &str, extensions: &[&str]) -> OptionalLoaderPackManifest {
        let mut manifest = compatible_manifest(id, extensions);
        manifest.compatibility.state = "incompatible".to_string();
        manifest.compatibility.message = Some("incompatible".to_string());
        manifest
    }

    fn settings_with_associations_enabled(
        optional_loader_packs: BTreeMap<String, OptionalLoaderPackSettings>,
    ) -> AppSettings {
        AppSettings {
            file_associations_enabled: true,
            optional_loader_packs,
            ..AppSettings::default()
        }
    }

    #[test]
    fn disabled_global_setting_returns_empty_effective_extensions() {
        let plan = resolve_file_association_plan(
            &AppSettings::default(),
            &[compatible_manifest(
                "mmd-loader-pack",
                &["pmd", "pmx", "vmd"],
            )],
        );

        assert!(!plan.core_extensions.is_empty());
        assert_eq!(plan.optional_extensions, vec!["pmd", "pmx", "vmd"]);
        assert!(plan.effective_extensions.is_empty());
    }

    #[test]
    fn core_extensions_exclude_optional_but_retain_abc_and_ply() {
        let core_extensions = resolve_core_extensions();

        for extension in KNOWN_OPTIONAL_LOADER_EXTENSIONS {
            assert!(
                !core_extensions.iter().any(|value| value == extension),
                "core extensions must not include optional extension: {extension}"
            );
        }

        assert!(core_extensions.iter().any(|value| value == "abc"));
        assert!(core_extensions.iter().any(|value| value == "ply"));
    }

    #[test]
    fn enabled_compatible_mmd_manifest_includes_mmd_extensions() {
        let plan = resolve_file_association_plan(
            &settings_with_associations_enabled(BTreeMap::new()),
            &[compatible_manifest(
                "mmd-loader-pack",
                &["pmd", "pmx", "vmd"],
            )],
        );

        assert_eq!(plan.optional_extensions, vec!["pmd", "pmx", "vmd"]);
        for extension in ["pmd", "pmx", "vmd"] {
            assert!(plan
                .effective_extensions
                .iter()
                .any(|value| value == extension));
        }
    }

    #[test]
    fn disabled_mmd_setting_excludes_mmd_optional_extensions() {
        let mut optional_loader_packs = BTreeMap::new();
        optional_loader_packs.insert(
            "mmd-loader-pack".to_string(),
            OptionalLoaderPackSettings { enabled: false },
        );

        let plan = resolve_file_association_plan(
            &settings_with_associations_enabled(optional_loader_packs),
            &[compatible_manifest(
                "mmd-loader-pack",
                &["pmd", "pmx", "vmd"],
            )],
        );

        assert!(plan.optional_extensions.is_empty());
        for extension in ["pmd", "pmx", "vmd"] {
            assert!(!plan
                .effective_extensions
                .iter()
                .any(|value| value == extension));
        }
    }

    #[test]
    fn enabled_compatible_gaussian_manifest_includes_splat_extensions_but_not_ply() {
        let plan = resolve_file_association_plan(
            &settings_with_associations_enabled(BTreeMap::new()),
            &[compatible_manifest(
                "gaussian-splat-loader-pack",
                &["splat", "spz", "ksplat", "sog"],
            )],
        );

        assert_eq!(
            plan.optional_extensions,
            vec!["ksplat", "sog", "splat", "spz"]
        );
        for extension in ["splat", "spz", "ksplat", "sog"] {
            assert!(plan
                .effective_extensions
                .iter()
                .any(|value| value == extension));
        }
        assert!(!plan.optional_extensions.iter().any(|value| value == "ply"));
        assert!(plan.core_extensions.iter().any(|value| value == "ply"));
        assert!(plan.effective_extensions.iter().any(|value| value == "ply"));
    }

    #[test]
    fn enabled_compatible_vrm_manifest_includes_vrm_extensions() {
        let plan = resolve_file_association_plan(
            &settings_with_associations_enabled(BTreeMap::new()),
            &[compatible_manifest("vrm-loader-pack", &["vrm", "vrma"])],
        );

        assert_eq!(plan.optional_extensions, vec!["vrm", "vrma"]);
        for extension in ["vrm", "vrma"] {
            assert!(plan
                .effective_extensions
                .iter()
                .any(|value| value == extension));
        }
    }

    #[test]
    fn incompatible_manifest_excludes_that_pack() {
        let plan = resolve_file_association_plan(
            &settings_with_associations_enabled(BTreeMap::new()),
            &[incompatible_manifest(
                "mmd-loader-pack",
                &["pmd", "pmx", "vmd"],
            )],
        );

        assert!(plan.optional_extensions.is_empty());
        for extension in ["pmd", "pmx", "vmd"] {
            assert!(!plan
                .effective_extensions
                .iter()
                .any(|value| value == extension));
        }
    }
}
