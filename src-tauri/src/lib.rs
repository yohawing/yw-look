pub mod usd;

use rfd::FileDialog;
use serde::{Deserialize, Serialize};
#[cfg(desktop)]
use std::collections::HashSet;
use std::{
    env,
    fs::{self, OpenOptions},
    io::{Read as IoRead, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

use crate::usd::types::ExtractGeometryOptions;
use crate::usd::{
    AssetIssue, AttributeTimeSamples, DefaultBackend, OpenSession, PrimInspection, StageInspection,
    StageLoadPolicy, StageRegistry, StageSessionHandle, StageSummary, UsdError, UsdGeometryBackend,
    UsdInspectBackend, UsdLightBackend, UsdLightInfo, UsdSessionBackend, UsdSourceBackend,
};

const SETTINGS_FILE_NAME: &str = "settings.json";
const RECENT_FILES_FILE_NAME: &str = "recent-files.json";
const DIAGNOSTICS_LOG_FILE_NAME: &str = "diagnostics.log";
#[cfg(desktop)]
const MENU_ACTION_EVENT: &str = "yw-look://menu-action";
#[cfg(desktop)]
const MENU_RECENT_FILE_PREFIX: &str = "recent-file:";
#[cfg(desktop)]
const SHARED_MENU_DEFINITION_JSON: &str = include_str!("../../src/lib/menu-definition.json");
const DEFAULT_UPDATER_ENDPOINT: Option<&str> = option_env!("YW_LOOK_UPDATER_ENDPOINT");
const DEFAULT_UPDATER_PUBLIC_KEY: Option<&str> = option_env!("YW_LOOK_UPDATER_PUBLIC_KEY");
const MODEL_EXTENSIONS: &[&str] = &[
    "glb", "gltf", "fbx", "obj", "ply", "stl", "usd", "usda", "usdc", "usdz", "dae", "vrm", "pmd",
    "pmx", "abc",
];
const TEXTURE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "tga", "dds", "ktx2", "hdr", "exr"];
const FILE_ASSOCIATION_EXTENSIONS: &[&str] = &[
    "glb", "gltf", "fbx", "obj", "ply", "stl", "dae", "usd", "usda", "usdc", "usdz", "png", "jpg",
    "jpeg", "tga", "dds", "ktx2", "hdr", "exr",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct AppSettings {
    version: u32,
    recent_files_limit: usize,
    diagnostics_log_level: String,
    file_associations_enabled: bool,
    update_endpoint_override: Option<String>,
    update_public_key_override: Option<String>,
    allow_insecure_update_endpoint: bool,
    /// #26: when `true`, the frontend runs `check_for_update` once on
    /// startup so a stale build can surface a "Install Update" affordance
    /// without the user opening the Updates card. Existing settings
    /// files written before this field shipped fall back to the
    /// `Default::default()` value via `#[serde(default)]`.
    auto_check_for_updates: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateConfigurationPayload {
    current_version: String,
    default_endpoint: Option<String>,
    default_pubkey_available: bool,
    effective_endpoint: Option<String>,
    effective_pubkey_available: bool,
    using_override_endpoint: bool,
    using_override_pubkey: bool,
    allow_insecure_update_endpoint: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateMetadataPayload {
    version: String,
    current_version: String,
    notes: Option<String>,
    pub_date: Option<String>,
    target: String,
    download_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheckPayload {
    configuration: UpdateConfigurationPayload,
    update: Option<UpdateMetadataPayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInstallPayload {
    installed_version: String,
    restart_required: bool,
    note: String,
}

#[derive(Default)]
struct PendingUpdateState(Mutex<Option<Update>>);

#[cfg(desktop)]
const OPEN_FILE_EVENT: &str = "yw-look://open-file";

#[derive(Default)]
struct PendingOpenFiles(Mutex<Vec<PathBuf>>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendCapabilities {
    inspect: bool,
    geometry: bool,
    source: bool,
    session: bool,
    light: bool,
}

/// Active USD backend capabilities. Each optional slot advertises whether
/// the selected backend can satisfy that command family.
struct UsdBackendState {
    inspect: Arc<dyn UsdInspectBackend>,
    geometry: Option<Arc<dyn UsdGeometryBackend>>,
    source: Option<Arc<dyn UsdSourceBackend>>,
    session: Option<Arc<dyn UsdSessionBackend>>,
    light: Option<Arc<dyn UsdLightBackend>>,
}

impl UsdBackendState {
    #[cfg(feature = "backend-openusd-cpp")]
    fn new(backend: DefaultBackend) -> Self {
        let backend = Arc::new(backend);
        Self {
            inspect: backend.clone() as Arc<dyn UsdInspectBackend>,
            geometry: Some(backend.clone() as Arc<dyn UsdGeometryBackend>),
            source: Some(backend.clone() as Arc<dyn UsdSourceBackend>),
            session: Some(backend.clone() as Arc<dyn UsdSessionBackend>),
            light: Some(backend as Arc<dyn UsdLightBackend>),
        }
    }

    #[cfg(all(feature = "backend-openusd-rs", not(feature = "backend-openusd-cpp"),))]
    fn new(backend: DefaultBackend) -> Self {
        let backend = Arc::new(backend);
        Self {
            inspect: backend.clone() as Arc<dyn UsdInspectBackend>,
            geometry: Some(backend.clone() as Arc<dyn UsdGeometryBackend>),
            source: None,
            session: Some(backend as Arc<dyn UsdSessionBackend>),
            light: None,
        }
    }

    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            inspect: true,
            geometry: self.geometry.is_some(),
            source: self.source.is_some(),
            session: self.session.is_some(),
            light: self.light.is_some(),
        }
    }

    fn inspect(&self) -> Arc<dyn UsdInspectBackend> {
        Arc::clone(&self.inspect)
    }

    fn geometry(&self) -> Result<Arc<dyn UsdGeometryBackend>, String> {
        self.geometry
            .as_ref()
            .map(Arc::clone)
            .ok_or_else(|| "USD backend capability unavailable: geometry".to_string())
    }

    fn source(&self) -> Result<Arc<dyn UsdSourceBackend>, String> {
        self.source
            .as_ref()
            .map(Arc::clone)
            .ok_or_else(|| "USD backend capability unavailable: source".to_string())
    }

    fn session(&self) -> Result<Arc<dyn UsdSessionBackend>, String> {
        self.session
            .as_ref()
            .map(Arc::clone)
            .ok_or_else(|| "USD backend capability unavailable: session".to_string())
    }

    fn light(&self) -> Result<Arc<dyn UsdLightBackend>, String> {
        self.light
            .as_ref()
            .map(Arc::clone)
            .ok_or_else(|| "USD backend capability unavailable: light".to_string())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsPayload {
    settings_path: String,
    settings: AppSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectedFilePayload {
    path: String,
    file_name: String,
    extension: String,
    kind: String,
    parent_directory: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryListingPayload {
    files: Vec<SelectedFilePayload>,
    current_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentFileEntry {
    path: String,
    kind: String,
    last_accessed_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentFilesPayload {
    recent_files_path: String,
    entries: Vec<RecentFileEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsPayload {
    diagnostics_log_path: String,
    diagnostics_snapshot: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BenchConfigPayload {
    enabled: bool,
    models_path: String,
    repo_root: String,
    out_dir: String,
    mode: String,
    app_version: String,
    os: String,
    arch: String,
    node_version: Option<String>,
}

#[derive(Debug, Clone)]
struct BenchCliConfig {
    models_path: PathBuf,
    repo_root: PathBuf,
    out_dir: PathBuf,
    node_version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum ShotMode {
    Shot,
    Check,
}

#[derive(Debug, Clone)]
struct ShotCliConfig {
    mode: ShotMode,
    input_path: PathBuf,
    output_path: Option<PathBuf>,
    width: u32,
    height: u32,
    background: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShotConfigPayload {
    mode: ShotMode,
    input_path: String,
    file_name: String,
    extension: String,
    width: u32,
    height: u32,
    background: Option<String>,
}

fn repo_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "failed to resolve repository root".to_string())
}

fn canonicalize_existing_path(path: &Path) -> Result<PathBuf, String> {
    path.canonicalize()
        .map(|path| strip_verbatim_prefix(&path))
        .map_err(|error| format!("failed to normalize path '{}': {error}", path.display()))
}

fn canonicalize_existing_parent(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("path has no parent: {}", path.display()))?;
    canonicalize_existing_path(parent)
}

fn ensure_path_within(path: &Path, root: &Path, label: &str) -> Result<(), String> {
    if path.starts_with(root) {
        return Ok(());
    }

    Err(format!(
        "{label} path '{}' must be under '{}'",
        path.display(),
        root.display()
    ))
}

fn normalize_bench_repo_root(path: &Path) -> Result<PathBuf, String> {
    let normalized = canonicalize_existing_path(path)?;
    let expected = canonicalize_existing_path(&repo_root()?)?;
    if normalized != expected {
        return Err(format!(
            "bench repo root '{}' must match '{}'",
            normalized.display(),
            expected.display()
        ));
    }
    Ok(normalized)
}

fn bench_artifacts_root(repo_root: &Path) -> PathBuf {
    repo_root.join("artifacts").join("bench")
}

fn normalize_bench_models_path(path: &Path, repo_root: &Path) -> Result<PathBuf, String> {
    let normalized = canonicalize_existing_path(path)?;
    let samples_root = canonicalize_existing_path(&repo_root.join("samples").join("private"))?;
    ensure_path_within(&normalized, &samples_root, "bench models")?;
    Ok(normalized)
}

fn normalize_bench_out_dir(path: &Path, repo_root: &Path) -> Result<PathBuf, String> {
    let parent = canonicalize_existing_parent(path)?;
    let root = bench_artifacts_root(repo_root);
    fs::create_dir_all(&root)
        .map_err(|error| format!("failed to create bench artifacts root: {error}"))?;
    let normalized_root = canonicalize_existing_path(&root)?;
    ensure_path_within(&parent, &normalized_root, "bench output")?;
    fs::create_dir_all(path)
        .map_err(|error| format!("failed to create bench output directory: {error}"))?;
    canonicalize_existing_path(path)
}

fn parse_bench_cli_config() -> Result<Option<BenchCliConfig>, String> {
    let args: Vec<String> = env::args().collect();
    if !args.iter().any(|arg| arg == "--bench-load") {
        return Ok(None);
    }

    let mut models_path: Option<PathBuf> = None;
    let mut bench_repo_root: Option<PathBuf> = None;
    let mut out_dir: Option<PathBuf> = None;
    let mut node_version: Option<String> = None;
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--bench-models" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "--bench-models requires a path".to_string())?;
                models_path = Some(PathBuf::from(value));
            }
            "--bench-repo-root" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "--bench-repo-root requires a path".to_string())?;
                bench_repo_root = Some(PathBuf::from(value));
            }
            "--bench-out" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "--bench-out requires a path".to_string())?;
                out_dir = Some(PathBuf::from(value));
            }
            "--bench-node-version" => {
                index += 1;
                node_version = args.get(index).cloned();
            }
            _ => {}
        }
        index += 1;
    }

    let bench_repo_root = normalize_bench_repo_root(
        &bench_repo_root
            .ok_or_else(|| "--bench-load requires --bench-repo-root <path>".to_string())?,
    )?;
    let models_path = normalize_bench_models_path(
        &models_path.ok_or_else(|| "--bench-load requires --bench-models <path>".to_string())?,
        &bench_repo_root,
    )?;
    let out_dir = normalize_bench_out_dir(
        &out_dir.ok_or_else(|| "--bench-load requires --bench-out <dir>".to_string())?,
        &bench_repo_root,
    )?;

    Ok(Some(BenchCliConfig {
        models_path,
        repo_root: bench_repo_root,
        out_dir,
        node_version,
    }))
}

fn parse_size_argument(value: &str) -> Result<(u32, u32), String> {
    let (w, h) = value
        .split_once(['x', 'X', '×'])
        .ok_or_else(|| format!("--size expects WxH (e.g. 1920x1080), got '{value}'"))?;
    let width: u32 = w
        .trim()
        .parse()
        .map_err(|error| format!("--size width '{w}' is not a u32: {error}"))?;
    let height: u32 = h
        .trim()
        .parse()
        .map_err(|error| format!("--size height '{h}' is not a u32: {error}"))?;
    if width == 0 || height == 0 {
        return Err(format!(
            "--size width/height must be > 0, got {width}x{height}"
        ));
    }
    if width > 8192 || height > 8192 {
        return Err(format!(
            "--size width/height capped at 8192, got {width}x{height}"
        ));
    }
    Ok((width, height))
}

fn resolve_shot_input(path: &Path) -> Result<PathBuf, String> {
    let normalized = canonicalize_existing_path(path).map_err(|error| format!("--in {error}"))?;
    if !normalized.is_file() {
        return Err(format!(
            "--in path '{}' is not a regular file",
            normalized.display()
        ));
    }
    Ok(normalized)
}

fn resolve_shot_output(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    fs::create_dir_all(&parent).map_err(|error| {
        format!(
            "failed to create --out parent directory '{}': {error}",
            parent.display()
        )
    })?;
    let normalized_parent =
        canonicalize_existing_path(&parent).map_err(|error| format!("--out parent {error}"))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("--out path '{}' has no file name", path.display()))?;
    Ok(normalized_parent.join(file_name))
}

fn parse_shot_cli_config() -> Result<Option<ShotCliConfig>, String> {
    let args: Vec<String> = env::args().collect();
    let shot_flag = args.iter().any(|arg| arg == "--shot");
    let check_flag = args.iter().any(|arg| arg == "--check");
    if !shot_flag && !check_flag {
        return Ok(None);
    }
    if shot_flag && check_flag {
        return Err("--shot and --check are mutually exclusive".to_string());
    }
    let mode = if shot_flag {
        ShotMode::Shot
    } else {
        ShotMode::Check
    };

    let mut input_path: Option<PathBuf> = None;
    let mut output_path: Option<PathBuf> = None;
    let mut size: Option<(u32, u32)> = None;
    let mut background: Option<String> = None;
    let mut index = 0;

    while index < args.len() {
        match args[index].as_str() {
            "--in" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "--in requires a path".to_string())?;
                input_path = Some(PathBuf::from(value));
            }
            "--out" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "--out requires a path".to_string())?;
                output_path = Some(PathBuf::from(value));
            }
            "--size" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "--size requires WxH".to_string())?;
                size = Some(parse_size_argument(value)?);
            }
            "--bg" => {
                index += 1;
                let value = args
                    .get(index)
                    .ok_or_else(|| "--bg requires a value".to_string())?;
                background = Some(value.clone());
            }
            _ => {}
        }
        index += 1;
    }

    let input_path = resolve_shot_input(&input_path.ok_or_else(|| {
        format!(
            "--{} requires --in <path>",
            if mode == ShotMode::Shot {
                "shot"
            } else {
                "check"
            }
        )
    })?)?;

    let output_path = match mode {
        ShotMode::Shot => {
            Some(resolve_shot_output(&output_path.ok_or_else(|| {
                "--shot requires --out <path>".to_string()
            })?)?)
        }
        ShotMode::Check => None,
    };

    let (width, height) = size.unwrap_or((1024, 768));

    Ok(Some(ShotCliConfig {
        mode,
        input_path,
        output_path,
        width,
        height,
        background,
    }))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IntegrationPayload {
    file_associations_enabled: bool,
    install_strategy: String,
    supported_extensions: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetInspection {
    path: String,
    file_name: String,
    extension: String,
    kind: String,
    file_size_bytes: u64,
    modified_at: Option<String>,
    created_at: Option<String>,
    preview_implemented: bool,
    image_dimensions: Option<ImageDimensions>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageDimensions {
    width: u32,
    height: u32,
    source: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticRecordInput {
    code: String,
    level: String,
    message: String,
    detail: Option<String>,
    context_path: Option<String>,
}

#[cfg(desktop)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedMenuDefinition {
    sections: Vec<SharedMenuSection>,
}

#[cfg(desktop)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedMenuSection {
    id: String,
    label: String,
    entries: Vec<SharedMenuEntry>,
}

#[cfg(desktop)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedShortcutDefinition {
    key: String,
    ctrl_or_meta: Option<bool>,
    shift: Option<bool>,
    alt: Option<bool>,
}

