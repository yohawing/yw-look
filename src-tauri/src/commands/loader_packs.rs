use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

use crate::error::AppError;
use crate::shared::{resolve_app_data_dir, strip_verbatim_prefix};

const OPTIONAL_LOADERS_DIR_NAME: &str = "optional-loaders";
const LOADER_PACK_KIND: &str = "firstPartyLoaderPack";
const LOADER_PACK_REMOVED_MARKER: &str = ".removed";
const KNOWN_OPTIONAL_LOADER_PACK_IDS: &[&str] = &[
    "vrm-loader-pack",
    "mmd-loader-pack",
    "gaussian-splat-loader-pack",
];
pub(crate) const KNOWN_OPTIONAL_LOADER_EXTENSIONS: &[&str] = &[
    "vrm", "vrma", "pmd", "pmx", "vmd", "splat", "spz", "ksplat", "sog",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptionalLoaderPackManifestRaw {
    id: String,
    name: String,
    version: String,
    minimum_app_version: Option<String>,
    maximum_app_version: Option<String>,
    extensions: Vec<String>,
    entry: String,
    kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OptionalLoaderPackCompatibility {
    pub(crate) state: String,
    pub(crate) message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OptionalLoaderPackManifest {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) minimum_app_version: Option<String>,
    pub(crate) maximum_app_version: Option<String>,
    pub(crate) compatibility: OptionalLoaderPackCompatibility,
    pub(crate) extensions: Vec<String>,
    pub(crate) entry: String,
    pub(crate) pack_path: String,
    pub(crate) entry_path: String,
}

pub(crate) fn known_pack_extensions(id: &str) -> Option<&'static [&'static str]> {
    match id {
        "vrm-loader-pack" => Some(&["vrm", "vrma"]),
        "mmd-loader-pack" => Some(&["pmd", "pmx", "vmd"]),
        "gaussian-splat-loader-pack" => Some(&["splat", "spz", "ksplat", "sog"]),
        _ => None,
    }
}

fn known_pack_name(id: &str) -> Option<&'static str> {
    match id {
        "vrm-loader-pack" => Some("VRM Loader Pack"),
        "mmd-loader-pack" => Some("MMD Loader Pack"),
        "gaussian-splat-loader-pack" => Some("Gaussian Splat Loader Pack"),
        _ => None,
    }
}

fn known_pack_dir_name(id: &str) -> Option<&'static str> {
    match id {
        "vrm-loader-pack" => Some("vrm"),
        "mmd-loader-pack" => Some("mmd"),
        "gaussian-splat-loader-pack" => Some("gaussian-splat"),
        _ => None,
    }
}

fn known_pack_manifest_json(id: &str) -> Result<String, AppError> {
    let name = known_pack_name(id)
        .ok_or_else(|| AppError::Internal(format!("unknown optional loader pack: {id}")))?;
    let extensions = known_pack_extensions(id)
        .ok_or_else(|| AppError::Internal(format!("unknown optional loader pack: {id}")))?;
    serde_json::to_string_pretty(&serde_json::json!({
        "id": id,
        "name": name,
        "version": env!("CARGO_PKG_VERSION"),
        "minimumAppVersion": env!("CARGO_PKG_VERSION"),
        "extensions": extensions,
        "entry": "loader.js",
        "kind": LOADER_PACK_KIND,
    }))
    .map_err(|error| AppError::Serde(format!("failed to serialize loader pack manifest: {error}")))
}

fn optional_loaders_dir_from_app_data_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(OPTIONAL_LOADERS_DIR_NAME)
}

fn optional_loader_pack_dir(root: &Path, id: &str) -> Result<PathBuf, AppError> {
    let dir_name = known_pack_dir_name(id)
        .ok_or_else(|| AppError::Internal(format!("unknown optional loader pack: {id}")))?;
    Ok(root.join(dir_name))
}

fn removed_loader_pack_ids(app_managed_dir: &Path) -> Result<HashSet<String>, AppError> {
    let mut removed_ids = HashSet::new();

    for id in KNOWN_OPTIONAL_LOADER_PACK_IDS {
        let pack_dir = optional_loader_pack_dir(app_managed_dir, id)?;
        if pack_dir.join(LOADER_PACK_REMOVED_MARKER).is_file() {
            removed_ids.insert((*id).to_string());
        }
    }

    Ok(removed_ids)
}

