use std::collections::BTreeSet;
#[cfg(any(target_os = "windows", test))]
use std::path::Path;
#[cfg(any(target_os = "windows", test))]
use std::sync::Mutex;

use serde::Serialize;

#[cfg(target_os = "windows")]
use crate::commands::loader_packs::load_optional_loader_manifests;
use crate::commands::loader_packs::{OptionalLoaderPackManifest, KNOWN_OPTIONAL_LOADER_EXTENSIONS};
use crate::error::AppError;
#[cfg(target_os = "windows")]
use crate::shared::load_or_initialize_settings;
use crate::shared::{model_extensions, motion_extensions, texture_extensions};
use crate::state::AppSettings;

#[cfg(any(target_os = "windows", test))]
const REGISTERED_APP_NAME: &str = "yw-look";
#[cfg(any(target_os = "windows", test))]
const REGISTERED_APPLICATIONS_PATH: &str = r"Software\RegisteredApplications";
#[cfg(any(target_os = "windows", test))]
const CAPABILITIES_PATH: &str = r"Software\yw-look\Capabilities";
#[cfg(any(target_os = "windows", test))]
const FILE_ASSOCIATIONS_PATH: &str = r"Software\yw-look\Capabilities\FileAssociations";
#[cfg(any(target_os = "windows", test))]
const PROG_ID_PREFIX: &str = "Yohawing.YwLook.Asset";
#[cfg(any(target_os = "windows", test))]
const LEGACY_PROG_ID: &str = "Yohawing.YwLook.Asset.1";
#[cfg(any(target_os = "windows", test))]
const CLASSES_PATH: &str = r"Software\Classes";
#[cfg(any(target_os = "windows", test))]
const DEFAULT_APPS_SETTINGS_URI: &str = "ms-settings:defaultapps";

#[cfg(target_os = "windows")]
static FILE_ASSOCIATION_REGISTRY_LOCK: Mutex<()> = Mutex::new(());

#[cfg_attr(test, derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileAssociationSyncResult {
    pub(crate) platform: String,
    pub(crate) supported: bool,
    pub(crate) effective_extensions: Vec<String>,
    pub(crate) requires_user_confirmation: bool,
    pub(crate) message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FileAssociationPlan {
    pub(crate) core_extensions: Vec<String>,
    pub(crate) optional_extensions: Vec<String>,
    pub(crate) effective_extensions: Vec<String>,
}

#[cfg(any(target_os = "windows", test))]
#[derive(Debug, Clone, PartialEq, Eq)]
enum RegistryOperation {
    SetValue {
        key: String,
        name: String,
        value: String,
    },
    DeleteValue {
        key: String,
        name: String,
    },
    DeleteTree {
        key: String,
    },
}

#[cfg(any(target_os = "windows", test))]
fn normalized_extension(extension: &str) -> Option<String> {
    let extension = extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if extension.is_empty() || !extension.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return None;
    }
    Some(extension)
}