#[cfg(desktop)]
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum SharedMenuEntry {
    Item {
        id: String,
        label: String,
        shortcut: Option<SharedShortcutDefinition>,
    },
    Separator,
    RecentFiles {
        label: String,
    },
}

#[cfg(desktop)]
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum NativeMenuEventPayload {
    Action { action_id: String },
    RecentFile { path: String },
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            version: 4,
            recent_files_limit: 20,
            diagnostics_log_level: "info".to_string(),
            file_associations_enabled: false,
            update_endpoint_override: None,
            update_public_key_override: None,
            allow_insecure_update_endpoint: false,
            // #26: opt-in by default so first-run users do not pay the
            // network cost of an update probe before they have decided
            // they want one. The Settings card flips it; saved
            // settings persist the choice.
            auto_check_for_updates: false,
        }
    }
}

#[cfg(desktop)]
fn load_shared_menu_definition() -> Result<SharedMenuDefinition, String> {
    serde_json::from_str(SHARED_MENU_DEFINITION_JSON)
        .map_err(|error| format!("failed to parse shared menu definition: {error}"))
}

#[cfg(desktop)]
fn shortcut_to_accelerator(shortcut: &SharedShortcutDefinition) -> String {
    let mut keys: Vec<String> = Vec::new();

    if shortcut.ctrl_or_meta.unwrap_or(false) {
        keys.push("CmdOrCtrl".to_string());
    }
    if shortcut.shift.unwrap_or(false) {
        keys.push("Shift".to_string());
    }
    if shortcut.alt.unwrap_or(false) {
        keys.push("Alt".to_string());
    }

    keys.push(shortcut.key.to_uppercase());
    keys.join("+")
}