fn normalize_extensions(id: &str, extensions: Vec<String>) -> Option<Vec<String>> {
    let allowed = known_pack_extensions(id)?;
    let mut normalized = Vec::with_capacity(extensions.len());

    for extension in extensions {
        let extension = extension
            .trim()
            .trim_start_matches('.')
            .to_ascii_lowercase();
        if extension.is_empty() || !allowed.contains(&extension.as_str()) {
            return None;
        }
        normalized.push(extension);
    }

    normalized.sort();
    normalized.dedup();

    if normalized.is_empty() {
        return None;
    }

    Some(normalized)
}

fn validate_entry_path(pack_dir: &Path, entry: &str) -> Option<(String, String, String)> {
    let trimmed = entry.trim();
    if trimmed.is_empty() {
        return None;
    }

    let pack_root = fs::canonicalize(pack_dir).ok()?;
    let entry_path = fs::canonicalize(pack_dir.join(trimmed)).ok()?;
    if !entry_path.starts_with(&pack_root) || !entry_path.is_file() {
        return None;
    }

    Some((
        trimmed.replace('\\', "/"),
        strip_verbatim_prefix(&pack_root).display().to_string(),
        strip_verbatim_prefix(&entry_path).display().to_string(),
    ))
}

fn parse_semver(version: &str) -> Option<semver::Version> {
    let trimmed = version.trim();
    let without_v = trimmed.strip_prefix('v').unwrap_or(trimmed);
    semver::Version::parse(without_v).ok()
}

fn version_less_than(left: &str, right: &str) -> Option<bool> {
    let left = parse_semver(left)?;
    let right = parse_semver(right)?;
    Some(left.cmp_precedence(&right).is_lt())
}

fn evaluate_pack_compatibility(
    minimum_app_version: Option<&str>,
    maximum_app_version: Option<&str>,
) -> OptionalLoaderPackCompatibility {
    let current_version = env!("CARGO_PKG_VERSION");

    if let Some(minimum) = minimum_app_version {
        match version_less_than(current_version, minimum) {
            Some(true) => {
                return OptionalLoaderPackCompatibility {
                    state: "requiresNewerApp".to_string(),
                    message: Some(format!(
                        "Requires yw-look {minimum} or newer. Current version is {current_version}."
                    )),
                };
            }
            Some(false) => {}
            None => {
                return OptionalLoaderPackCompatibility {
                    state: "unknown".to_string(),
                    message: Some(format!(
                        "Unable to compare loader pack minimum app version '{minimum}'."
                    )),
                };
            }
        }
    }

    if let Some(maximum) = maximum_app_version {
        match version_less_than(maximum, current_version) {
            Some(true) => {
                return OptionalLoaderPackCompatibility {
                    state: "requiresOlderApp".to_string(),
                    message: Some(format!(
                        "Requires yw-look {maximum} or older. Current version is {current_version}."
                    )),
                };
            }
            Some(false) => {}
            None => {
                return OptionalLoaderPackCompatibility {
                    state: "unknown".to_string(),
                    message: Some(format!(
                        "Unable to compare loader pack maximum app version '{maximum}'."
                    )),
                };
            }
        }
    }

    OptionalLoaderPackCompatibility {
        state: "compatible".to_string(),
        message: None,
    }
}