#[cfg(any(target_os = "windows", test))]
fn quoted_open_command(executable: &Path) -> String {
    format!(r#""{}" "%1""#, executable.display())
}

#[cfg(any(target_os = "windows", test))]
fn quoted_default_icon(executable: &Path) -> String {
    format!(r#""{}",0"#, executable.display())
}

#[cfg(any(target_os = "windows", test))]
fn prog_id_for_extension(extension: &str) -> String {
    format!("{PROG_ID_PREFIX}.{extension}.1")
}

#[cfg(any(target_os = "windows", test))]
fn prog_id_path(prog_id: &str) -> String {
    format!(r"{CLASSES_PATH}\{prog_id}")
}

#[cfg(any(target_os = "windows", test))]
fn managed_extensions() -> BTreeSet<String> {
    resolve_core_extensions()
        .into_iter()
        .chain(
            KNOWN_OPTIONAL_LOADER_EXTENSIONS
                .iter()
                .map(|extension| (*extension).to_string()),
        )
        .filter_map(|extension| normalized_extension(&extension))
        .collect()
}

#[cfg(any(target_os = "windows", test))]
fn build_registry_operations(
    executable: &Path,
    enabled: bool,
    effective_extensions: &[String],
) -> Vec<RegistryOperation> {
    let managed_extensions = managed_extensions();
    let desired_extensions = effective_extensions
        .iter()
        .filter_map(|extension| normalized_extension(extension))
        .filter(|extension| managed_extensions.contains(extension))
        .collect::<BTreeSet<_>>();
    let mut operations = vec![
        RegistryOperation::DeleteValue {
            key: REGISTERED_APPLICATIONS_PATH.to_string(),
            name: REGISTERED_APP_NAME.to_string(),
        },
        RegistryOperation::DeleteTree {
            key: CAPABILITIES_PATH.to_string(),
        },
        RegistryOperation::DeleteTree {
            key: prog_id_path(LEGACY_PROG_ID),
        },
    ];
    operations.extend(
        managed_extensions
            .iter()
            .map(|extension| RegistryOperation::DeleteTree {
                key: prog_id_path(&prog_id_for_extension(extension)),
            }),
    );

    if !enabled {
        return operations;
    }

    operations.extend([
        RegistryOperation::SetValue {
            key: CAPABILITIES_PATH.to_string(),
            name: "ApplicationName".to_string(),
            value: REGISTERED_APP_NAME.to_string(),
        },
        RegistryOperation::SetValue {
            key: CAPABILITIES_PATH.to_string(),
            name: "ApplicationDescription".to_string(),
            value: "Quick look style asset viewer for CG workflows".to_string(),
        },
        RegistryOperation::SetValue {
            key: CAPABILITIES_PATH.to_string(),
            name: "ApplicationIcon".to_string(),
            value: quoted_default_icon(executable),
        },
    ]);

    for extension in &desired_extensions {
        let prog_id = prog_id_for_extension(extension);
        let prog_id_path = prog_id_path(&prog_id);
        operations.extend([
            RegistryOperation::SetValue {
                key: prog_id_path.clone(),
                name: String::new(),
                value: format!("yw-look .{extension} asset file"),
            },
            RegistryOperation::SetValue {
                key: format!(r"{prog_id_path}\DefaultIcon"),
                name: String::new(),
                value: quoted_default_icon(executable),
            },
            RegistryOperation::SetValue {
                key: format!(r"{prog_id_path}\shell\open\command"),
                name: String::new(),
                value: quoted_open_command(executable),
            },
        ]);
        operations.push(RegistryOperation::SetValue {
            key: FILE_ASSOCIATIONS_PATH.to_string(),
            name: format!(".{extension}"),
            value: prog_id,
        });
    }

    operations.push(RegistryOperation::SetValue {
        key: REGISTERED_APPLICATIONS_PATH.to_string(),
        name: REGISTERED_APP_NAME.to_string(),
        value: CAPABILITIES_PATH.to_string(),
    });

    operations
}

#[cfg(any(not(target_os = "windows"), test))]
fn platform_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "other"
    }
}

#[cfg(any(not(target_os = "windows"), test))]
fn unsupported_result(
    effective_extensions: Vec<String>,
    action: &str,
) -> FileAssociationSyncResult {
    FileAssociationSyncResult {
        platform: platform_name().to_string(),
        supported: false,
        effective_extensions,
        requires_user_confirmation: false,
        message: format!(
            "{action} is unsupported on this platform; signed bundle file associations remain unchanged."
        ),
    }
}