#[cfg(desktop)]
fn collect_menu_action_ids(definition: &SharedMenuDefinition) -> HashSet<String> {
    definition
        .sections
        .iter()
        .flat_map(|section| section.entries.iter())
        .filter_map(|entry| match entry {
            SharedMenuEntry::Item { id, .. } => Some(id.clone()),
            _ => None,
        })
        .collect()
}

#[cfg(desktop)]
fn build_native_recent_files_submenu(
    app: &tauri::AppHandle,
    label: &str,
) -> Result<Submenu<tauri::Wry>, String> {
    let submenu = Submenu::new(app, label, true)
        .map_err(|error| format!("failed to create recent files submenu: {error}"))?;
    let (_, entries) = load_clean_recent_file_entries(app)?;

    if entries.is_empty() {
        let item = MenuItem::new(app, "No recent files", false, None::<&str>)
            .map_err(|error| format!("failed to create empty recent files item: {error}"))?;
        submenu
            .append(&item)
            .map_err(|error| format!("failed to append empty recent files item: {error}"))?;
        return Ok(submenu);
    }

    for entry in entries {
        let item = MenuItem::with_id(
            app,
            format!("{MENU_RECENT_FILE_PREFIX}{}", entry.path),
            entry.path,
            true,
            None::<&str>,
        )
        .map_err(|error| format!("failed to create recent file menu item: {error}"))?;
        submenu
            .append(&item)
            .map_err(|error| format!("failed to append recent file menu item: {error}"))?;
    }

    Ok(submenu)
}

#[cfg(desktop)]
fn build_native_menu(
    app: &tauri::AppHandle,
    definition: &SharedMenuDefinition,
) -> Result<Menu<tauri::Wry>, String> {
    let menu = Menu::new(app).map_err(|error| format!("failed to create menu: {error}"))?;

    for section in &definition.sections {
        let submenu = Submenu::with_id(app, section.id.clone(), &section.label, true)
            .map_err(|error| format!("failed to create submenu '{}': {error}", section.id))?;

        for entry in &section.entries {
            match entry {
                SharedMenuEntry::Item {
                    id,
                    label,
                    shortcut,
                } => {
                    let accelerator = shortcut.as_ref().map(shortcut_to_accelerator);
                    let item =
                        MenuItem::with_id(app, id.clone(), label, true, accelerator.as_deref())
                            .map_err(|error| {
                                format!("failed to create menu item '{id}': {error}")
                            })?;
                    submenu
                        .append(&item)
                        .map_err(|error| format!("failed to append menu item '{id}': {error}"))?;
                }
                SharedMenuEntry::Separator => {
                    let separator = PredefinedMenuItem::separator(app)
                        .map_err(|error| format!("failed to create menu separator: {error}"))?;
                    submenu
                        .append(&separator)
                        .map_err(|error| format!("failed to append menu separator: {error}"))?;
                }
                SharedMenuEntry::RecentFiles { label } => {
                    submenu
                        .append(&build_native_recent_files_submenu(app, label)?)
                        .map_err(|error| {
                            format!("failed to append recent files submenu '{label}': {error}")
                        })?;
                }
            }
        }

        menu.append(&submenu)
            .map_err(|error| format!("failed to append submenu '{}': {error}", section.id))?;
    }

    Ok(menu)
}

#[cfg(desktop)]
fn refresh_native_menu(app: &tauri::AppHandle) -> Result<(), String> {
    let definition = load_shared_menu_definition()?;
    let menu = build_native_menu(app, &definition)?;
    app.set_menu(menu)
        .map_err(|error| format!("failed to apply native menu: {error}"))?;
    Ok(())
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn sanitize_settings(settings: AppSettings) -> AppSettings {
    AppSettings {
        version: settings.version.max(4),
        recent_files_limit: settings.recent_files_limit.max(1),
        diagnostics_log_level: if settings.diagnostics_log_level.trim().is_empty() {
            "info".to_string()
        } else {
            settings.diagnostics_log_level
        },
        file_associations_enabled: settings.file_associations_enabled,
        update_endpoint_override: normalize_optional_text(settings.update_endpoint_override),
        update_public_key_override: normalize_optional_text(settings.update_public_key_override),
        allow_insecure_update_endpoint: settings.allow_insecure_update_endpoint,
        auto_check_for_updates: settings.auto_check_for_updates,
    }
}

fn current_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();

    seconds.to_string()
}

fn resolve_app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|error| format!("failed to resolve app config directory: {error}"))
}

fn resolve_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(resolve_app_data_dir(app)?.join(SETTINGS_FILE_NAME))
}

fn resolve_recent_files_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(resolve_app_data_dir(app)?.join(RECENT_FILES_FILE_NAME))
}

fn resolve_diagnostics_log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(resolve_app_data_dir(app)?.join(DIAGNOSTICS_LOG_FILE_NAME))
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "path has no parent directory".to_string())?;

    fs::create_dir_all(parent).map_err(|error| format!("failed to create directory: {error}"))
}