fn normalize_optional_version(version: Option<String>) -> Option<String> {
    version
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn validate_manifest(
    pack_dir: &Path,
    manifest: OptionalLoaderPackManifestRaw,
) -> Option<OptionalLoaderPackManifest> {
    let id = manifest.id.trim();
    let name = manifest.name.trim();
    let version = manifest.version.trim();

    if id.is_empty()
        || name.is_empty()
        || version.is_empty()
        || manifest.kind.trim() != LOADER_PACK_KIND
    {
        return None;
    }

    let extensions = normalize_extensions(id, manifest.extensions)?;
    let (entry, pack_path, entry_path) = validate_entry_path(pack_dir, &manifest.entry)?;
    let minimum_app_version = normalize_optional_version(manifest.minimum_app_version);
    let maximum_app_version = normalize_optional_version(manifest.maximum_app_version);
    let compatibility = evaluate_pack_compatibility(
        minimum_app_version.as_deref(),
        maximum_app_version.as_deref(),
    );

    Some(OptionalLoaderPackManifest {
        id: id.to_string(),
        name: name.to_string(),
        version: version.to_string(),
        minimum_app_version,
        maximum_app_version,
        compatibility,
        extensions,
        entry,
        pack_path,
        entry_path,
    })
}

pub(crate) fn scan_optional_loader_manifests_from_dir(
    optional_loaders_dir: &Path,
) -> Result<Vec<OptionalLoaderPackManifest>, AppError> {
    if !optional_loaders_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(optional_loaders_dir).map_err(|error| {
        AppError::Io(format!(
            "failed to read optional loader directory '{}': {error}",
            optional_loaders_dir.display()
        ))
    })?;

    let mut manifests = Vec::new();

    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        let pack_dir = entry.path();
        if !pack_dir.is_dir() {
            continue;
        }

        let manifest_path = pack_dir.join("manifest.json");
        let Ok(raw) = fs::read_to_string(&manifest_path) else {
            continue;
        };
        let Ok(manifest) = serde_json::from_str::<OptionalLoaderPackManifestRaw>(&raw) else {
            continue;
        };
        if let Some(valid_manifest) = validate_manifest(&pack_dir, manifest) {
            manifests.push(valid_manifest);
        }
    }

    manifests.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(manifests)
}

pub(crate) fn scan_optional_loader_manifests_from_dirs(
    app_managed_dir: &Path,
    bundled_seed_dir: Option<&Path>,
) -> Result<Vec<OptionalLoaderPackManifest>, AppError> {
    let mut manifests_by_id = HashMap::new();
    let removed_ids = removed_loader_pack_ids(app_managed_dir)?;

    if let Some(seed_dir) = bundled_seed_dir {
        for manifest in scan_optional_loader_manifests_from_dir(seed_dir)? {
            if removed_ids.contains(&manifest.id) {
                continue;
            }
            manifests_by_id.insert(manifest.id.clone(), manifest);
        }
    }

    for manifest in scan_optional_loader_manifests_from_dir(app_managed_dir)? {
        manifests_by_id.insert(manifest.id.clone(), manifest);
    }

    let mut manifests = manifests_by_id.into_values().collect::<Vec<_>>();
    manifests.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(manifests)
}

pub(crate) fn install_optional_loader_pack_to_dir(
    app_managed_dir: &Path,
    pack_id: &str,
) -> Result<Vec<OptionalLoaderPackManifest>, AppError> {
    let pack_dir = optional_loader_pack_dir(app_managed_dir, pack_id)?;
    fs::create_dir_all(&pack_dir).map_err(|error| {
        AppError::Io(format!(
            "failed to create optional loader pack directory '{}': {error}",
            pack_dir.display()
        ))
    })?;
    let removed_marker_path = pack_dir.join(LOADER_PACK_REMOVED_MARKER);
    if removed_marker_path.exists() {
        fs::remove_file(&removed_marker_path).map_err(|error| {
            AppError::Io(format!(
                "failed to clear loader pack removal marker: {error}"
            ))
        })?;
    }
    fs::write(
        pack_dir.join("loader.js"),
        "export {}; // First-party loader entry is provided by the app bundle.\n",
    )
    .map_err(|error| AppError::Io(format!("failed to write loader pack entry: {error}")))?;
    fs::write(
        pack_dir.join("manifest.json"),
        known_pack_manifest_json(pack_id)?,
    )
    .map_err(|error| AppError::Io(format!("failed to write loader pack manifest: {error}")))?;
    scan_optional_loader_manifests_from_dir(app_managed_dir)
}

