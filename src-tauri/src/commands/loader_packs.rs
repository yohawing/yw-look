use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

use crate::error::AppError;
use crate::shared::{resolve_app_data_dir, strip_verbatim_prefix};

const OPTIONAL_LOADERS_DIR_NAME: &str = "optional-loaders";
const LOADER_PACK_KIND: &str = "firstPartyLoaderPack";
pub(crate) const KNOWN_OPTIONAL_LOADER_EXTENSIONS: &[&str] = &[
    "vrm", "vrma", "pmd", "pmx", "vmd", "splat", "spz", "ksplat", "sog",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptionalLoaderPackManifestRaw {
    id: String,
    name: String,
    version: String,
    extensions: Vec<String>,
    entry: String,
    kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OptionalLoaderPackManifest {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) version: String,
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

fn optional_loaders_dir_from_app_data_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(OPTIONAL_LOADERS_DIR_NAME)
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

    Some(OptionalLoaderPackManifest {
        id: id.to_string(),
        name: name.to_string(),
        version: version.to_string(),
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

    if let Some(seed_dir) = bundled_seed_dir {
        for manifest in scan_optional_loader_manifests_from_dir(seed_dir)? {
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

#[tauri::command]
pub(crate) fn load_optional_loader_manifests(
    app: tauri::AppHandle,
) -> Result<Vec<OptionalLoaderPackManifest>, AppError> {
    let app_managed_dir = optional_loaders_dir_from_app_data_dir(&resolve_app_data_dir(&app)?);
    let bundled_seed_dir = app
        .path()
        .resource_dir()
        .ok()
        .map(|resource_dir| resource_dir.join(OPTIONAL_LOADERS_DIR_NAME));
    scan_optional_loader_manifests_from_dirs(&app_managed_dir, bundled_seed_dir.as_deref())
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
}