fn write_json_file<T: Serialize>(path: &Path, payload: &T) -> Result<(), String> {
    ensure_parent_dir(path)?;
    let json = serde_json::to_string_pretty(payload)
        .map_err(|error| format!("failed to serialize json: {error}"))?;
    fs::write(path, json).map_err(|error| format!("failed to write file: {error}"))
}

fn read_json_file<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> Result<T, String> {
    if !path.exists() {
        return Ok(T::default());
    }

    let raw = fs::read_to_string(path).map_err(|error| format!("failed to read file: {error}"))?;
    serde_json::from_str::<T>(&raw).map_err(|error| format!("failed to parse json: {error}"))
}

fn write_settings_file(path: &Path, settings: &AppSettings) -> Result<(), String> {
    write_json_file(path, settings)
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

fn current_app_version(app: &tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

fn build_update_configuration_payload(
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

fn update_metadata_payload(update: &Update) -> UpdateMetadataPayload {
    UpdateMetadataPayload {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        pub_date: update.date.map(|date| date.to_string()),
        target: update.target.clone(),
        download_url: update.download_url.to_string(),
    }
}

fn infer_file_kind(extension: &str) -> String {
    if MODEL_EXTENSIONS.contains(&extension) {
        "model".to_string()
    } else if TEXTURE_EXTENSIONS.contains(&extension) {
        "texture".to_string()
    } else {
        "unknown".to_string()
    }
}

fn is_supported_extension(extension: &str) -> bool {
    MODEL_EXTENSIONS.contains(&extension) || TEXTURE_EXTENSIONS.contains(&extension)
}

fn normalize_file_path(path: PathBuf) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!("file does not exist: {}", path.display()));
    }

    if !path.is_file() {
        return Err(format!("path is not a file: {}", path.display()));
    }

    let canonical = path
        .canonicalize()
        .map_err(|error| format!("failed to normalize file path: {error}"))?;
    Ok(strip_verbatim_prefix(&canonical))
}

fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        // Remove the `\\?\` extended-length prefix that `canonicalize()`
        // adds on Windows. Other platforms must keep their paths untouched.
        let s = path.display().to_string();
        if s.starts_with(r"\\?\") {
            return PathBuf::from(&s[4..]);
        }
    }

    #[cfg(not(windows))]
    {
        let _ = path;
    }

    path.to_path_buf()
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

fn build_selected_file_payload(path: PathBuf) -> Result<SelectedFilePayload, String> {
    let normalized = normalize_file_path(path)?;

    let extension = normalized
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    if !is_supported_extension(&extension) {
        return Err(format!("unsupported file extension: {extension}"));
    }

    let file_name = normalized
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "failed to resolve file name".to_string())?
        .to_string();

    let parent_directory = normalized
        .parent()
        .map(|value| value.display().to_string())
        .ok_or_else(|| "failed to resolve parent directory".to_string())?;

    Ok(SelectedFilePayload {
        path: normalized.display().to_string(),
        file_name,
        extension: extension.clone(),
        kind: infer_file_kind(&extension),
        parent_directory,
    })
}

fn list_supported_files_in_directory(directory: &Path) -> Result<Vec<SelectedFilePayload>, String> {
    let mut files = fs::read_dir(directory)
        .map_err(|error| format!("failed to read directory: {error}"))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| build_selected_file_payload(entry.path()).ok())
        .collect::<Vec<_>>();

    files.sort_by(|left, right| {
        left.file_name
            .to_ascii_lowercase()
            .cmp(&right.file_name.to_ascii_lowercase())
    });

    Ok(files)
}

fn load_or_initialize_settings(app: &tauri::AppHandle) -> Result<(PathBuf, AppSettings), String> {
    let settings_path = resolve_settings_path(app)?;

    let settings = if settings_path.exists() {
        let raw = fs::read_to_string(&settings_path)
            .map_err(|error| format!("failed to read settings file: {error}"))?;

        sanitize_settings(
            serde_json::from_str::<AppSettings>(&raw)
                .map_err(|error| format!("failed to parse settings file: {error}"))?,
        )
    } else {
        let defaults = sanitize_settings(AppSettings::default());
        write_settings_file(&settings_path, &defaults)?;
        defaults
    };

    Ok((settings_path, settings))
}

fn load_recent_file_entries(
    app: &tauri::AppHandle,
) -> Result<(PathBuf, Vec<RecentFileEntry>), String> {
    let recent_files_path = resolve_recent_files_path(app)?;

    if !recent_files_path.exists() {
        write_json_file(&recent_files_path, &Vec::<RecentFileEntry>::new())?;
    }

    let entries = read_json_file::<Vec<RecentFileEntry>>(&recent_files_path)?;
    Ok((recent_files_path, entries))
}

fn save_recent_file_entries(path: &Path, entries: &[RecentFileEntry]) -> Result<(), String> {
    write_json_file(path, &entries.to_vec())
}

fn load_clean_recent_file_entries(
    app: &tauri::AppHandle,
) -> Result<(PathBuf, Vec<RecentFileEntry>), String> {
    let (_, settings) = load_or_initialize_settings(app)?;
    let (recent_files_path, mut entries) = load_recent_file_entries(app)?;
    let original_len = entries.len();

    entries.retain(|entry| Path::new(&entry.path).exists());
    entries.truncate(settings.recent_files_limit);

    if entries.len() != original_len {
        save_recent_file_entries(&recent_files_path, &entries)?;
    }

    Ok((recent_files_path, entries))
}

fn build_updater(
    app: &tauri::AppHandle,
    settings: &AppSettings,
) -> Result<tauri_plugin_updater::Updater, String> {
    let endpoint = effective_updater_endpoint(settings)
        .ok_or_else(|| "no updater endpoint configured".to_string())?;
    let pubkey = effective_updater_public_key(settings)
        .ok_or_else(|| "no updater public key configured".to_string())?;

    if !settings.allow_insecure_update_endpoint && endpoint.starts_with("http://") {
        return Err(
            "refusing insecure update endpoint; enable the local override toggle for loopback testing"
                .to_string(),
        );
    }

    if settings.allow_insecure_update_endpoint && !is_loopback_update_endpoint(&endpoint) {
        return Err(
            "insecure update endpoints are restricted to localhost or 127.0.0.1".to_string(),
        );
    }

    let endpoint = Url::parse(&endpoint)
        .map_err(|error| format!("failed to parse updater endpoint: {error}"))?;

    app.updater_builder()
        .pubkey(pubkey)
        .endpoints(vec![endpoint])
        .map_err(|error| format!("failed to configure updater endpoints: {error}"))?
        .build()
        .map_err(|error| format!("failed to build updater client: {error}"))
}

fn append_diagnostic_record(
    app: &tauri::AppHandle,
    record: &DiagnosticRecordInput,
) -> Result<(), String> {
    let log_path = resolve_diagnostics_log_path(app)?;
    ensure_parent_dir(&log_path)?;

    let line = serde_json::json!({
        "timestamp": current_timestamp(),
        "code": record.code,
        "level": record.level,
        "message": record.message,
        "detail": record.detail,
        "contextPath": record.context_path,
    })
    .to_string();

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("failed to open diagnostics log: {error}"))?;

    writeln!(file, "{line}").map_err(|error| format!("failed to append diagnostics log: {error}"))
}