pub(crate) fn remove_optional_loader_pack_from_dir(
    app_managed_dir: &Path,
    pack_id: &str,
) -> Result<Vec<OptionalLoaderPackManifest>, AppError> {
    let pack_dir = optional_loader_pack_dir(app_managed_dir, pack_id)?;
    if pack_dir.exists() {
        fs::remove_dir_all(&pack_dir).map_err(|error| {
            AppError::Io(format!(
                "failed to remove optional loader pack directory '{}': {error}",
                pack_dir.display()
            ))
        })?;
    }
    fs::create_dir_all(&pack_dir).map_err(|error| {
        AppError::Io(format!(
            "failed to create optional loader pack tombstone directory '{}': {error}",
            pack_dir.display()
        ))
    })?;
    fs::write(
        pack_dir.join(LOADER_PACK_REMOVED_MARKER),
        "removed by user\n",
    )
    .map_err(|error| AppError::Io(format!("failed to write loader pack tombstone: {error}")))?;
    scan_optional_loader_manifests_from_dir(app_managed_dir)
}

pub(crate) fn install_optional_loader_pack_from_dirs(
    app_managed_dir: &Path,
    bundled_seed_dir: Option<&Path>,
    pack_id: &str,
) -> Result<Vec<OptionalLoaderPackManifest>, AppError> {
    install_optional_loader_pack_to_dir(app_managed_dir, pack_id)?;
    scan_optional_loader_manifests_from_dirs(app_managed_dir, bundled_seed_dir)
}

pub(crate) fn remove_optional_loader_pack_from_dirs(
    app_managed_dir: &Path,
    bundled_seed_dir: Option<&Path>,
    pack_id: &str,
) -> Result<Vec<OptionalLoaderPackManifest>, AppError> {
    remove_optional_loader_pack_from_dir(app_managed_dir, pack_id)?;
    scan_optional_loader_manifests_from_dirs(app_managed_dir, bundled_seed_dir)
}

fn bundled_seed_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|resource_dir| resource_dir.join(OPTIONAL_LOADERS_DIR_NAME))
}

#[tauri::command]
pub(crate) fn load_optional_loader_manifests(
    app: tauri::AppHandle,
) -> Result<Vec<OptionalLoaderPackManifest>, AppError> {
    let app_managed_dir = optional_loaders_dir_from_app_data_dir(&resolve_app_data_dir(&app)?);
    let bundled_seed_dir = bundled_seed_dir(&app);
    scan_optional_loader_manifests_from_dirs(&app_managed_dir, bundled_seed_dir.as_deref())
}

#[tauri::command]
pub(crate) fn install_optional_loader_pack(
    app: tauri::AppHandle,
    pack_id: String,
) -> Result<Vec<OptionalLoaderPackManifest>, AppError> {
    let app_managed_dir = optional_loaders_dir_from_app_data_dir(&resolve_app_data_dir(&app)?);
    let bundled_seed_dir = bundled_seed_dir(&app);
    install_optional_loader_pack_from_dirs(&app_managed_dir, bundled_seed_dir.as_deref(), &pack_id)
}