#[cfg(any(target_os = "windows", test))]
fn synced_result(effective_extensions: Vec<String>, enabled: bool) -> FileAssociationSyncResult {
    FileAssociationSyncResult {
        platform: "windows".to_string(),
        supported: true,
        effective_extensions,
        requires_user_confirmation: true,
        message: if enabled {
            "File association candidates were registered for yw-look. Choose defaults in Windows Settings to confirm them."
                .to_string()
        } else {
            "yw-look file association candidates were removed. Existing Windows defaults still require user confirmation to change."
                .to_string()
        },
    }
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

#[cfg(target_os = "windows")]
fn registry_error(context: &str, error: std::io::Error) -> AppError {
    AppError::Io(format!("{context}: {error}"))
}

#[cfg(target_os = "windows")]
fn ignore_missing_registry_entry(result: std::io::Result<()>) -> std::io::Result<()> {
    match result {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

#[cfg(target_os = "windows")]
fn apply_registry_operations(operations: &[RegistryOperation]) -> Result<(), AppError> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for operation in operations {
        match operation {
            RegistryOperation::SetValue { key, name, value } => {
                let (registry_key, _) = hkcu.create_subkey(key).map_err(|error| {
                    registry_error(&format!("failed to create HKCU\\{key}"), error)
                })?;
                registry_key.set_value(name, value).map_err(|error| {
                    registry_error(&format!("failed to set HKCU\\{key} value '{name}'"), error)
                })?;
            }
            RegistryOperation::DeleteValue { key, name } => {
                let registry_key = match hkcu
                    .open_subkey_with_flags(key, winreg::enums::KEY_READ | winreg::enums::KEY_WRITE)
                {
                    Ok(registry_key) => registry_key,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(error) => {
                        return Err(registry_error(
                            &format!("failed to open HKCU\\{key}"),
                            error,
                        ));
                    }
                };
                ignore_missing_registry_entry(registry_key.delete_value(name)).map_err(
                    |error| {
                        registry_error(
                            &format!("failed to delete HKCU\\{key} value '{name}'"),
                            error,
                        )
                    },
                )?;
            }
            RegistryOperation::DeleteTree { key } => {
                ignore_missing_registry_entry(hkcu.delete_subkey_all(key)).map_err(|error| {
                    registry_error(&format!("failed to delete HKCU\\{key}"), error)
                })?;
            }
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn notify_shell_associations_changed() {
    use std::ptr::null;
    use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};

    unsafe {
        SHChangeNotify(SHCNE_ASSOCCHANGED as i32, SHCNF_IDLIST, null(), null());
    }
}

#[cfg(any(target_os = "windows", test))]
fn apply_and_notify<F, N>(
    operations: &[RegistryOperation],
    apply: F,
    notify: N,
) -> Result<(), AppError>
where
    F: FnOnce(&[RegistryOperation]) -> Result<(), AppError>,
    N: FnOnce(),
{
    let result = apply(operations);
    notify();
    result
}

#[cfg(any(target_os = "windows", test))]
fn with_registry_mutation_lock<T, F>(lock: &Mutex<()>, mutate: F) -> Result<T, AppError>
where
    F: FnOnce() -> Result<T, AppError>,
{
    let _guard = lock.lock().map_err(|_| {
        AppError::Internal("file association registry synchronization lock is poisoned".to_string())
    })?;
    mutate()
}

#[tauri::command]
pub(crate) fn sync_file_associations(
    app: tauri::AppHandle,
) -> Result<FileAssociationSyncResult, AppError> {
    #[cfg(target_os = "windows")]
    {
        let (effective_extensions, enabled) =
            with_registry_mutation_lock(&FILE_ASSOCIATION_REGISTRY_LOCK, || {
                let (_, settings) = load_or_initialize_settings(&app)?;
                let manifests = load_optional_loader_manifests(app)?;
                let plan = resolve_file_association_plan(&settings, &manifests);
                let enabled = settings.file_associations_enabled;
                let executable = std::env::current_exe().map_err(|error| {
                    AppError::Io(format!("failed to resolve yw-look executable: {error}"))
                })?;
                let operations =
                    build_registry_operations(&executable, enabled, &plan.effective_extensions);
                apply_and_notify(
                    &operations,
                    apply_registry_operations,
                    notify_shell_associations_changed,
                )?;
                Ok((plan.effective_extensions, enabled))
            })?;
        return Ok(synced_result(effective_extensions, enabled));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(unsupported_result(
            Vec::new(),
            "File association synchronization",
        ))
    }
}

#[tauri::command]
pub(crate) fn open_default_apps_settings() -> Result<FileAssociationSyncResult, AppError> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg(DEFAULT_APPS_SETTINGS_URI)
            .spawn()
            .map_err(|error| {
                AppError::Io(format!(
                    "failed to open Windows Default Apps settings: {error}"
                ))
            })?;
        return Ok(FileAssociationSyncResult {
            platform: "windows".to_string(),
            supported: true,
            effective_extensions: Vec::new(),
            requires_user_confirmation: true,
            message: "Windows Default Apps settings were opened.".to_string(),
        });
    }

    #[cfg(not(target_os = "windows"))]
    Ok(unsupported_result(
        Vec::new(),
        "Opening Windows Default Apps settings",
    ))
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

    #[test]
    fn registry_plan_quotes_executable_and_file_argument() {
        let executable = Path::new(r"C:\Program Files\yw-look\yw-look.exe");
        let operations = build_registry_operations(executable, true, &["usd".to_string()]);

        assert!(operations.iter().any(|operation| {
            matches!(
                operation,
                RegistryOperation::SetValue { key, name, value }
                    if key == r"Software\Classes\Yohawing.YwLook.Asset.usd.1\shell\open\command"
                        && name.is_empty()
                        && value == r#""C:\Program Files\yw-look\yw-look.exe" "%1""#
            )
        }));
    }

    #[test]
    fn registry_plan_unpublishes_first_and_publishes_last() {
        let operations = build_registry_operations(
            Path::new(r"C:\Apps\yw-look.exe"),
            true,
            &["pmx".to_string(), "usd".to_string()],
        );

        assert_eq!(
            operations[0],
            RegistryOperation::DeleteValue {
                key: REGISTERED_APPLICATIONS_PATH.to_string(),
                name: REGISTERED_APP_NAME.to_string(),
            }
        );
        assert_eq!(
            operations.last(),
            Some(&RegistryOperation::SetValue {
                key: REGISTERED_APPLICATIONS_PATH.to_string(),
                name: REGISTERED_APP_NAME.to_string(),
                value: CAPABILITIES_PATH.to_string(),
            })
        );
    }

    #[test]
    fn registry_plan_recreates_independent_valid_progids() {
        let operations = build_registry_operations(
            Path::new(r"C:\Apps\yw-look.exe"),
            true,
            &["pmx".to_string(), "usd".to_string()],
        );

        for extension in ["pmx", "usd"] {
            let prog_id = prog_id_for_extension(extension);
            assert!(operations.contains(&RegistryOperation::SetValue {
                key: FILE_ASSOCIATIONS_PATH.to_string(),
                name: format!(".{extension}"),
                value: prog_id.clone(),
            }));
            assert!(operations.contains(&RegistryOperation::SetValue {
                key: prog_id_path(&prog_id),
                name: String::new(),
                value: format!("yw-look .{extension} asset file"),
            }));
            assert!(!prog_id.contains('-'));
            assert!(prog_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.'));
            assert!(prog_id.ends_with(&format!(".{extension}.1")));
        }
        assert_ne!(prog_id_for_extension("pmx"), prog_id_for_extension("usd"));
    }

    #[test]
    fn registry_plan_cleans_all_managed_and_legacy_progids_before_recreating_desired() {
        let operations = build_registry_operations(
            Path::new(r"C:\Apps\yw-look.exe"),
            true,
            &["usd".to_string()],
        );

        assert!(operations.contains(&RegistryOperation::DeleteTree {
            key: prog_id_path(LEGACY_PROG_ID),
        }));
        for extension in managed_extensions() {
            assert!(operations.contains(&RegistryOperation::DeleteTree {
                key: prog_id_path(&prog_id_for_extension(&extension)),
            }));
        }
        assert!(operations.contains(&RegistryOperation::SetValue {
            key: FILE_ASSOCIATIONS_PATH.to_string(),
            name: ".usd".to_string(),
            value: prog_id_for_extension("usd"),
        }));
        assert!(!operations.iter().any(|operation| matches!(
            operation,
            RegistryOperation::SetValue { key, .. }
                if key.starts_with(&prog_id_path(&prog_id_for_extension("pmx")))
        )));
        assert!(!operations.contains(&RegistryOperation::SetValue {
            key: FILE_ASSOCIATIONS_PATH.to_string(),
            name: ".pmx".to_string(),
            value: prog_id_for_extension("pmx"),
        }));
    }

    #[test]
    fn registry_plan_keeps_core_desired_when_optional_extension_is_absent() {
        let core_extension = resolve_core_extensions()
            .into_iter()
            .next()
            .expect("at least one core extension");
        let optional_extension = KNOWN_OPTIONAL_LOADER_EXTENSIONS[0];
        let operations = build_registry_operations(
            Path::new(r"C:\Apps\yw-look.exe"),
            true,
            std::slice::from_ref(&core_extension),
        );

        assert!(operations.contains(&RegistryOperation::SetValue {
            key: FILE_ASSOCIATIONS_PATH.to_string(),
            name: format!(".{core_extension}"),
            value: prog_id_for_extension(&core_extension),
        }));
        assert!(operations.contains(&RegistryOperation::DeleteTree {
            key: prog_id_path(&prog_id_for_extension(optional_extension)),
        }));
        assert!(!operations.iter().any(|operation| matches!(
            operation,
            RegistryOperation::SetValue { key, name, .. }
                if key == FILE_ASSOCIATIONS_PATH && name == &format!(".{optional_extension}")
        )));
    }

    #[test]
    fn registry_plan_ignores_extensions_outside_managed_universe() {
        let operations = build_registry_operations(
            Path::new(r"C:\Apps\yw-look.exe"),
            true,
            &["foreign".to_string()],
        );

        assert!(!operations.iter().any(|operation| matches!(
            operation,
            RegistryOperation::SetValue { name, value, .. }
                if name == ".foreign" || value.contains(".foreign.")
        )));
        assert!(!operations.contains(&RegistryOperation::DeleteTree {
            key: prog_id_path(&prog_id_for_extension("foreign")),
        }));
    }

    #[test]
    fn registry_plan_preserves_unrelated_application_boundaries() {
        let operations = build_registry_operations(
            Path::new(r"C:\Apps\yw-look.exe"),
            true,
            &["usd".to_string()],
        );
        let managed_prog_id_paths = managed_extensions()
            .iter()
            .map(|extension| prog_id_path(&prog_id_for_extension(extension)))
            .collect::<Vec<_>>();
        let legacy_prog_id_path = prog_id_path(LEGACY_PROG_ID);

        for operation in operations {
            let (key, registered_value_name) = match operation {
                RegistryOperation::SetValue { key, name, .. } => (key, Some(name)),
                RegistryOperation::DeleteValue { key, name } => (key, Some(name)),
                RegistryOperation::DeleteTree { key } => (key, None),
            };
            assert!(
                key == REGISTERED_APPLICATIONS_PATH
                    || key.starts_with(CAPABILITIES_PATH)
                    || key.starts_with(&legacy_prog_id_path)
                    || managed_prog_id_paths
                        .iter()
                        .any(|path| key.starts_with(path)),
                "operation escaped yw-look-owned registry boundary: {key}"
            );
            if key == REGISTERED_APPLICATIONS_PATH {
                assert_eq!(registered_value_name.as_deref(), Some(REGISTERED_APP_NAME));
            }
        }
    }

    #[test]
    fn disabled_registry_plan_removes_registration_and_owned_progids() {
        let operations = build_registry_operations(Path::new(r"C:\Apps\yw-look.exe"), false, &[]);

        assert_eq!(
            operations[0],
            RegistryOperation::DeleteValue {
                key: REGISTERED_APPLICATIONS_PATH.to_string(),
                name: REGISTERED_APP_NAME.to_string(),
            }
        );
        assert!(operations.contains(&RegistryOperation::DeleteTree {
            key: CAPABILITIES_PATH.to_string(),
        }));
        assert!(operations.contains(&RegistryOperation::DeleteTree {
            key: prog_id_path(LEGACY_PROG_ID),
        }));
        for extension in managed_extensions() {
            assert!(operations.contains(&RegistryOperation::DeleteTree {
                key: prog_id_path(&prog_id_for_extension(&extension)),
            }));
        }
        assert!(!operations
            .iter()
            .any(|operation| matches!(operation, RegistryOperation::SetValue { .. })));
    }

    #[test]
    fn disabled_sync_result_conservatively_requires_user_confirmation() {
        let result = synced_result(Vec::new(), false);

        assert!(result.requires_user_confirmation);
        assert!(result.message.contains("require user confirmation"));
    }

    #[test]
    fn successful_registry_apply_notifies_the_shell() {
        use std::cell::Cell;

        let applied = Cell::new(false);
        let notified = Cell::new(false);
        apply_and_notify(
            &[],
            |_| {
                applied.set(true);
                Ok(())
            },
            || notified.set(true),
        )
        .expect("apply and notify");

        assert!(applied.get());
        assert!(notified.get());
    }

    #[test]
    fn failed_registry_apply_still_notifies_the_shell() {
        use std::cell::Cell;

        let notified = Cell::new(false);
        let result = apply_and_notify(
            &[],
            |_| Err(AppError::Internal("apply failed".to_string())),
            || notified.set(true),
        );

        assert!(result.is_err());
        assert!(notified.get());
    }

    #[test]
    fn registry_mutation_lock_serializes_parallel_sync_sections() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::{Arc, Barrier};

        let lock = Arc::new(Mutex::new(()));
        let barrier = Arc::new(Barrier::new(9));
        let active = Arc::new(AtomicUsize::new(0));
        let max_active = Arc::new(AtomicUsize::new(0));
        let mut workers = Vec::new();

        for _ in 0..8 {
            let lock = Arc::clone(&lock);
            let barrier = Arc::clone(&barrier);
            let active = Arc::clone(&active);
            let max_active = Arc::clone(&max_active);
            workers.push(std::thread::spawn(move || {
                barrier.wait();
                with_registry_mutation_lock(&lock, || {
                    let current = active.fetch_add(1, Ordering::SeqCst) + 1;
                    max_active.fetch_max(current, Ordering::SeqCst);
                    std::thread::yield_now();
                    active.fetch_sub(1, Ordering::SeqCst);
                    Ok(())
                })
                .expect("serialized registry mutation");
            }));
        }

        barrier.wait();
        for worker in workers {
            worker.join().expect("registry mutation worker");
        }

        assert_eq!(max_active.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn poisoned_registry_mutation_lock_returns_app_error() {
        use std::sync::Arc;

        let lock = Arc::new(Mutex::new(()));
        let poisoned_lock = Arc::clone(&lock);
        let _ = std::thread::spawn(move || {
            let _guard = poisoned_lock.lock().expect("initial lock");
            panic!("poison test lock");
        })
        .join();

        let result = with_registry_mutation_lock(&lock, || Ok(()));

        assert!(matches!(
            result,
            Err(AppError::Internal(message)) if message.contains("lock is poisoned")
        ));
    }

    #[test]
    fn unsupported_result_is_explicit_and_non_mutating() {
        let result = unsupported_result(vec!["usd".to_string()], "test action");

        assert!(!result.supported);
        assert_eq!(result.effective_extensions, vec!["usd"]);
        assert!(!result.requires_user_confirmation);
        assert!(result.message.contains("unsupported"));
        assert!(result.message.contains("signed bundle"));
    }

    #[test]
    fn default_apps_uri_uses_windows_10_compatible_base_page() {
        assert_eq!(DEFAULT_APPS_SETTINGS_URI, "ms-settings:defaultapps");
    }
}