fn sync_recent_file(app: &tauri::AppHandle, file: &SelectedFilePayload) -> Result<(), String> {
    let (_, settings) = load_or_initialize_settings(app)?;
    let (recent_files_path, mut entries) = load_recent_file_entries(app)?;

    entries.retain(|entry| entry.path != file.path && Path::new(&entry.path).exists());
    entries.insert(
        0,
        RecentFileEntry {
            path: file.path.clone(),
            kind: file.kind.clone(),
            last_accessed_at: current_timestamp(),
        },
    );
    entries.truncate(settings.recent_files_limit);

    save_recent_file_entries(&recent_files_path, &entries)?;

    #[cfg(desktop)]
    refresh_native_menu(app)?;

    Ok(())
}

const PREVIEW_IMPLEMENTED_EXTENSIONS: &[&str] = &[
    "glb", "gltf", "fbx", "obj", "ply", "stl", "dae", "png", "jpg", "jpeg", "tga", "dds", "ktx2",
    "hdr", "exr",
];

fn system_time_to_unix_string(time: SystemTime) -> Option<String> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs().to_string())
}

fn read_png_dimensions(path: &Path) -> Option<ImageDimensions> {
    let mut file = fs::File::open(path).ok()?;
    let mut header = [0u8; 24];
    file.read_exact(&mut header).ok()?;
    if &header[0..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }
    let width = u32::from_be_bytes([header[16], header[17], header[18], header[19]]);
    let height = u32::from_be_bytes([header[20], header[21], header[22], header[23]]);
    Some(ImageDimensions {
        width,
        height,
        source: "png-header".to_string(),
    })
}

fn read_jpeg_dimensions(path: &Path) -> Option<ImageDimensions> {
    let data = fs::read(path).ok()?;
    if data.len() < 2 || data[0] != 0xFF || data[1] != 0xD8 {
        return None;
    }
    let mut offset = 2;
    while offset + 4 < data.len() {
        if data[offset] != 0xFF {
            break;
        }
        let marker = data[offset + 1];
        if marker == 0xC0 || marker == 0xC2 {
            if offset + 9 < data.len() {
                let height = u16::from_be_bytes([data[offset + 5], data[offset + 6]]) as u32;
                let width = u16::from_be_bytes([data[offset + 7], data[offset + 8]]) as u32;
                return Some(ImageDimensions {
                    width,
                    height,
                    source: "jpeg-header".to_string(),
                });
            }
            break;
        }
        let length = u16::from_be_bytes([data[offset + 2], data[offset + 3]]) as usize;
        offset += 2 + length;
    }
    None
}

fn read_dds_dimensions(path: &Path) -> Option<ImageDimensions> {
    let mut file = fs::File::open(path).ok()?;
    let mut header = [0u8; 20];
    file.read_exact(&mut header).ok()?;
    if &header[0..4] != b"DDS " {
        return None;
    }
    let height = u32::from_le_bytes([header[12], header[13], header[14], header[15]]);
    let width = u32::from_le_bytes([header[16], header[17], header[18], header[19]]);
    Some(ImageDimensions {
        width,
        height,
        source: "dds-header".to_string(),
    })
}

fn read_tga_dimensions(path: &Path) -> Option<ImageDimensions> {
    let mut file = fs::File::open(path).ok()?;
    let mut header = [0u8; 18];
    file.read_exact(&mut header).ok()?;
    let width = u16::from_le_bytes([header[12], header[13]]) as u32;
    let height = u16::from_le_bytes([header[14], header[15]]) as u32;
    if width == 0 || height == 0 || width > 65535 || height > 65535 {
        return None;
    }
    Some(ImageDimensions {
        width,
        height,
        source: "tga-header".to_string(),
    })
}

fn read_image_dimensions(path: &Path, extension: &str) -> Option<ImageDimensions> {
    match extension {
        "png" => read_png_dimensions(path),
        "jpg" | "jpeg" => read_jpeg_dimensions(path),
        "dds" => read_dds_dimensions(path),
        "tga" => read_tga_dimensions(path),
        _ => None,
    }
}

fn build_asset_inspection(path: PathBuf) -> Result<AssetInspection, String> {
    let normalized = normalize_file_path(path)?;

    let extension = normalized
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.to_ascii_lowercase())
        .unwrap_or_default();

    if !is_supported_extension(&extension) {
        return Err(format!("unsupported file extension: {extension}"));
    }

    let file_name = normalized
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or_else(|| "failed to resolve file name".to_string())?
        .to_string();

    let metadata =
        fs::metadata(&normalized).map_err(|e| format!("failed to read file metadata: {e}"))?;

    let modified_at = metadata
        .modified()
        .ok()
        .and_then(system_time_to_unix_string);
    let created_at = metadata.created().ok().and_then(system_time_to_unix_string);
    let preview_implemented = PREVIEW_IMPLEMENTED_EXTENSIONS.contains(&extension.as_str());
    let image_dimensions = read_image_dimensions(&normalized, &extension);

    Ok(AssetInspection {
        path: normalized.display().to_string(),
        file_name,
        extension: extension.clone(),
        kind: infer_file_kind(&extension),
        file_size_bytes: metadata.len(),
        modified_at,
        created_at,
        preview_implemented,
        image_dimensions,
    })
}