#[tauri::command]
pub(crate) fn remove_optional_loader_pack(
    app: tauri::AppHandle,
    pack_id: String,
) -> Result<Vec<OptionalLoaderPackManifest>, AppError> {
    let app_managed_dir = optional_loaders_dir_from_app_data_dir(&resolve_app_data_dir(&app)?);
    let bundled_seed_dir = bundled_seed_dir(&app);
    remove_optional_loader_pack_from_dirs(&app_managed_dir, bundled_seed_dir.as_deref(), &pack_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write_pack(root: &Path, dir_name: &str, manifest: &str) {
        let pack_dir = root.join(dir_name);
        fs::create_dir_all(&pack_dir).expect("create pack dir");
        fs::write(pack_dir.join("loader.js"), "export {};").expect("write loader");
        fs::write(pack_dir.join("manifest.json"), manifest).expect("write manifest");
    }

    #[test]
    fn scan_optional_loader_manifests_returns_valid_first_party_packs() {
        let dir = tempdir().expect("tempdir");
        write_pack(
            dir.path(),
            "mmd",
            r#"{
  "id": "mmd-loader-pack",
  "name": "MMD Loader Pack",
  "version": "0.1.0",
  "minimumAppVersion": "0.1.0",
  "extensions": [".pmx", "vmd", "pmd"],
  "entry": "loader.js",
  "kind": "firstPartyLoaderPack"
}"#,
        );

        let manifests =
            scan_optional_loader_manifests_from_dir(dir.path()).expect("scan manifests");

        assert_eq!(manifests.len(), 1);
        assert_eq!(manifests[0].id, "mmd-loader-pack");
        assert_eq!(manifests[0].name, "MMD Loader Pack");
        assert_eq!(manifests[0].version, "0.1.0");
        assert_eq!(manifests[0].minimum_app_version, Some("0.1.0".to_string()));
        assert_eq!(manifests[0].maximum_app_version, None);
        assert_eq!(manifests[0].compatibility.state, "compatible");
        assert_eq!(manifests[0].extensions, vec!["pmd", "pmx", "vmd"]);
        assert_eq!(manifests[0].entry, "loader.js");
        assert!(manifests[0].pack_path.ends_with("mmd"));
        assert!(
            manifests[0].entry_path.ends_with("mmd\\loader.js")
                || manifests[0].entry_path.ends_with("mmd/loader.js")
        );
    }

    #[test]
    fn scan_optional_loader_manifests_ignores_invalid_manifests() {
        let dir = tempdir().expect("tempdir");
        write_pack(
            dir.path(),
            "third-party",
            r#"{
  "id": "unknown-loader-pack",
  "name": "Unknown Loader Pack",
  "version": "0.1.0",
  "extensions": ["weird"],
  "entry": "loader.js",
  "kind": "firstPartyLoaderPack"
}"#,
        );
        write_pack(
            dir.path(),
            "wrong-kind",
            r#"{
  "id": "mmd-loader-pack",
  "name": "MMD Loader Pack",
  "version": "0.1.0",
  "extensions": ["pmx"],
  "entry": "loader.js",
  "kind": "thirdParty"
}"#,
        );

        let manifests =
            scan_optional_loader_manifests_from_dir(dir.path()).expect("scan manifests");

        assert!(manifests.is_empty());
    }

    #[test]
    fn scan_optional_loader_manifests_rejects_entries_outside_pack_dir() {
        let dir = tempdir().expect("tempdir");
        fs::write(dir.path().join("outside.js"), "export {};").expect("write outside entry");
        let pack_dir = dir.path().join("mmd");
        fs::create_dir_all(&pack_dir).expect("create pack dir");
        fs::write(
            pack_dir.join("manifest.json"),
            r#"{
  "id": "mmd-loader-pack",
  "name": "MMD Loader Pack",
  "version": "0.1.0",
  "extensions": ["pmx"],
  "entry": "../outside.js",
  "kind": "firstPartyLoaderPack"
}"#,
        )
        .expect("write manifest");

        let manifests =
            scan_optional_loader_manifests_from_dir(dir.path()).expect("scan manifests");

        assert!(manifests.is_empty());
    }

    #[test]
    fn version_less_than_accepts_leading_v_prefix() {
        assert_eq!(version_less_than("v1.0.0", "1.0.1"), Some(true));
        assert_eq!(version_less_than("1.0.0", "v1.0.1"), Some(true));
        assert_eq!(version_less_than("v1.0.0", "v1.0.0"), Some(false));
        assert_eq!(version_less_than("not-a-version", "1.0.0"), None);
    }

    #[test]
    fn version_less_than_follows_semver_prerelease_ordering() {
        assert_eq!(version_less_than("1.0.0-alpha.1", "1.0.0"), Some(true));
        assert_eq!(version_less_than("1.0.0", "1.0.0-alpha.1"), Some(false));
        assert_eq!(
            version_less_than("1.0.0-alpha.1", "1.0.0-alpha.2"),
            Some(true)
        );
        assert_eq!(
            version_less_than("1.0.0-alpha.2", "1.0.0-alpha.10"),
            Some(true)
        );
        assert_eq!(
            version_less_than("1.0.0+build.7", "1.0.0+build.8"),
            Some(false)
        );
    }

    #[test]
    fn scan_optional_loader_manifests_reports_app_version_incompatibility() {
        let dir = tempdir().expect("tempdir");
        write_pack(
            dir.path(),
            "mmd",
            r#"{
  "id": "mmd-loader-pack",
  "name": "MMD Loader Pack",
  "version": "9.0.0",
  "minimumAppVersion": "9.0.0",
  "extensions": ["pmx"],
  "entry": "loader.js",
  "kind": "firstPartyLoaderPack"
}"#,
        );

        let manifests =
            scan_optional_loader_manifests_from_dir(dir.path()).expect("scan manifests");

        assert_eq!(manifests.len(), 1);
        assert_eq!(manifests[0].compatibility.state, "requiresNewerApp");
        assert_eq!(
            manifests[0].compatibility.message,
            Some(format!(
                "Requires yw-look 9.0.0 or newer. Current version is {}.",
                env!("CARGO_PKG_VERSION")
            ))
        );
    }

    #[test]
    fn scan_optional_loader_manifests_merges_bundled_seed_and_app_managed_dirs() {
        let app_managed_dir = tempdir().expect("app managed dir");
        let bundled_seed_dir = tempdir().expect("bundled seed dir");
        write_pack(
            bundled_seed_dir.path(),
            "mmd",
            r#"{
  "id": "mmd-loader-pack",
  "name": "MMD Loader Pack",
  "version": "0.1.0",
  "extensions": ["pmx"],
  "entry": "loader.js",
  "kind": "firstPartyLoaderPack"
}"#,
        );
        write_pack(
            app_managed_dir.path(),
            "mmd",
            r#"{
  "id": "mmd-loader-pack",
  "name": "MMD Loader Pack",
  "version": "0.2.0",
  "extensions": ["pmx", "pmd"],
  "entry": "loader.js",
  "kind": "firstPartyLoaderPack"
}"#,
        );
        write_pack(
            bundled_seed_dir.path(),
            "vrm",
            r#"{
  "id": "vrm-loader-pack",
  "name": "VRM Loader Pack",
  "version": "0.1.0",
  "extensions": ["vrm"],
  "entry": "loader.js",
  "kind": "firstPartyLoaderPack"
}"#,
        );

        let manifests = scan_optional_loader_manifests_from_dirs(
            app_managed_dir.path(),
            Some(bundled_seed_dir.path()),
        )
        .expect("scan manifests");

        assert_eq!(manifests.len(), 2);
        assert_eq!(manifests[0].id, "mmd-loader-pack");
        assert_eq!(manifests[0].version, "0.2.0");
        assert_eq!(manifests[0].extensions, vec!["pmd", "pmx"]);
        assert!(manifests[0]
            .entry_path
            .contains(app_managed_dir.path().to_string_lossy().as_ref()));
        assert_eq!(manifests[1].id, "vrm-loader-pack");
    }

    #[test]
    fn install_optional_loader_pack_writes_known_first_party_manifest() {
        let dir = tempdir().expect("tempdir");

        let manifests = install_optional_loader_pack_to_dir(dir.path(), "mmd-loader-pack")
            .expect("install loader pack");

        assert_eq!(manifests.len(), 1);
        assert_eq!(manifests[0].id, "mmd-loader-pack");
        assert_eq!(manifests[0].name, "MMD Loader Pack");
        assert_eq!(manifests[0].version, env!("CARGO_PKG_VERSION"));
        assert_eq!(
            manifests[0].minimum_app_version,
            Some(env!("CARGO_PKG_VERSION").to_string())
        );
        assert_eq!(manifests[0].compatibility.state, "compatible");
        assert_eq!(manifests[0].extensions, vec!["pmd", "pmx", "vmd"]);
        assert!(dir.path().join("mmd").join("loader.js").is_file());
        assert!(dir.path().join("mmd").join("manifest.json").is_file());
    }

    #[test]
    fn install_optional_loader_pack_returns_merged_bundled_seed_manifests() {
        let app_managed_dir = tempdir().expect("app managed dir");
        let bundled_seed_dir = tempdir().expect("bundled seed dir");
        write_pack(
            bundled_seed_dir.path(),
            "vrm",
            r#"{
  "id": "vrm-loader-pack",
  "name": "VRM Loader Pack",
  "version": "0.1.0",
  "extensions": ["vrm"],
  "entry": "loader.js",
  "kind": "firstPartyLoaderPack"
}"#,
        );

        let manifests = install_optional_loader_pack_from_dirs(
            app_managed_dir.path(),
            Some(bundled_seed_dir.path()),
            "mmd-loader-pack",
        )
        .expect("install loader pack");

        assert_eq!(manifests.len(), 2);
        assert_eq!(manifests[0].id, "mmd-loader-pack");
        assert_eq!(manifests[1].id, "vrm-loader-pack");
    }

    #[test]
    fn install_optional_loader_pack_clears_existing_removal_marker() {
        let dir = tempdir().expect("tempdir");
        remove_optional_loader_pack_from_dir(dir.path(), "mmd-loader-pack")
            .expect("remove loader pack");

        let manifests = install_optional_loader_pack_to_dir(dir.path(), "mmd-loader-pack")
            .expect("install loader pack");

        assert_eq!(manifests.len(), 1);
        assert_eq!(manifests[0].id, "mmd-loader-pack");
        assert!(!dir
            .path()
            .join("mmd")
            .join(LOADER_PACK_REMOVED_MARKER)
            .exists());
    }

    #[test]
    fn remove_optional_loader_pack_removes_only_known_pack_dir() {
        let dir = tempdir().expect("tempdir");
        install_optional_loader_pack_to_dir(dir.path(), "mmd-loader-pack")
            .expect("install mmd loader pack");
        install_optional_loader_pack_to_dir(dir.path(), "gaussian-splat-loader-pack")
            .expect("install gaussian loader pack");

        let manifests = remove_optional_loader_pack_from_dir(dir.path(), "mmd-loader-pack")
            .expect("remove loader pack");

        assert!(!dir.path().join("mmd").join("manifest.json").exists());
        assert!(dir
            .path()
            .join("mmd")
            .join(LOADER_PACK_REMOVED_MARKER)
            .is_file());
        assert!(dir.path().join("gaussian-splat").exists());
        assert_eq!(manifests.len(), 1);
        assert_eq!(manifests[0].id, "gaussian-splat-loader-pack");
    }

    #[test]
    fn remove_optional_loader_pack_returns_remaining_bundled_seed_manifests() {
        let app_managed_dir = tempdir().expect("app managed dir");
        let bundled_seed_dir = tempdir().expect("bundled seed dir");
        install_optional_loader_pack_to_dir(app_managed_dir.path(), "mmd-loader-pack")
            .expect("install mmd loader pack");
        write_pack(
            bundled_seed_dir.path(),
            "vrm",
            r#"{
  "id": "vrm-loader-pack",
  "name": "VRM Loader Pack",
  "version": "0.1.0",
  "extensions": ["vrm"],
  "entry": "loader.js",
  "kind": "firstPartyLoaderPack"
}"#,
        );

        let manifests = remove_optional_loader_pack_from_dirs(
            app_managed_dir.path(),
            Some(bundled_seed_dir.path()),
            "mmd-loader-pack",
        )
        .expect("remove loader pack");

        assert!(app_managed_dir
            .path()
            .join("mmd")
            .join(LOADER_PACK_REMOVED_MARKER)
            .is_file());
        assert_eq!(manifests.len(), 1);
        assert_eq!(manifests[0].id, "vrm-loader-pack");
    }

    #[test]
    fn remove_optional_loader_pack_hides_seed_only_manifest() {
        let app_managed_dir = tempdir().expect("app managed dir");
        let bundled_seed_dir = tempdir().expect("bundled seed dir");
        write_pack(
            bundled_seed_dir.path(),
            "mmd",
            r#"{
  "id": "mmd-loader-pack",
  "name": "MMD Loader Pack",
  "version": "0.1.0",
  "extensions": ["pmx"],
  "entry": "loader.js",
  "kind": "firstPartyLoaderPack"
}"#,
        );

        let manifests = remove_optional_loader_pack_from_dirs(
            app_managed_dir.path(),
            Some(bundled_seed_dir.path()),
            "mmd-loader-pack",
        )
        .expect("remove loader pack");

        assert!(manifests.is_empty());
        assert!(app_managed_dir
            .path()
            .join("mmd")
            .join(LOADER_PACK_REMOVED_MARKER)
            .is_file());
    }

    #[test]
    fn install_optional_loader_pack_rejects_unknown_pack_ids() {
        let dir = tempdir().expect("tempdir");

        let err = install_optional_loader_pack_to_dir(dir.path(), "unknown-loader-pack")
            .expect_err("unknown pack should fail");

        assert!(matches!(err, AppError::Internal(_)));
        assert!(!dir.path().join("unknown-loader-pack").exists());
    }
}