#[tauri::command]
fn inspect_asset(path: String) -> Result<AssetInspection, String> {
    build_asset_inspection(PathBuf::from(path))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FormatSupportPayload {
    model_extensions: Vec<String>,
    texture_extensions: Vec<String>,
    preview_implemented: Vec<String>,
}

#[tauri::command]
fn load_format_support() -> FormatSupportPayload {
    FormatSupportPayload {
        model_extensions: MODEL_EXTENSIONS.iter().map(|e| e.to_string()).collect(),
        texture_extensions: TEXTURE_EXTENSIONS.iter().map(|e| e.to_string()).collect(),
        preview_implemented: PREVIEW_IMPLEMENTED_EXTENSIONS
            .iter()
            .map(|e| e.to_string())
            .collect(),
    }
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<SettingsPayload, String> {
    let (settings_path, settings) = load_or_initialize_settings(&app)?;

    Ok(SettingsPayload {
        settings_path: settings_path.display().to_string(),
        settings,
    })
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<SettingsPayload, String> {
    let settings_path = resolve_settings_path(&app)?;
    let settings = sanitize_settings(settings);
    write_settings_file(&settings_path, &settings)?;

    Ok(SettingsPayload {
        settings_path: settings_path.display().to_string(),
        settings,
    })
}

#[tauri::command]
fn load_update_configuration(app: tauri::AppHandle) -> Result<UpdateConfigurationPayload, String> {
    let (_, settings) = load_or_initialize_settings(&app)?;
    Ok(build_update_configuration_payload(&app, &settings))
}

#[tauri::command]
fn open_file_dialog(app: tauri::AppHandle) -> Result<Option<SelectedFilePayload>, String> {
    let file_path = FileDialog::new()
        .set_title("Open asset file")
        .add_filter(
            "Supported assets",
            &[
                "glb", "gltf", "fbx", "obj", "ply", "stl", "usd", "usda", "usdc", "usdz", "dae",
                "vrm", "pmd", "pmx", "abc", "png", "jpg", "jpeg", "tga", "dds", "ktx2", "hdr", "exr",
            ],
        )
        .pick_file();

    let file = file_path.map(build_selected_file_payload).transpose()?;

    if let Some(ref payload) = file {
        sync_recent_file(&app, payload)?;
    }

    Ok(file)
}

#[tauri::command]
fn resolve_selected_file(
    app: tauri::AppHandle,
    path: String,
) -> Result<SelectedFilePayload, String> {
    let payload = build_selected_file_payload(PathBuf::from(path))?;
    sync_recent_file(&app, &payload)?;
    Ok(payload)
}

#[tauri::command]
fn list_supported_siblings(path: String) -> Result<DirectoryListingPayload, String> {
    let file = build_selected_file_payload(PathBuf::from(path))?;
    let files = list_supported_files_in_directory(Path::new(&file.parent_directory))?;
    let current_index = files.iter().position(|entry| entry.path == file.path);

    Ok(DirectoryListingPayload {
        files,
        current_index,
    })
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    fs::read(normalized).map_err(|error| format!("failed to read file bytes: {error}"))
}

#[tauri::command]
fn get_startup_file(
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingOpenFiles>,
) -> Result<Option<SelectedFilePayload>, String> {
    let queued: Vec<PathBuf> = {
        let mut guard = pending.0.lock().unwrap();
        std::mem::take(&mut *guard)
    };

    for path in queued {
        if let Ok(file) = build_selected_file_payload(path) {
            sync_recent_file(&app, &file)?;
            return Ok(Some(file));
        }
    }

    for argument in std::env::args().skip(1) {
        if let Ok(file) = build_selected_file_payload(PathBuf::from(argument)) {
            sync_recent_file(&app, &file)?;
            return Ok(Some(file));
        }
    }

    Ok(None)
}

#[tauri::command]
fn load_recent_files(app: tauri::AppHandle) -> Result<RecentFilesPayload, String> {
    let (recent_files_path, entries) = load_clean_recent_file_entries(&app)?;

    Ok(RecentFilesPayload {
        recent_files_path: recent_files_path.display().to_string(),
        entries,
    })
}

#[tauri::command]
fn load_supported_extensions(app: tauri::AppHandle) -> Result<IntegrationPayload, String> {
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

#[tauri::command]
fn log_diagnostic_event(
    app: tauri::AppHandle,
    record: DiagnosticRecordInput,
) -> Result<(), String> {
    append_diagnostic_record(&app, &record)
}

#[tauri::command]
fn load_diagnostics_snapshot(app: tauri::AppHandle) -> Result<DiagnosticsPayload, String> {
    let log_path = resolve_diagnostics_log_path(&app)?;
    ensure_parent_dir(&log_path)?;

    let diagnostics_snapshot = if log_path.exists() {
        let raw = fs::read_to_string(&log_path)
            .map_err(|error| format!("failed to read diagnostics log: {error}"))?;

        raw.lines()
            .rev()
            .take(50)
            .map(|line| line.to_string())
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    } else {
        Vec::new()
    };

    Ok(DiagnosticsPayload {
        diagnostics_log_path: log_path.display().to_string(),
        diagnostics_snapshot,
    })
}

#[tauri::command]
fn get_bench_config(
    app: tauri::AppHandle,
    config: tauri::State<'_, Option<BenchCliConfig>>,
) -> Result<Option<BenchConfigPayload>, String> {
    let Some(config) = config.as_ref() else {
        return Ok(None);
    };

    Ok(Some(BenchConfigPayload {
        enabled: true,
        models_path: config.models_path.display().to_string(),
        repo_root: config.repo_root.display().to_string(),
        out_dir: config.out_dir.display().to_string(),
        mode: if cfg!(debug_assertions) {
            "dev".to_string()
        } else {
            "release".to_string()
        },
        app_version: current_app_version(&app),
        os: env::consts::OS.to_string(),
        arch: env::consts::ARCH.to_string(),
        node_version: config.node_version.clone(),
    }))
}

#[tauri::command]
fn write_bench_report(
    config: tauri::State<'_, Option<BenchCliConfig>>,
    report_json: String,
    report_markdown: String,
) -> Result<(), String> {
    let Some(config) = config.as_ref() else {
        return Err("bench mode is not enabled".to_string());
    };
    let out_dir = normalize_bench_out_dir(&config.out_dir, &config.repo_root)?;
    fs::write(out_dir.join("report.json"), report_json)
        .map_err(|error| format!("failed to write report.json: {error}"))?;
    fs::write(out_dir.join("report.md"), report_markdown)
        .map_err(|error| format!("failed to write report.md: {error}"))?;
    Ok(())
}

#[tauri::command]
fn write_bench_screenshot(
    config: tauri::State<'_, Option<BenchCliConfig>>,
    file_name: String,
    png_bytes: Vec<u8>,
) -> Result<(), String> {
    let Some(config) = config.as_ref() else {
        return Err("bench mode is not enabled".to_string());
    };
    if !file_name.ends_with(".png")
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains("..")
    {
        return Err(format!("invalid bench screenshot file name: {file_name}"));
    }

    let out_dir = normalize_bench_out_dir(&config.out_dir, &config.repo_root)?;
    let screenshots_dir = out_dir.join("screenshots");
    fs::create_dir_all(&screenshots_dir)
        .map_err(|error| format!("failed to create screenshots directory: {error}"))?;
    fs::write(screenshots_dir.join(file_name), png_bytes)
        .map_err(|error| format!("failed to write screenshot: {error}"))?;
    Ok(())
}

#[tauri::command]
fn finish_bench_run(app: tauri::AppHandle, exit_code: i32) {
    app.exit(exit_code);
}

#[tauri::command]
fn finish_shot_run(app: tauri::AppHandle, exit_code: i32) {
    app.exit(exit_code);
}

#[tauri::command]
fn get_shot_config(
    config: tauri::State<'_, Option<ShotCliConfig>>,
) -> Result<Option<ShotConfigPayload>, String> {
    let Some(config) = config.as_ref() else {
        return Ok(None);
    };
    let file_name = config
        .input_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();
    let extension = config
        .input_path
        .extension()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_lowercase();
    Ok(Some(ShotConfigPayload {
        mode: config.mode,
        input_path: config.input_path.display().to_string(),
        file_name,
        extension,
        width: config.width,
        height: config.height,
        background: config.background.clone(),
    }))
}

#[tauri::command]
fn write_shot_output(
    config: tauri::State<'_, Option<ShotCliConfig>>,
    png_bytes: Vec<u8>,
) -> Result<String, String> {
    let Some(config) = config.as_ref() else {
        return Err("shot mode is not enabled".to_string());
    };
    let Some(output_path) = config.output_path.as_ref() else {
        return Err("--out is not configured (check mode does not write images)".to_string());
    };
    fs::write(output_path, &png_bytes)
        .map_err(|error| format!("failed to write shot output: {error}"))?;
    Ok(output_path.display().to_string())
}

fn map_usd_error(error: UsdError) -> String {
    error.to_string()
}

async fn run_blocking_usd<T, F>(task: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, UsdError> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| format!("USD task join error: {e}"))?
        .map_err(map_usd_error)
}

#[allow(non_snake_case)]
#[tauri::command]
async fn backendCapabilities(
    backend: tauri::State<'_, UsdBackendState>,
) -> Result<BackendCapabilities, String> {
    Ok(backend.capabilities())
}

#[tauri::command]
async fn inspect_stage(
    backend: tauri::State<'_, UsdBackendState>,
    path: String,
    // Phase 4: optional on the wire so Phase 3 frontends still work.
    // `None` → `StageLoadPolicy::LoadAll` via `Default`.
    policy: Option<StageLoadPolicy>,
) -> Result<StageInspection, String> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let handle = backend.inspect();
    let policy = policy.unwrap_or_default();
    run_blocking_usd(move || handle.inspect_stage(&normalized, policy)).await
}

/// #37 — time-samples inspector for a single attribute.
/// Returns up to `max_samples` time samples and optional numeric
/// statistics (min / max / mean) for scalar-numeric attributes.
/// Only implemented on the C++ backend; the Rust fork returns an error
/// that the frontend should handle gracefully.
#[tauri::command]
async fn inspect_attribute_time_samples(
    backend: tauri::State<'_, UsdBackendState>,
    path: String,
    prim_path: String,
    attr_name: String,
    max_samples: Option<usize>,
) -> Result<AttributeTimeSamples, String> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let cap = max_samples.unwrap_or(100);
    let handle = backend.inspect();
    run_blocking_usd(move || {
        handle.inspect_attribute_time_samples(&normalized, &prim_path, &attr_name, cap)
    })
    .await
}

/// #28 — per-prim attribute / relationship / metadata inspector.
/// Returns `PrimInspection` for the prim at `prim_path` in the USD file
/// at `path`. Currently only implemented on the C++ backend; the Rust
/// fork backend returns an error that the frontend should handle gracefully.
#[tauri::command]
async fn inspect_prim(
    backend: tauri::State<'_, UsdBackendState>,
    path: String,
    prim_path: String,
) -> Result<PrimInspection, String> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let handle = backend.inspect();
    run_blocking_usd(move || handle.inspect_prim(&normalized, &prim_path)).await
}

/// #35 — enumerates all UsdLux light prims in the stage and returns their
/// detailed attributes (intensity, color, exposure, color temperature, specular
/// / diffuse multipliers, dome texture, shaping cone).
///
/// Only implemented on the C++ backend. The Rust-fork backend returns an error
/// that the frontend should handle gracefully by falling back to the Three.js-
/// derived `LightEntry` list.
#[tauri::command]
async fn inspect_usd_lights(
    backend: tauri::State<'_, UsdBackendState>,
    path: String,
) -> Result<Vec<UsdLightInfo>, String> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let handle = backend.light()?;
    run_blocking_usd(move || handle.inspect_usd_lights(&normalized)).await
}

#[tauri::command]
async fn summarize_stage(
    backend: tauri::State<'_, UsdBackendState>,
    path: String,
    policy: Option<StageLoadPolicy>,
) -> Result<StageSummary, String> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let handle = backend.inspect();
    let policy = policy.unwrap_or_default();
    run_blocking_usd(move || handle.summarize_stage(&normalized, policy)).await
}

#[tauri::command]
async fn collect_asset_issues(
    backend: tauri::State<'_, UsdBackendState>,
    path: String,
) -> Result<Vec<AssetIssue>, String> {
    // Asset issues always run under LoadAll — see the backend impl.
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let handle = backend.inspect();
    run_blocking_usd(move || handle.collect_asset_issues(&normalized)).await
}

/// Phase 3: returns whether the frontend should route this USD file
/// through the Rust GLB extraction pipeline instead of Three.js
/// `USDLoader.parse`. True whenever the root layer is binary USDC *or*
/// the composed stage has more than one layer (references, payloads,
/// sublayers) — because `USDLoader.parse` only sees the single buffer
/// yw-look hands it and cannot follow external asset paths.
///
/// This is the decision the frontend acts on during the USD load case.
/// The backend opens the stage once and inspects layer count, so it's
/// cheap enough to call eagerly.
#[tauri::command]
async fn requires_glb_preview(
    backend: tauri::State<'_, UsdBackendState>,
    path: String,
) -> Result<bool, String> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let handle = backend.inspect();
    run_blocking_usd(move || handle.requires_glb_preview(&normalized)).await
}

/// Phase 3: extracts every Mesh prim in the stage as a single GLB binary,
/// returned as a raw byte stream via `tauri::ipc::Response`. The frontend
/// receives the bytes as `ArrayBuffer` and feeds them to
/// `GLTFLoader.parseAsync`. Use only after `root_layer_is_binary` returned
/// `true` — for USDA stages the existing `USDLoader.parse` path is faster
/// and more accurate (no triangulation, full xform graph).
///
/// Round 1.5 (#32 / #31): the frontend may pass `options` with
/// `variant_selections` and `purpose_modes`. Backwards compatible —
/// when `options` is `None` we fall back to the old `policy`-only
/// behaviour. When both are passed, `options` takes precedence and
/// `policy` is ignored.
#[tauri::command]
async fn extract_geometry(
    backend: tauri::State<'_, UsdBackendState>,
    path: String,
    // Phase 4: `None` preserves Phase 3 behavior (LoadAll). Frontend
    // toggles Deferred to pass `{policy: "noPayloads"}`.
    policy: Option<StageLoadPolicy>,
    options: Option<crate::usd::types::ExtractGeometryOptions>,
) -> Result<tauri::ipc::Response, String> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let handle = backend.geometry()?;
    let resolved_options = options.unwrap_or_else(|| {
        crate::usd::types::ExtractGeometryOptions::from(policy.unwrap_or_default())
    });
    let bytes = run_blocking_usd(move || {
        handle.extract_geometry_glb_with_options(&normalized, &resolved_options)
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// #39 — returns the fully flattened USDA text for the stage at `path`,
/// equivalent to `usdcat --flatten`. Every reference, payload, and
/// sublayer is composed and inlined into the returned string.
///
/// Only implemented on the C++ backend. The Rust openusd fork backend
/// returns an error; the frontend should handle it gracefully (e.g. keep
/// displaying the existing "Binary stage" placeholder).
#[tauri::command]
async fn flatten_stage(
    backend: tauri::State<'_, UsdBackendState>,
    path: String,
) -> Result<String, String> {
    let normalized = normalize_file_path(PathBuf::from(path))?;
    let handle = backend.source()?;
    run_blocking_usd(move || handle.flatten_stage(&normalized)).await
}

// ---- #44 per-prim payload session commands ---------------------------------

/// #44 — opens a USD stage and registers it in the `StageRegistry`.
/// Returns a `StageSessionHandle` (opaque integer) the caller uses for
/// follow-up `load_payload`, `unload_payload`, and
/// `extract_geometry_session` commands.
///
/// The session is kept alive until `close_stage_session` is called or the
/// app exits. If the same file is opened twice, two independent sessions
/// are created (each has its own stage and load state).
#[tauri::command]
async fn open_stage_session(
    backend: tauri::State<'_, UsdBackendState>,
    registry: tauri::State<'_, StageRegistry>,
    path: String,
    policy: Option<StageLoadPolicy>,
) -> Result<StageSessionHandle, String> {
    let normalized = normalize_file_path(PathBuf::from(path.clone()))?;
    let handle = backend.session()?;
    let policy = policy.unwrap_or_default();
    let open_stage =
        run_blocking_usd(move || handle.open_stage_session(&normalized, policy)).await?;

    let session = OpenSession {
        path: PathBuf::from(path),
        policy,
        stage: open_stage,
    };
    let sh = registry.insert(session);
    Ok(sh)
}

/// #44 — removes and drops the session for `handle`. After this call the
/// handle is invalid; any follow-up command that references it will return
/// an error.
#[tauri::command]
async fn close_stage_session(
    registry: tauri::State<'_, StageRegistry>,
    handle: StageSessionHandle,
) -> Result<(), String> {
    registry
        .remove(handle)
        .ok_or_else(|| format!("close_stage_session: unknown handle {}", handle.0))?;
    Ok(())
}

/// #44 — loads the payload arc(s) rooted at `prim_path` on the open stage
/// identified by `handle`.
///
/// Only implemented on the C++ backend. The Rust-fork backend always
/// returns an error (D6 in the plan).
#[tauri::command]
async fn load_payload(
    app: tauri::AppHandle,
    backend: tauri::State<'_, UsdBackendState>,
    handle: StageSessionHandle,
    prim_path: String,
) -> Result<(), String> {
    use tauri::Manager;
    let backend_handle = backend.session()?;
    // `UsdStage::Load` performs synchronous composition + I/O for
    // potentially large layers; route it through the blocking pool so
    // the async runtime stays responsive to other IPC traffic.
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let registry = app.state::<StageRegistry>();
        let session = registry
            .get(handle)
            .ok_or_else(|| format!("load_payload: unknown session handle {}", handle.0))?;
        backend_handle
            .load_payload(&session.stage, &prim_path)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("USD task join error: {e}"))?
}

/// #44 — unloads the payload arc(s) rooted at `prim_path` on the open
/// stage identified by `handle`.
///
/// Only implemented on the C++ backend. The Rust-fork backend always
/// returns an error.
#[tauri::command]
async fn unload_payload(
    app: tauri::AppHandle,
    backend: tauri::State<'_, UsdBackendState>,
    handle: StageSessionHandle,
    prim_path: String,
) -> Result<(), String> {
    use tauri::Manager;
    let backend_handle = backend.session()?;
    // Unload is cheaper than load but still touches `UsdStage`'s
    // composition cache; keep it off the async runtime for symmetry
    // and to guarantee the registry mutex isn't held across `.await`.
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let registry = app.state::<StageRegistry>();
        let session = registry
            .get(handle)
            .ok_or_else(|| format!("unload_payload: unknown session handle {}", handle.0))?;
        backend_handle
            .unload_payload(&session.stage, &prim_path)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("USD task join error: {e}"))?
}

/// #44 — extracts GLB geometry from the open stage identified by `handle`.
/// This runs the same GLB pipeline as `extract_geometry` but does NOT
/// reopen the file, so any per-prim payload mutations made via
/// `load_payload` / `unload_payload` are reflected in the output.
#[tauri::command]
async fn extract_geometry_session(
    app: tauri::AppHandle,
    backend: tauri::State<'_, UsdBackendState>,
    handle: StageSessionHandle,
    options: Option<ExtractGeometryOptions>,
    policy: Option<StageLoadPolicy>,
) -> Result<tauri::ipc::Response, String> {
    use tauri::Manager;
    let resolved_options =
        options.unwrap_or_else(|| ExtractGeometryOptions::from(policy.unwrap_or_default()));
    let backend_handle = backend.session()?;
    // Heavy USD GLB extraction must not run on the async runtime's worker.
    // Move it to a blocking task and look up the registry from `app` inside
    // (avoids holding a `tauri::State` reference across `.await`).
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let registry = app.state::<StageRegistry>();
        let session = registry.get(handle).ok_or_else(|| {
            format!(
                "extract_geometry_session: unknown session handle {}",
                handle.0
            )
        })?;
        backend_handle
            .extract_geometry_from_session(&session.stage, &session.path, &resolved_options)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("USD task join error: {e}"))??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
async fn check_for_update(
    app: tauri::AppHandle,
    pending_update: tauri::State<'_, PendingUpdateState>,
) -> Result<UpdateCheckPayload, String> {
    let (_, settings) = load_or_initialize_settings(&app)?;
    let configuration = build_update_configuration_payload(&app, &settings);
    let update = build_updater(&app, &settings)?
        .check()
        .await
        .map_err(|error| format!("failed to check for updates: {error}"))?;

    let payload = UpdateCheckPayload {
        configuration,
        update: update.as_ref().map(update_metadata_payload),
    };

    *pending_update.0.lock().unwrap() = update;

    Ok(payload)
}

#[tauri::command]
async fn install_pending_update(
    pending_update: tauri::State<'_, PendingUpdateState>,
) -> Result<UpdateInstallPayload, String> {
    let update = pending_update
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "no pending update is available; run a check first".to_string())?;
    let installed_version = update.version.clone();

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| format!("failed to install update: {error}"))?;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    let shared_menu_definition =
        load_shared_menu_definition().expect("failed to load shared menu definition");
    #[cfg(desktop)]
    let menu_action_ids = collect_menu_action_ids(&shared_menu_definition);
    let bench_cli_config = parse_bench_cli_config().expect("failed to parse bench CLI args");
    let shot_cli_config = parse_shot_cli_config().expect("failed to parse shot CLI args");
    if bench_cli_config.is_some() && shot_cli_config.is_some() {
        panic!("--bench-load cannot be combined with --shot/--check");
    }

    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.on_menu_event(move |app, event| {
            let menu_id = event.id().as_ref();
            let payload = if menu_action_ids.contains(menu_id) {
                Some(NativeMenuEventPayload::Action {
                    action_id: menu_id.to_string(),
                })
            } else {
                menu_id.strip_prefix(MENU_RECENT_FILE_PREFIX).map(|path| {
                    NativeMenuEventPayload::RecentFile {
                        path: path.to_string(),
                    }
                })
            };

            if let Some(payload) = payload {
                if let Err(error) = app.emit(MENU_ACTION_EVENT, payload) {
                    eprintln!("failed to emit menu action event '{menu_id}': {error}");
                }
            }
        });
    }

    let app = builder
        .setup(move |app| {
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())
                .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;

            #[cfg(desktop)]
            {
                refresh_native_menu(&app.handle()).map_err(
                    |error| -> Box<dyn std::error::Error> {
                        Box::new(std::io::Error::new(std::io::ErrorKind::Other, error))
                    },
                )?;
            }

            app.manage(PendingUpdateState::default());
            app.manage(PendingOpenFiles::default());
            app.manage(UsdBackendState::new(DefaultBackend::new()));
            // #44: register the stage registry so session commands can access it.
            app.manage(StageRegistry::new());
            app.manage(bench_cli_config.clone());
            app.manage(shot_cli_config.clone());

            let entry_url: Option<&str> = if bench_cli_config.is_some() {
                Some("http://localhost:1420/bench.html")
            } else if shot_cli_config.is_some() {
                Some("http://localhost:1420/shot.html")
            } else {
                None
            };

            if let Some(url) = entry_url {
                let window = app.get_webview_window("main").ok_or_else(|| {
                    Box::<dyn std::error::Error>::from(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        "main window was not created",
                    ))
                })?;
                window
                    .navigate(
                        Url::parse(url)
                            .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?,
                    )
                    .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            load_update_configuration,
            open_file_dialog,
            resolve_selected_file,
            list_supported_siblings,
            read_binary_file,
            get_startup_file,
            load_recent_files,
            load_supported_extensions,
            log_diagnostic_event,
            load_diagnostics_snapshot,
            get_bench_config,
            write_bench_report,
            write_bench_screenshot,
            finish_bench_run,
            get_shot_config,
            write_shot_output,
            finish_shot_run,
            check_for_update,
            install_pending_update,
            inspect_asset,
            load_format_support,
            backendCapabilities,
            inspect_stage,
            summarize_stage,
            collect_asset_issues,
            requires_glb_preview,
            extract_geometry,
            inspect_prim,
            inspect_attribute_time_samples,
            flatten_stage,
            inspect_usd_lights,
            open_stage_session,
            close_stage_session,
            load_payload,
            unload_payload,
            extract_geometry_session
        ])
        .build(tauri::generate_context!())
        .expect("error while building yw-look");

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Opened { urls } = event {
            handle_opened_urls(app_handle, urls);
        }
    });

    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    app.run(|_, _| {});
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn handle_opened_urls(app: &tauri::AppHandle, urls: Vec<url::Url>) {
    let paths: Vec<PathBuf> = urls
        .into_iter()
        .filter_map(|url| {
            if url.scheme() == "file" {
                url.to_file_path().ok()
            } else {
                None
            }
        })
        .collect();

    if paths.is_empty() {
        return;
    }

    if let Some(pending) = app.try_state::<PendingOpenFiles>() {
        pending.0.lock().unwrap().extend(paths.iter().cloned());
    }

    for path in &paths {
        let payload = path.display().to_string();
        if let Err(error) = app.emit(OPEN_FILE_EVENT, payload) {
            eprintln!("failed to emit open-file event: {error}");
        }
    }
}
