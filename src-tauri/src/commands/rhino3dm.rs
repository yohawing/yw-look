//! Native 3DM preview supervision.
//!
//! The openNURBS implementation lives in a separate helper process. This
//! module owns the process boundary, request lifecycle, bounded result
//! transfer, and the structured failure contract exposed through Tauri IPC.

#[cfg(windows)]
use std::ffi::OsStr;
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
#[cfg(test)]
use std::sync::Mutex;
use std::sync::{atomic::AtomicBool, Arc};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

use crate::error::{AppError, Rhino3dmErrorDetails};
use crate::shared::normalize_file_path;
use crate::state::Rhino3dmImportState;

pub(crate) const RHINO3DM_PROTOCOL_VERSION: u32 = 1;
pub(crate) const RHINO3DM_RESULT_SCHEMA_VERSION: u32 = 1;
pub(crate) const RHINO3DM_OPENNURBS_REVISION: &str = "23fc677ba06e49212296ca75fab7fb6c2851b4ce";

// Provisional desktop default. The helper's explicit generation limits remain
// authoritative; this is deliberately conservative until production memory
// telemetry establishes a platform-specific baseline.
const DEFAULT_MEMORY_BYTES: u64 = 3 * 1024 * 1024 * 1024;
const DEFAULT_OUTPUT_BYTES: u64 = 512 * 1024 * 1024;
const DEFAULT_RESULT_BYTES: u64 = 1024 * 1024;
const DEFAULT_STDOUT_BYTES: u64 = 64 * 1024;
const DEFAULT_STDERR_BYTES: u64 = 64 * 1024;
const DEFAULT_TIMEOUT_MS: u64 = 10 * 60 * 1000;
const DEFAULT_VERTICES: u64 = 100_000_000;
const DEFAULT_TRIANGLES: u64 = 100_000_000;
const DEFAULT_MESHES: u64 = 10_000_000;
const DEFAULT_MATERIALS: u64 = 1_000_000;
const DEFAULT_IMAGES: u64 = 100_000;
const DEFAULT_IMAGE_PIXELS: u64 = 4_000_000_000;
const MAX_REQUEST_ID_BYTES: usize = 128;
const MAX_WARNING_COUNT: usize = 4096;
const MAX_WARNING_BYTES: usize = 16 * 1024;
const RHINO3DM_PACKET_MAGIC: &[u8; 8] = b"YW3DMGLB";
const RHINO3DM_PACKET_VERSION: u32 = 1;
const RHINO3DM_PACKET_FIXED_BYTES: usize = RHINO3DM_PACKET_MAGIC.len() + 4;
const MAX_PACKET_HEADER_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct Rhino3dmBudgets {
    pub memory_bytes: u64,
    pub output_bytes: u64,
    pub result_bytes: u64,
    pub stdout_bytes: u64,
    pub stderr_bytes: u64,
    pub timeout_ms: u64,
    pub vertices: u64,
    pub triangles: u64,
    pub meshes: u64,
    pub materials: u64,
    pub images: u64,
    pub image_decoded_bytes: u64,
    pub reference_expansions: u64,
    pub recursion_depth: u64,
}

impl Default for Rhino3dmBudgets {
    fn default() -> Self {
        Self {
            memory_bytes: DEFAULT_MEMORY_BYTES,
            output_bytes: DEFAULT_OUTPUT_BYTES,
            result_bytes: DEFAULT_RESULT_BYTES,
            stdout_bytes: DEFAULT_STDOUT_BYTES,
            stderr_bytes: DEFAULT_STDERR_BYTES,
            timeout_ms: DEFAULT_TIMEOUT_MS,
            vertices: DEFAULT_VERTICES,
            triangles: DEFAULT_TRIANGLES,
            meshes: DEFAULT_MESHES,
            materials: DEFAULT_MATERIALS,
            images: DEFAULT_IMAGES,
            image_decoded_bytes: DEFAULT_IMAGE_PIXELS,
            reference_expansions: 1_000_000,
            recursion_depth: 64,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Rhino3dmStats {
    pub objects: u64,
    pub visible_objects: u64,
    pub nodes: u64,
    pub meshes: u64,
    pub materials: u64,
    pub vertices: u64,
    pub indices: u64,
    pub triangles: u64,
    pub images: u64,
    pub image_decoded_bytes: u64,
    pub reference_expansions: u64,
    pub max_recursion_depth: u64,
    pub output_bytes: u64,
    pub read_ms: u64,
    pub generate_ms: u64,
    pub write_ms: u64,
    pub total_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Rhino3dmWarning {
    pub kind: String,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Rhino3dmPreviewPayload {
    pub bytes: Vec<u8>,
    pub warnings: Vec<Rhino3dmWarning>,
    pub stats: Rhino3dmStats,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Rhino3dmPacketHeader {
    packet_version: u32,
    schema_version: u32,
    protocol_version: u32,
    helper_revision: &'static str,
    warnings: Vec<Rhino3dmWarning>,
    stats: Rhino3dmStats,
    glb_bytes: u64,
}

fn resolve_budgets(budgets: Option<Rhino3dmBudgets>) -> Rhino3dmBudgets {
    budgets.unwrap_or_default()
}

fn encode_preview_packet(payload: Rhino3dmPreviewPayload) -> Result<Vec<u8>, AppError> {
    let glb_bytes = u64::try_from(payload.bytes.len()).map_err(|_| {
        AppError::Internal("3DM preview GLB length does not fit the packet format.".into())
    })?;
    let header = Rhino3dmPacketHeader {
        packet_version: RHINO3DM_PACKET_VERSION,
        schema_version: RHINO3DM_RESULT_SCHEMA_VERSION,
        protocol_version: RHINO3DM_PROTOCOL_VERSION,
        helper_revision: RHINO3DM_OPENNURBS_REVISION,
        warnings: payload.warnings,
        stats: payload.stats,
        glb_bytes,
    };
    let header_bytes = serde_json::to_vec(&header)
        .map_err(|error| AppError::Serde(format!("failed to encode 3DM packet header: {error}")))?;
    if header_bytes.len() > MAX_PACKET_HEADER_BYTES {
        return Err(AppError::Internal(
            "3DM preview packet header exceeds its safety limit.".into(),
        ));
    }
    let header_len = u32::try_from(header_bytes.len()).map_err(|_| {
        AppError::Internal("3DM preview packet header length does not fit u32.".into())
    })?;
    let total_len = RHINO3DM_PACKET_FIXED_BYTES
        .checked_add(header_bytes.len())
        .and_then(|length| length.checked_add(payload.bytes.len()))
        .ok_or_else(|| AppError::Internal("3DM preview packet length overflow.".into()))?;
    let mut packet = Vec::with_capacity(total_len);
    packet.extend_from_slice(RHINO3DM_PACKET_MAGIC);
    packet.extend_from_slice(&header_len.to_le_bytes());
    packet.extend_from_slice(&header_bytes);
    packet.extend_from_slice(&payload.bytes);
    Ok(packet)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HelperResult {
    schema_version: u32,
    protocol_version: u32,
    helper_revision: String,
    request_id: String,
    ok: bool,
    stage: String,
    counts: HelperCounts,
    timings_ms: HelperTimings,
    output: HelperOutput,
    error: Option<HelperError>,
    warnings: Vec<HelperWarning>,
    #[serde(default)]
    #[allow(dead_code)]
    diagnostic: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HelperCounts {
    objects: u64,
    visible_objects: u64,
    nodes: u64,
    meshes: u64,
    materials: u64,
    vertices: u64,
    indices: u64,
    triangles: u64,
    images: u64,
    image_decoded_bytes: u64,
    reference_expansions: u64,
    max_recursion_depth: u64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HelperTimings {
    read: u64,
    generate: u64,
    write: u64,
    total: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HelperOutput {
    path: String,
    bytes: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HelperWarning {
    kind: String,
    count: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HelperError {
    kind: String,
    message: String,
    stage: Option<String>,
}

struct TempWorkspace {
    dir: PathBuf,
}

impl TempWorkspace {
    fn create(request_id: &str) -> Result<Self, AppError> {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let safe_id = request_id
            .bytes()
            .map(|byte| {
                if byte.is_ascii_alphanumeric() {
                    byte as char
                } else {
                    '_'
                }
            })
            .collect::<String>();
        let dir = std::env::temp_dir().join(format!(
            "yw-look-rhino3dm-{}-{nonce}-{safe_id}",
            std::process::id()
        ));
        fs::create_dir(&dir).map_err(|error| {
            AppError::Io(format!(
                "failed to create 3DM helper temp directory: {error}"
            ))
        })?;
        Ok(Self { dir })
    }

    fn output_path(&self) -> PathBuf {
        self.dir.join("preview.glb.part")
    }

    fn result_path(&self) -> PathBuf {
        self.dir.join("result.json")
    }

    fn stdout_path(&self) -> PathBuf {
        self.dir.join("stdout.log")
    }

    fn stderr_path(&self) -> PathBuf {
        self.dir.join("stderr.log")
    }
}

impl Drop for TempWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

struct RequestGuard<'a> {
    state: &'a Rhino3dmImportState,
    request_id: String,
}

impl Drop for RequestGuard<'_> {
    fn drop(&mut self) {
        self.state.remove(&self.request_id);
    }
}

fn details(
    request_id: &str,
    stage: impl Into<String>,
    limit: Option<u64>,
    observed: Option<u64>,
) -> Rhino3dmErrorDetails {
    Rhino3dmErrorDetails {
        stage: Some(stage.into()),
        limit,
        observed,
        request_id: Some(request_id.to_string()),
        ..Default::default()
    }
}

fn error(
    request_id: &str,
    kind: impl Into<String>,
    message: impl Into<String>,
    stage: impl Into<String>,
    limit: Option<u64>,
    observed: Option<u64>,
) -> AppError {
    AppError::rhino3dm(kind, message, details(request_id, stage, limit, observed))
}

fn validate_request_id(request_id: &str) -> Result<(), AppError> {
    if request_id.trim().is_empty() || request_id.len() > MAX_REQUEST_ID_BYTES {
        return Err(AppError::rhino3dm(
            "invalidFile",
            "requestId must contain 1 to 128 characters.",
            Rhino3dmErrorDetails {
                stage: Some("request".into()),
                ..Default::default()
            },
        ));
    }
    Ok(())
}

fn validate_budgets(budgets: &Rhino3dmBudgets, request_id: &str) -> Result<(), AppError> {
    let fields = [
        ("memory", budgets.memory_bytes),
        ("output", budgets.output_bytes),
        ("result", budgets.result_bytes),
        ("stdout", budgets.stdout_bytes),
        ("stderr", budgets.stderr_bytes),
        ("timeout", budgets.timeout_ms),
        ("vertices", budgets.vertices),
        ("triangles", budgets.triangles),
        ("meshes", budgets.meshes),
        ("materials", budgets.materials),
        ("images", budgets.images),
        ("imageDecodedBytes", budgets.image_decoded_bytes),
        ("referenceExpansions", budgets.reference_expansions),
        ("recursionDepth", budgets.recursion_depth),
    ];
    if let Some((name, value)) = fields.into_iter().find(|(_, value)| *value == 0) {
        return Err(error(
            request_id,
            "outputLimit",
            format!("3DM budget '{name}' must be greater than zero."),
            "budget",
            Some(1),
            Some(value),
        ));
    }
    Ok(())
}

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const RHINO3DM_TOOL_PLATFORM_DIR: &str = "x64-windows";
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const RHINO3DM_TOOL_PLATFORM_DIR: &str = "arm64-osx";

#[cfg(target_os = "windows")]
const RHINO3DM_TOOL_BINARY_NAME: &str = "rhino3dm_preview.exe";
#[cfg(not(target_os = "windows"))]
const RHINO3DM_TOOL_BINARY_NAME: &str = "rhino3dm_preview";

fn resolve_helper_path(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    #[cfg(not(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "macos", target_arch = "aarch64")
    )))]
    {
        let _ = app;
        return Err(AppError::Internal(format!(
            "native 3DM preview is not bundled for this platform ({}-{}).",
            std::env::consts::OS,
            std::env::consts::ARCH
        )));
    }

    #[cfg(any(
        all(target_os = "windows", target_arch = "x86_64"),
        all(target_os = "macos", target_arch = "aarch64")
    ))]
    {
        let relative = PathBuf::from("rhino3dm-tools")
            .join(RHINO3DM_TOOL_PLATFORM_DIR)
            .join(RHINO3DM_TOOL_BINARY_NAME);
        let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(&relative);
        if dev_path.is_file() {
            return Ok(dev_path);
        }
        let resource_path = app
            .path()
            .resource_dir()
            .map_err(|error| {
                AppError::Io(format!(
                    "failed to resolve app resources directory: {error}"
                ))
            })?
            .join(&relative);
        if resource_path.is_file() {
            return Ok(resource_path);
        }
        Err(AppError::Internal(format!(
            "native 3DM preview helper is not bundled: {}",
            relative.display()
        )))
    }
}

fn validate_glb(bytes: &[u8], request_id: &str) -> Result<(), AppError> {
    if bytes.len() < 20 || &bytes[0..4] != b"glTF" {
        return Err(error(
            request_id,
            "helperCrashed",
            "3DM helper returned a GLB with an invalid header.",
            "glbValidation",
            None,
            Some(bytes.len() as u64),
        ));
    }
    let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    let declared_len = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    if version != 2 || declared_len != bytes.len() || declared_len < 20 {
        return Err(error(
            request_id,
            "helperCrashed",
            "3DM helper returned an invalid GLB version or length.",
            "glbValidation",
            Some(bytes.len() as u64),
            Some(declared_len as u64),
        ));
    }
    let first_chunk_len = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    let first_chunk_type = u32::from_le_bytes(bytes[16..20].try_into().unwrap());
    if first_chunk_type != 0x4e4f534a
        || first_chunk_len == 0
        || first_chunk_len % 4 != 0
        || first_chunk_len > bytes.len().saturating_sub(20)
    {
        return Err(error(
            request_id,
            "helperCrashed",
            "3DM helper returned a GLB without a valid JSON chunk.",
            "glbValidation",
            None,
            Some(first_chunk_len as u64),
        ));
    }
    let json_end = 20 + first_chunk_len;
    let json = serde_json::from_slice::<serde_json::Value>(&bytes[20..json_end]).map_err(|_| {
        error(
            request_id,
            "helperCrashed",
            "3DM helper returned a GLB with invalid JSON metadata.",
            "glbValidation",
            None,
            Some(first_chunk_len as u64),
        )
    })?;
    if !json.is_object() {
        return Err(error(
            request_id,
            "helperCrashed",
            "3DM helper returned a GLB with non-object JSON metadata.",
            "glbValidation",
            None,
            Some(first_chunk_len as u64),
        ));
    }
    let mut offset = 12usize;
    let mut chunk_count = 0usize;
    while offset < bytes.len() {
        if bytes.len() - offset < 8 {
            return Err(error(
                request_id,
                "helperCrashed",
                "3DM helper returned a truncated GLB chunk header.",
                "glbValidation",
                None,
                Some(offset as u64),
            ));
        }
        let chunk_len = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        let next = offset
            .checked_add(8)
            .and_then(|value| value.checked_add(chunk_len))
            .ok_or_else(|| {
                error(
                    request_id,
                    "helperCrashed",
                    "3DM helper returned an overflowing GLB chunk.",
                    "glbValidation",
                    None,
                    Some(chunk_len as u64),
                )
            })?;
        if chunk_len % 4 != 0 || next > bytes.len() {
            return Err(error(
                request_id,
                "helperCrashed",
                "3DM helper returned a GLB chunk outside the file.",
                "glbValidation",
                Some(bytes.len() as u64),
                Some(next as u64),
            ));
        }
        chunk_count += 1;
        offset = next;
    }
    if chunk_count == 0 || offset != bytes.len() {
        return Err(error(
            request_id,
            "helperCrashed",
            "3DM helper returned an empty or incomplete GLB.",
            "glbValidation",
            None,
            Some(chunk_count as u64),
        ));
    }
    Ok(())
}

fn validate_stat_budget(
    request_id: &str,
    name: &str,
    value: u64,
    limit: u64,
) -> Result<(), AppError> {
    if value > limit {
        return Err(error(
            request_id,
            "outputLimit",
            format!("3DM preview {name} exceeds the configured budget."),
            name,
            Some(limit),
            Some(value),
        ));
    }
    Ok(())
}

fn status_text(status: ExitStatus) -> String {
    status
        .code()
        .map(|code| code.to_string())
        .unwrap_or_else(|| "signal".into())
}

fn read_capped(
    path: &Path,
    limit: u64,
    label: &str,
    request_id: &str,
) -> Result<Vec<u8>, AppError> {
    let metadata = fs::metadata(path)
        .map_err(|error| AppError::Io(format!("failed to inspect 3DM helper {label}: {error}")))?;
    if metadata.len() > limit {
        return Err(error(
            request_id,
            "outputLimit",
            format!("3DM helper {label} exceeded its output budget."),
            label,
            Some(limit),
            Some(metadata.len()),
        ));
    }
    let capacity = usize::try_from(metadata.len()).map_err(|_| {
        error(
            request_id,
            "outputLimit",
            format!("3DM helper {label} is too large for this process."),
            label,
            Some(limit),
            Some(metadata.len()),
        )
    })?;
    let mut file = File::open(path)
        .map_err(|error| AppError::Io(format!("failed to read 3DM helper {label}: {error}")))?;
    let mut bytes = Vec::with_capacity(capacity);
    file.read_to_end(&mut bytes)
        .map_err(|error| AppError::Io(format!("failed to read 3DM helper {label}: {error}")))?;
    if bytes.len() as u64 > limit {
        return Err(error(
            request_id,
            "outputLimit",
            format!("3DM helper {label} exceeded its output budget while reading."),
            label,
            Some(limit),
            Some(bytes.len() as u64),
        ));
    }
    Ok(bytes)
}

#[cfg(windows)]
enum HelperChild {
    Native(WindowsChild),
    Standard(Child),
}

#[cfg(not(windows))]
type HelperChild = Child;

#[cfg(windows)]
impl HelperChild {
    fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        match self {
            Self::Native(child) => child.try_wait(),
            Self::Standard(child) => child.try_wait(),
        }
    }

    fn kill(&mut self) -> std::io::Result<()> {
        match self {
            Self::Native(child) => child.kill(),
            Self::Standard(child) => child.kill(),
        }
    }

    fn wait(&mut self) -> std::io::Result<ExitStatus> {
        match self {
            Self::Native(child) => child.wait(),
            Self::Standard(child) => child.wait(),
        }
    }
}

#[cfg(not(windows))]
fn child_kill(child: &mut HelperChild) -> std::io::Result<()> {
    child.kill()
}

#[cfg(windows)]
fn child_kill(child: &mut HelperChild) -> std::io::Result<()> {
    child.kill()
}

fn terminate_child(child: &mut HelperChild, limiter: Option<&ProcessLimit>) {
    if let Some(limiter) = limiter {
        limiter.terminate();
    }
    let _ = child_kill(child);
    let _ = child.wait();
}

fn helper_args(
    launcher_args: &[OsString],
    input_path: &Path,
    output_path: &Path,
    result_path: &Path,
    request_id: &str,
    budgets: &Rhino3dmBudgets,
) -> Vec<OsString> {
    let mut args = launcher_args.to_vec();
    args.extend([
        OsString::from("--input"),
        input_path.as_os_str().to_owned(),
        OsString::from("--output"),
        output_path.as_os_str().to_owned(),
        OsString::from("--result"),
        result_path.as_os_str().to_owned(),
        OsString::from("--request-id"),
        OsString::from(request_id),
        OsString::from("--protocol"),
        OsString::from(RHINO3DM_PROTOCOL_VERSION.to_string()),
        OsString::from("--max-output-bytes"),
        OsString::from(budgets.output_bytes.to_string()),
        OsString::from("--max-nodes"),
        OsString::from(budgets.meshes.to_string()),
        OsString::from("--max-vertices"),
        OsString::from(budgets.vertices.to_string()),
        OsString::from("--max-indices"),
        OsString::from(budgets.triangles.saturating_mul(3).to_string()),
        OsString::from("--max-image-decoded-bytes"),
        OsString::from(budgets.image_decoded_bytes.to_string()),
        OsString::from("--max-recursion-depth"),
        OsString::from(budgets.recursion_depth.to_string()),
        OsString::from("--max-reference-expansions"),
        OsString::from(budgets.reference_expansions.to_string()),
        OsString::from("--max-memory-bytes"),
        OsString::from(budgets.memory_bytes.to_string()),
    ]);
    args
}

fn spawn_helper(
    tool_path: &Path,
    args: &[OsString],
    workspace: &TempWorkspace,
    stdout: &File,
    stderr: &File,
    limiter: Option<&ProcessLimit>,
    request_id: &str,
) -> Result<HelperChild, AppError> {
    #[cfg(windows)]
    if let Some(limiter) = limiter {
        return limiter.spawn(tool_path, args, workspace, stdout, stderr, request_id);
    }

    let mut command = Command::new(tool_path);
    command
        .args(args)
        .current_dir(&workspace.dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout.try_clone().map_err(|error| {
            AppError::Io(format!("failed to clone 3DM helper stdout: {error}"))
        })?))
        .stderr(Stdio::from(stderr.try_clone().map_err(|error| {
            AppError::Io(format!("failed to clone 3DM helper stderr: {error}"))
        })?));
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command.spawn().map(HelperChild::from).map_err(|error| {
        AppError::Io(format!(
            "failed to launch native 3DM preview helper: {error}"
        ))
    })
}

fn run_conversion_with_launcher(
    tool_path: &Path,
    launcher_args: &[OsString],
    input_path: &Path,
    request_id: &str,
    budgets: &Rhino3dmBudgets,
    cancel: &AtomicBool,
    enforce_platform_limit: bool,
) -> Result<Rhino3dmPreviewPayload, AppError> {
    validate_budgets(budgets, request_id)?;
    let workspace = TempWorkspace::create(request_id)?;
    let output_path = workspace.output_path();
    let result_path = workspace.result_path();
    let stdout_path = workspace.stdout_path();
    let stderr_path = workspace.stderr_path();

    let stdout = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&stdout_path)
        .map_err(|error| AppError::Io(format!("failed to create 3DM helper stdout: {error}")))?;
    let stderr = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&stderr_path)
        .map_err(|error| AppError::Io(format!("failed to create 3DM helper stderr: {error}")))?;

    let limiter = if enforce_platform_limit {
        Some(ProcessLimit::new(budgets.memory_bytes, request_id)?)
    } else {
        None
    };
    let args = helper_args(
        launcher_args,
        input_path,
        &output_path,
        &result_path,
        request_id,
        budgets,
    );
    let mut child = spawn_helper(
        tool_path,
        &args,
        &workspace,
        &stdout,
        &stderr,
        limiter.as_ref(),
        request_id,
    )?;

    let started = Instant::now();
    let status = loop {
        if cancel.load(std::sync::atomic::Ordering::Acquire) {
            terminate_child(&mut child, limiter.as_ref());
            return Err(error(
                request_id,
                "cancelled",
                "3DM preview conversion was canceled.",
                "process",
                None,
                Some(started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64),
            ));
        }
        let elapsed_ms = started.elapsed().as_millis();
        if elapsed_ms >= u128::from(budgets.timeout_ms) {
            terminate_child(&mut child, limiter.as_ref());
            return Err(error(
                request_id,
                "timeout",
                "3DM preview conversion timed out.",
                "process",
                Some(budgets.timeout_ms),
                Some(elapsed_ms.min(u128::from(u64::MAX)) as u64),
            ));
        }
        for (path, max, label) in [
            (&stdout_path, budgets.stdout_bytes, "helperStdout"),
            (&stderr_path, budgets.stderr_bytes, "helperStderr"),
        ] {
            let size = fs::metadata(path)
                .map(|metadata| metadata.len())
                .unwrap_or_default();
            if size > max {
                terminate_child(&mut child, limiter.as_ref());
                return Err(error(
                    request_id,
                    "outputLimit",
                    format!("3DM helper {label} exceeded its output budget."),
                    label,
                    Some(max),
                    Some(size),
                ));
            }
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(wait_error) => {
                terminate_child(&mut child, limiter.as_ref());
                return Err(error(
                    request_id,
                    "helperCrashed",
                    format!("failed to wait for 3DM helper: {wait_error}"),
                    "process",
                    None,
                    None,
                ));
            }
        }
    };

    let result_bytes = match read_capped(&result_path, budgets.result_bytes, "result", request_id) {
        Ok(bytes) => bytes,
        Err(read_error) => {
            if !status.success() {
                let _ = read_capped(
                    &stderr_path,
                    budgets.stderr_bytes,
                    "helperStderr",
                    request_id,
                );
            }
            return Err(match read_error {
                AppError::Rhino3dm { ref kind, .. } if kind == "outputLimit" => read_error,
                _ => error(
                    request_id,
                    "helperCrashed",
                    "3DM helper exited without publishing a result JSON.",
                    "result",
                    None,
                    None,
                ),
            });
        }
    };
    let helper_result: HelperResult =
        serde_json::from_slice(&result_bytes).map_err(|parse_error| {
            error(
                request_id,
                "helperCrashed",
                format!("3DM helper result JSON is invalid: {parse_error}"),
                "resultParse",
                None,
                Some(result_bytes.len() as u64),
            )
        })?;
    if helper_result.schema_version != RHINO3DM_RESULT_SCHEMA_VERSION
        || helper_result.protocol_version != RHINO3DM_PROTOCOL_VERSION
    {
        return Err(error(
            request_id,
            "helperCrashed",
            "3DM helper result protocol version is unsupported.",
            "protocol",
            Some(RHINO3DM_PROTOCOL_VERSION as u64),
            Some(helper_result.protocol_version as u64),
        ));
    }
    if helper_result.helper_revision != RHINO3DM_OPENNURBS_REVISION {
        return Err(error(
            request_id,
            "helperCrashed",
            "3DM helper openNURBS revision does not match the bundled contract.",
            "protocol",
            None,
            None,
        ));
    }
    if helper_result.request_id != request_id {
        return Err(error(
            request_id,
            "helperCrashed",
            "3DM helper returned a result for another requestId.",
            "protocol",
            None,
            None,
        ));
    }
    let warning_bytes = helper_result
        .warnings
        .iter()
        .map(|warning| warning.kind.len())
        .sum::<usize>();
    if helper_result.warnings.len() > MAX_WARNING_COUNT || warning_bytes > MAX_WARNING_BYTES {
        return Err(error(
            request_id,
            "outputLimit",
            "3DM helper warnings exceed the result budget.",
            "warnings",
            Some(MAX_WARNING_BYTES as u64),
            Some(warning_bytes as u64),
        ));
    }
    let stats = Rhino3dmStats {
        objects: helper_result.counts.objects,
        visible_objects: helper_result.counts.visible_objects,
        nodes: helper_result.counts.nodes,
        meshes: helper_result.counts.meshes,
        materials: helper_result.counts.materials,
        vertices: helper_result.counts.vertices,
        indices: helper_result.counts.indices,
        triangles: helper_result.counts.triangles,
        images: helper_result.counts.images,
        image_decoded_bytes: helper_result.counts.image_decoded_bytes,
        reference_expansions: helper_result.counts.reference_expansions,
        max_recursion_depth: helper_result.counts.max_recursion_depth,
        output_bytes: helper_result.output.bytes,
        read_ms: helper_result.timings_ms.read,
        generate_ms: helper_result.timings_ms.generate,
        write_ms: helper_result.timings_ms.write,
        total_ms: helper_result.timings_ms.total,
    };
    for (name, value, limit) in [
        ("nodes", stats.nodes, budgets.meshes),
        ("vertices", stats.vertices, budgets.vertices),
        (
            "indices",
            stats.indices,
            budgets.triangles.saturating_mul(3),
        ),
        ("triangles", stats.triangles, budgets.triangles),
        ("materials", stats.materials, budgets.materials),
        ("images", stats.images, budgets.images),
        (
            "imageDecodedBytes",
            stats.image_decoded_bytes,
            budgets.image_decoded_bytes,
        ),
        (
            "referenceExpansions",
            stats.reference_expansions,
            budgets.reference_expansions,
        ),
        (
            "maxRecursionDepth",
            stats.max_recursion_depth,
            budgets.recursion_depth,
        ),
    ] {
        validate_stat_budget(request_id, name, value, limit)?;
    }

    if !helper_result.ok {
        let memory_limit = helper_result
            .error
            .as_ref()
            .is_some_and(|error| error.kind == "memoryLimit");
        let helper_error = helper_result.error.ok_or_else(|| {
            error(
                request_id,
                "helperCrashed",
                "3DM helper reported an error without structured details.",
                "result",
                None,
                None,
            )
        })?;
        let accepted = matches!(
            helper_error.kind.as_str(),
            "memoryLimit"
                | "allocationFailed"
                | "outputLimit"
                | "invalidFile"
                | "noPreviewGeometry"
                | "helperCrashed"
                | "timeout"
                | "cancelled"
        );
        if !accepted {
            return Err(error(
                request_id,
                "helperCrashed",
                "3DM helper returned an unknown error kind.",
                "result",
                None,
                None,
            ));
        }
        return Err(AppError::rhino3dm(
            helper_error.kind,
            helper_error.message,
            Rhino3dmErrorDetails {
                stage: helper_error
                    .stage
                    .or_else(|| Some(helper_result.stage.clone())),
                limit: memory_limit.then_some(budgets.memory_bytes),
                observed: None,
                request_id: Some(request_id.to_string()),
                protocol_version: Some(helper_result.protocol_version),
                revision: Some(helper_result.helper_revision),
                exit_status: Some(status_text(status)),
            },
        ));
    }
    if !status.success() {
        return Err(error(
            request_id,
            "helperCrashed",
            "3DM helper exited without a successful result.",
            "process",
            None,
            Some(status.code().unwrap_or_default() as u64),
        ));
    }
    if helper_result.error.is_some() {
        return Err(error(
            request_id,
            "helperCrashed",
            "3DM helper returned an error alongside a successful status.",
            "result",
            None,
            None,
        ));
    }
    let reported_output = PathBuf::from(&helper_result.output.path);
    let expected_output = fs::canonicalize(&output_path).map_err(|error| {
        AppError::Io(format!("failed to inspect native 3DM output path: {error}"))
    })?;
    let actual_reported = fs::canonicalize(&reported_output).map_err(|io_error| {
        error(
            request_id,
            "helperCrashed",
            format!("3DM helper reported an unavailable output path: {io_error}"),
            "outputPath",
            None,
            None,
        )
    })?;
    if actual_reported != expected_output {
        return Err(error(
            request_id,
            "helperCrashed",
            "3DM helper attempted to publish outside the parent-owned output path.",
            "outputPath",
            None,
            None,
        ));
    }
    if helper_result.output.bytes > budgets.output_bytes {
        return Err(error(
            request_id,
            "outputLimit",
            "3DM helper GLB exceeds the configured output budget.",
            "glb",
            Some(budgets.output_bytes),
            Some(helper_result.output.bytes),
        ));
    }
    let glb = match read_capped(&output_path, budgets.output_bytes, "GLB", request_id) {
        Ok(glb) => glb,
        Err(read_error) => {
            if matches!(
                &read_error,
                AppError::Rhino3dm { kind, .. } if kind == "outputLimit"
            ) {
                return Err(read_error);
            }
            return Err(error(
                request_id,
                "helperCrashed",
                "3DM helper reported success but did not publish a readable GLB.",
                "glb",
                None,
                None,
            ));
        }
    };
    if helper_result.output.bytes != glb.len() as u64 {
        return Err(error(
            request_id,
            "helperCrashed",
            "3DM helper GLB length does not match the result declaration.",
            "glbValidation",
            Some(helper_result.output.bytes),
            Some(glb.len() as u64),
        ));
    }
    validate_glb(&glb, request_id)?;
    Ok(Rhino3dmPreviewPayload {
        bytes: glb,
        warnings: helper_result
            .warnings
            .into_iter()
            .map(|warning| Rhino3dmWarning {
                kind: warning.kind,
                count: warning.count,
            })
            .collect::<Vec<_>>(),
        stats,
    })
}

fn run_conversion(
    tool_path: &Path,
    input_path: &Path,
    request_id: &str,
    budgets: &Rhino3dmBudgets,
    cancel: &AtomicBool,
    enforce_platform_limit: bool,
) -> Result<Rhino3dmPreviewPayload, AppError> {
    run_conversion_with_launcher(
        tool_path,
        &[],
        input_path,
        request_id,
        budgets,
        cancel,
        enforce_platform_limit,
    )
}

#[tauri::command]
pub(crate) async fn convert_rhino3dm_preview(
    app: tauri::AppHandle,
    path: String,
    request_id: String,
    budgets: Option<Rhino3dmBudgets>,
    state: State<'_, Rhino3dmImportState>,
) -> Result<tauri::ipc::Response, AppError> {
    validate_request_id(&request_id)?;
    let cancel = Arc::new(AtomicBool::new(false));
    state.register(request_id.clone(), Arc::clone(&cancel))?;
    let _guard = RequestGuard {
        state: &state,
        request_id: request_id.clone(),
    };
    let normalized = normalize_file_path(PathBuf::from(path))?;
    if normalized
        .extension()
        .and_then(|value| value.to_str())
        .is_none_or(|value| !value.eq_ignore_ascii_case("3dm"))
    {
        return Err(error(
            &request_id,
            "invalidFile",
            "native 3DM preview only accepts .3dm files.",
            "input",
            None,
            None,
        ));
    }
    let metadata = fs::metadata(&normalized)
        .map_err(|error| AppError::Io(format!("failed to inspect native 3DM input: {error}")))?;
    if !metadata.is_file() {
        return Err(error(
            &request_id,
            "invalidFile",
            "native 3DM preview input is not a regular file.",
            "input",
            None,
            Some(metadata.len()),
        ));
    }
    let tool_path = resolve_helper_path(&app)?;
    let budgets = resolve_budgets(budgets);
    let exclusive_lock = state.exclusive_lock();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _state_lock = crate::shared::lock_or_recover(&exclusive_lock, "3DM helper execution");
        if cancel.load(std::sync::atomic::Ordering::Acquire) {
            return Err(error(
                &request_id,
                "cancelled",
                "3DM preview conversion was canceled before helper startup.",
                "request",
                None,
                None,
            ));
        }
        run_conversion(
            &tool_path,
            &normalized,
            &request_id,
            &budgets,
            &cancel,
            true,
        )
    })
    .await
    .map_err(|join_error| AppError::Internal(format!("native 3DM worker failed: {join_error}")))?;
    let payload = result?;
    let packet = encode_preview_packet(payload)?;
    Ok(tauri::ipc::Response::new(packet))
}

#[tauri::command]
pub(crate) fn cancel_rhino3dm_preview(
    request_id: String,
    state: State<'_, Rhino3dmImportState>,
) -> bool {
    state.cancel(request_id)
}

#[cfg(windows)]
struct ProcessLimit {
    handle: *mut std::ffi::c_void,
}

#[cfg(windows)]
unsafe impl Send for ProcessLimit {}

#[cfg(windows)]
struct WindowsChild {
    process: *mut std::ffi::c_void,
}

#[cfg(windows)]
unsafe impl Send for WindowsChild {}

#[cfg(windows)]
impl From<Child> for HelperChild {
    fn from(child: Child) -> Self {
        Self::Standard(child)
    }
}

#[cfg(windows)]
#[repr(C)]
struct JobBasicLimitInformation {
    per_process_user_time_limit: i64,
    per_job_user_time_limit: i64,
    limit_flags: u32,
    minimum_working_set_size: usize,
    maximum_working_set_size: usize,
    active_process_limit: u32,
    affinity: usize,
    priority_class: u32,
    scheduling_class: u32,
}

#[cfg(windows)]
#[repr(C)]
struct IoCounters {
    read_operation_count: u64,
    write_operation_count: u64,
    other_operation_count: u64,
    read_transfer_count: u64,
    write_transfer_count: u64,
    other_transfer_count: u64,
}

#[cfg(windows)]
#[repr(C)]
struct JobExtendedLimitInformation {
    basic_limit_information: JobBasicLimitInformation,
    io_info: IoCounters,
    process_memory_limit: usize,
    job_memory_limit: usize,
    peak_process_memory_used: usize,
    peak_job_memory_used: usize,
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
    fn CreateJobObjectW(
        attributes: *const std::ffi::c_void,
        name: *const u16,
    ) -> *mut std::ffi::c_void;
    fn CreateProcessW(
        application_name: *const u16,
        command_line: *mut u16,
        process_attributes: *mut std::ffi::c_void,
        thread_attributes: *mut std::ffi::c_void,
        inherit_handles: i32,
        creation_flags: u32,
        environment: *const std::ffi::c_void,
        current_directory: *const u16,
        startup_info: *mut StartupInfoW,
        process_information: *mut ProcessInformation,
    ) -> i32;
    fn DeleteProcThreadAttributeList(attribute_list: *mut ProcThreadAttributeList);
    fn GetExitCodeProcess(process: *mut std::ffi::c_void, exit_code: *mut u32) -> i32;
    fn InitializeProcThreadAttributeList(
        attribute_list: *mut ProcThreadAttributeList,
        attribute_count: u32,
        flags: u32,
        size: *mut usize,
    ) -> i32;
    fn SetHandleInformation(handle: *mut std::ffi::c_void, mask: u32, flags: u32) -> i32;
    fn SetInformationJobObject(
        job: *mut std::ffi::c_void,
        info_class: u32,
        info: *mut std::ffi::c_void,
        info_length: u32,
    ) -> i32;
    fn TerminateJobObject(job: *mut std::ffi::c_void, exit_code: u32) -> i32;
    fn TerminateProcess(process: *mut std::ffi::c_void, exit_code: u32) -> i32;
    fn UpdateProcThreadAttribute(
        attribute_list: *mut ProcThreadAttributeList,
        flags: u32,
        attribute: usize,
        value: *const std::ffi::c_void,
        size: usize,
        previous_value: *mut std::ffi::c_void,
        return_size: *mut usize,
    ) -> i32;
    fn WaitForSingleObject(handle: *mut std::ffi::c_void, milliseconds: u32) -> u32;
}

#[cfg(windows)]
#[repr(C)]
struct ProcThreadAttributeList {
    _private: [u8; 0],
}

#[cfg(windows)]
#[repr(C)]
struct StartupInfoW {
    cb: u32,
    lp_reserved: *mut u16,
    lp_desktop: *mut u16,
    lp_title: *mut u16,
    dw_x: u32,
    dw_y: u32,
    dw_x_size: u32,
    dw_y_size: u32,
    dw_x_count_chars: u32,
    dw_y_count_chars: u32,
    dw_fill_attribute: u32,
    dw_flags: u32,
    w_show_window: u16,
    cb_reserved2: u16,
    lp_reserved2: *mut u8,
    h_std_input: *mut std::ffi::c_void,
    h_std_output: *mut std::ffi::c_void,
    h_std_error: *mut std::ffi::c_void,
}

#[cfg(windows)]
#[repr(C)]
struct StartupInfoExW {
    startup_info: StartupInfoW,
    attribute_list: *mut ProcThreadAttributeList,
}

#[cfg(windows)]
#[repr(C)]
struct ProcessInformation {
    process: *mut std::ffi::c_void,
    thread: *mut std::ffi::c_void,
    process_id: u32,
    thread_id: u32,
}

#[cfg(windows)]
struct AttributeList {
    list: *mut ProcThreadAttributeList,
    _storage: Vec<usize>,
    jobs: Vec<*mut std::ffi::c_void>,
    handles: Vec<*mut std::ffi::c_void>,
}

#[cfg(windows)]
impl AttributeList {
    fn new(job: *mut std::ffi::c_void, handles: &[*mut std::ffi::c_void]) -> std::io::Result<Self> {
        let mut size = 0usize;
        let first =
            unsafe { InitializeProcThreadAttributeList(std::ptr::null_mut(), 2, 0, &mut size) };
        if first != 0 || size == 0 {
            return Err(std::io::Error::last_os_error());
        }
        let words = (size + std::mem::size_of::<usize>() - 1) / std::mem::size_of::<usize>();
        let mut storage = vec![0usize; words];
        let list = storage.as_mut_ptr().cast::<ProcThreadAttributeList>();
        if unsafe { InitializeProcThreadAttributeList(list, 2, 0, &mut size) } == 0 {
            return Err(std::io::Error::last_os_error());
        }
        let result = Self {
            list,
            _storage: storage,
            jobs: vec![job],
            handles: handles.to_vec(),
        };
        if unsafe {
            UpdateProcThreadAttribute(
                result.list,
                0,
                0x0002_000d,
                result.jobs.as_ptr().cast(),
                std::mem::size_of_val(result.jobs.as_slice()),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error());
        }
        if unsafe {
            UpdateProcThreadAttribute(
                result.list,
                0,
                0x0002_0002,
                result.handles.as_ptr().cast(),
                std::mem::size_of_val(result.handles.as_slice()),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error());
        }
        Ok(result)
    }
}

#[cfg(windows)]
impl Drop for AttributeList {
    fn drop(&mut self) {
        unsafe { DeleteProcThreadAttributeList(self.list) };
    }
}

#[cfg(windows)]
fn quote_windows_arg(value: &OsStr, output: &mut Vec<u16>) {
    use std::os::windows::ffi::OsStrExt;
    output.push('"' as u16);
    let mut backslashes = 0usize;
    for unit in value.encode_wide() {
        if unit == '\\' as u16 {
            backslashes += 1;
        } else if unit == '"' as u16 {
            output.extend(std::iter::repeat_n('\\' as u16, backslashes * 2 + 1));
            output.push('"' as u16);
            backslashes = 0;
        } else {
            output.extend(std::iter::repeat_n('\\' as u16, backslashes));
            output.push(unit);
            backslashes = 0;
        }
    }
    output.extend(std::iter::repeat_n('\\' as u16, backslashes * 2));
    output.push('"' as u16);
}

#[cfg(windows)]
fn windows_command_line(tool_path: &Path, args: &[OsString]) -> Vec<u16> {
    let mut line = Vec::new();
    quote_windows_arg(tool_path.as_os_str(), &mut line);
    for arg in args {
        line.push(' ' as u16);
        quote_windows_arg(arg, &mut line);
    }
    line.push(0);
    line
}

#[cfg(windows)]
fn set_inheritable(handle: *mut std::ffi::c_void) -> std::io::Result<()> {
    if unsafe { SetHandleInformation(handle, 1, 1) } == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
impl WindowsChild {
    fn spawn(
        tool_path: &Path,
        args: &[OsString],
        workspace: &TempWorkspace,
        stdout: &File,
        stderr: &File,
        job: *mut std::ffi::c_void,
        request_id: &str,
    ) -> Result<Self, AppError> {
        use std::os::windows::ffi::OsStrExt;
        use std::os::windows::io::AsRawHandle;

        let stdin = OpenOptions::new()
            .read(true)
            .open("NUL")
            .map_err(|io_error| {
                error(
                    request_id,
                    "helperCrashed",
                    format!("failed to open native 3DM helper stdin: {io_error}"),
                    "limitSetup",
                    None,
                    None,
                )
            })?;
        let stdin_handle = stdin.as_raw_handle().cast();
        let stdout_handle = stdout.as_raw_handle().cast();
        let stderr_handle = stderr.as_raw_handle().cast();
        for handle in [stdin_handle, stdout_handle, stderr_handle] {
            set_inheritable(handle).map_err(|io_error| {
                error(
                    request_id,
                    "helperCrashed",
                    format!("failed to prepare native 3DM helper stdio: {io_error}"),
                    "limitSetup",
                    None,
                    None,
                )
            })?;
        }
        let handles = [stdin_handle, stdout_handle, stderr_handle];
        let attributes = AttributeList::new(job, &handles).map_err(|io_error| {
            error(
                request_id,
                "helperCrashed",
                format!("failed to configure native 3DM process attributes: {io_error}"),
                "limitSetup",
                None,
                None,
            )
        })?;
        let mut command_line = windows_command_line(tool_path, args);
        let current_directory = workspace
            .dir
            .as_os_str()
            .encode_wide()
            .chain([0])
            .collect::<Vec<_>>();
        let mut startup = StartupInfoExW {
            startup_info: StartupInfoW {
                cb: std::mem::size_of::<StartupInfoExW>() as u32,
                lp_reserved: std::ptr::null_mut(),
                lp_desktop: std::ptr::null_mut(),
                lp_title: std::ptr::null_mut(),
                dw_x: 0,
                dw_y: 0,
                dw_x_size: 0,
                dw_y_size: 0,
                dw_x_count_chars: 0,
                dw_y_count_chars: 0,
                dw_fill_attribute: 0,
                dw_flags: 0x0000_0100,
                w_show_window: 0,
                cb_reserved2: 0,
                lp_reserved2: std::ptr::null_mut(),
                h_std_input: stdin_handle,
                h_std_output: stdout_handle,
                h_std_error: stderr_handle,
            },
            attribute_list: attributes.list,
        };
        let mut process_info = ProcessInformation {
            process: std::ptr::null_mut(),
            thread: std::ptr::null_mut(),
            process_id: 0,
            thread_id: 0,
        };
        let created = unsafe {
            CreateProcessW(
                std::ptr::null(),
                command_line.as_mut_ptr(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                1,
                0x0008_0000 | 0x0800_0000,
                std::ptr::null(),
                current_directory.as_ptr(),
                (&mut startup as *mut StartupInfoExW).cast::<StartupInfoW>(),
                &mut process_info,
            )
        };
        for handle in handles {
            let _ = unsafe { SetHandleInformation(handle, 1, 0) };
        }
        drop(attributes);
        if created == 0 {
            return Err(error(
                request_id,
                "helperCrashed",
                format!(
                    "failed to create the native 3DM helper in its limiting job: {}",
                    std::io::Error::last_os_error()
                ),
                "limitSetup",
                None,
                None,
            ));
        }
        unsafe { CloseHandle(process_info.thread) };
        Ok(Self {
            process: process_info.process,
        })
    }

    fn status(&self) -> std::io::Result<ExitStatus> {
        use std::os::windows::process::ExitStatusExt;
        let mut code = 0u32;
        if unsafe { GetExitCodeProcess(self.process, &mut code) } == 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(ExitStatus::from_raw(code))
        }
    }

    fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        match unsafe { WaitForSingleObject(self.process, 0) } {
            0 => self.status().map(Some),
            258 => Ok(None),
            _ => Err(std::io::Error::last_os_error()),
        }
    }

    fn kill(&mut self) -> std::io::Result<()> {
        if unsafe { TerminateProcess(self.process, 1) } == 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    fn wait(&mut self) -> std::io::Result<ExitStatus> {
        if unsafe { WaitForSingleObject(self.process, 0xffff_ffff) } != 0 {
            return Err(std::io::Error::last_os_error());
        }
        self.status()
    }
}

#[cfg(windows)]
impl Drop for WindowsChild {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.process);
        }
    }
}

#[cfg(windows)]
impl ProcessLimit {
    fn new(limit: u64, request_id: &str) -> Result<Self, AppError> {
        let process_limit = usize::try_from(limit).map_err(|_| {
            error(
                request_id,
                "outputLimit",
                "3DM memory budget does not fit the host process address size.",
                "limitSetup",
                Some(usize::MAX as u64),
                Some(limit),
            )
        })?;
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(error(
                request_id,
                "helperCrashed",
                "failed to create the Windows memory-limited helper job.",
                "limitSetup",
                Some(limit),
                None,
            ));
        }
        let mut info: JobExtendedLimitInformation = unsafe { std::mem::zeroed() };
        info.basic_limit_information.limit_flags = 0x0000_0100 | 0x0000_2000;
        info.process_memory_limit = process_limit;
        let size = u32::try_from(std::mem::size_of::<JobExtendedLimitInformation>()).unwrap();
        let set_ok = unsafe {
            SetInformationJobObject(
                handle,
                9,
                (&mut info as *mut JobExtendedLimitInformation).cast(),
                size,
            )
        };
        if set_ok == 0 {
            unsafe { CloseHandle(handle) };
            return Err(error(
                request_id,
                "helperCrashed",
                "failed to configure the Windows memory-limited helper job.",
                "limitSetup",
                Some(limit),
                None,
            ));
        }
        if let Err(set_error) = set_inheritable(handle) {
            unsafe { CloseHandle(handle) };
            return Err(error(
                request_id,
                "helperCrashed",
                format!("failed to prepare the Windows limiting job handle: {set_error}"),
                "limitSetup",
                Some(limit),
                None,
            ));
        }
        Ok(Self { handle })
    }

    fn spawn(
        &self,
        tool_path: &Path,
        args: &[OsString],
        workspace: &TempWorkspace,
        stdout: &File,
        stderr: &File,
        request_id: &str,
    ) -> Result<HelperChild, AppError> {
        WindowsChild::spawn(
            tool_path,
            args,
            workspace,
            stdout,
            stderr,
            self.handle,
            request_id,
        )
        .map(HelperChild::Native)
    }

    fn terminate(&self) {
        unsafe {
            let _ = TerminateJobObject(self.handle, 1);
        }
    }
}

#[cfg(windows)]
impl Drop for ProcessLimit {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.handle);
        }
    }
}

#[cfg(not(windows))]
struct ProcessLimit;

#[cfg(not(windows))]
impl ProcessLimit {
    fn new(limit: u64, request_id: &str) -> Result<Self, AppError> {
        let _ = limit;
        Err(error(
            request_id,
            "helperCrashed",
            "native 3DM conversion has no verified process memory limit on this platform.",
            "limitSetup",
            None,
            None,
        ))
    }

    fn terminate(&self) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    static FAKE_HELPER_LOCK: Mutex<()> = Mutex::new(());

    fn valid_glb(binary_len: usize) -> Vec<u8> {
        let json = b"{}  ";
        let length = 12 + 8 + json.len() + if binary_len > 0 { 8 + binary_len } else { 0 };
        let mut glb = Vec::with_capacity(length);
        glb.extend_from_slice(b"glTF");
        glb.extend_from_slice(&2u32.to_le_bytes());
        glb.extend_from_slice(&(length as u32).to_le_bytes());
        glb.extend_from_slice(&(json.len() as u32).to_le_bytes());
        glb.extend_from_slice(&0x4e4f534au32.to_le_bytes());
        glb.extend_from_slice(json);
        if binary_len > 0 {
            glb.extend_from_slice(&(binary_len as u32).to_le_bytes());
            glb.extend_from_slice(&0x004e4942u32.to_le_bytes());
            glb.resize(glb.len() + binary_len, 0);
        }
        glb
    }

    fn fake_result(
        request_id: &str,
        output_path: &Path,
        ok: bool,
        error: Option<serde_json::Value>,
        glb_bytes: u64,
    ) -> String {
        serde_json::json!({
            "schemaVersion": RHINO3DM_RESULT_SCHEMA_VERSION,
            "protocolVersion": RHINO3DM_PROTOCOL_VERSION,
            "helperRevision": RHINO3DM_OPENNURBS_REVISION,
            "requestId": request_id,
            "ok": ok,
            "stage": if ok { "complete" } else { "parse" },
            "counts": {"objects": 1, "visibleObjects": 1, "nodes": 1, "meshes": 1, "materials": 1, "vertices": 3, "indices": 3, "triangles": 1, "images": 0, "imageDecodedBytes": 0, "referenceExpansions": 0, "maxRecursionDepth": 0},
            "timingsMs": {"read": 1, "generate": 1, "write": 1, "total": 3},
            "output": {"path": output_path, "bytes": glb_bytes},
            "error": error,
            "warnings": [{"kind":"fixtureWarning", "count":1}]
        })
        .to_string()
    }

    // This test doubles as a tiny fixture helper when invoked by a parent test
    // process. It is inert during the normal test run.
    #[test]
    fn fake_helper_entrypoint() {
        if std::env::var("YW_LOOK_RHINO3DM_FAKE_HELPER")
            .ok()
            .as_deref()
            != Some("1")
        {
            return;
        }
        let mode = std::env::var("YW_LOOK_RHINO3DM_FAKE_MODE").unwrap_or_default();
        if matches!(mode.as_str(), "timeout" | "cancel") {
            thread::sleep(Duration::from_secs(30));
            return;
        }
        if mode == "crash" {
            std::process::exit(9);
        }
        if mode == "marker" {
            let marker = PathBuf::from(std::env::var_os("YW_LOOK_RHINO3DM_FAKE_MARKER").unwrap());
            fs::write(marker, b"started").unwrap();
        }
        let output = PathBuf::from(std::env::var_os("YW_LOOK_RHINO3DM_FAKE_OUTPUT").unwrap());
        let result = PathBuf::from(std::env::var_os("YW_LOOK_RHINO3DM_FAKE_RESULT").unwrap());
        let request_id = std::env::var("YW_LOOK_RHINO3DM_FAKE_REQUEST").unwrap();
        if mode == "memory" {
            fs::write(
                result,
                fake_result(
                    &request_id,
                    &output,
                    false,
                    Some(serde_json::json!({"kind":"memoryLimit","message":"fixture memory limit","stage":"parse"})),
                    0,
                ),
            )
            .unwrap();
            return;
        }
        let glb = valid_glb(if mode == "output" { 2048 } else { 0 });
        fs::write(&output, &glb).unwrap();
        fs::write(
            result,
            fake_result(&request_id, &output, true, None, glb.len() as u64),
        )
        .unwrap();
    }

    fn fake_launcher(temp: &Path) -> (PathBuf, Vec<OsString>) {
        let test_exe = std::env::current_exe().unwrap();
        let script = temp.join(if cfg!(windows) { "fake.cmd" } else { "fake.sh" });
        if cfg!(windows) {
            let escaped = test_exe.to_string_lossy().replace('%', "%%");
            fs::write(
                &script,
                format!(
                    "@echo off\r\nset YW_LOOK_RHINO3DM_FAKE_OUTPUT=%~4\r\nset YW_LOOK_RHINO3DM_FAKE_RESULT=%~6\r\nset YW_LOOK_RHINO3DM_FAKE_REQUEST=%~8\r\n\"{escaped}\" fake_helper_entrypoint --nocapture\r\nexit /b %ERRORLEVEL%\r\n"
                ),
            )
            .unwrap();
            (
                PathBuf::from(
                    std::env::var_os("COMSPEC").unwrap_or_else(|| OsString::from("cmd.exe")),
                ),
                vec![OsString::from("/C"), script.into_os_string()],
            )
        } else {
            fs::write(
                &script,
                format!(
                    "#!/bin/sh\nexport YW_LOOK_RHINO3DM_FAKE_OUTPUT=\"$4\"\nexport YW_LOOK_RHINO3DM_FAKE_RESULT=\"$6\"\nexport YW_LOOK_RHINO3DM_FAKE_REQUEST=\"$8\"\n\"{}\" fake_helper_entrypoint --nocapture\n",
                    test_exe.display()
                ),
            )
            .unwrap();
            make_executable(&script);
            (script, Vec::new())
        }
    }

    #[cfg(unix)]
    fn make_executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).unwrap();
    }

    #[cfg(not(unix))]
    fn make_executable(_path: &Path) {}

    fn run_fixture_with_limit(
        mode: &str,
        budgets: Rhino3dmBudgets,
        enforce_platform_limit: bool,
        marker: Option<&Path>,
    ) -> Result<Rhino3dmPreviewPayload, AppError> {
        let _lock = FAKE_HELPER_LOCK.lock().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let input = temp.path().join("fixture.3dm");
        fs::write(&input, b"3dm fixture").unwrap();
        let request_id = format!("fixture-{mode}");
        let (program, prefix) = fake_launcher(temp.path());
        std::env::set_var("YW_LOOK_RHINO3DM_FAKE_HELPER", "1");
        std::env::set_var("YW_LOOK_RHINO3DM_FAKE_MODE", mode);
        if let Some(marker) = marker {
            std::env::set_var("YW_LOOK_RHINO3DM_FAKE_MARKER", marker);
        }
        let cancel = AtomicBool::new(false);
        let result_value = run_conversion_with_launcher(
            &program,
            &prefix,
            &input,
            &request_id,
            &budgets,
            &cancel,
            enforce_platform_limit,
        );
        std::env::remove_var("YW_LOOK_RHINO3DM_FAKE_HELPER");
        std::env::remove_var("YW_LOOK_RHINO3DM_FAKE_MODE");
        std::env::remove_var("YW_LOOK_RHINO3DM_FAKE_MARKER");
        std::env::remove_var("YW_LOOK_RHINO3DM_FAKE_OUTPUT");
        std::env::remove_var("YW_LOOK_RHINO3DM_FAKE_RESULT");
        std::env::remove_var("YW_LOOK_RHINO3DM_FAKE_REQUEST");
        result_value
    }

    fn run_fixture(
        mode: &str,
        budgets: Rhino3dmBudgets,
    ) -> Result<Rhino3dmPreviewPayload, AppError> {
        run_fixture_with_limit(mode, budgets, false, None)
    }

    #[test]
    fn validates_glb_header_and_length() {
        let request = "glb-test";
        validate_glb(&valid_glb(0), request).unwrap();
        let mut bad = valid_glb(0);
        bad[8] = 0;
        assert!(
            matches!(validate_glb(&bad, request), Err(AppError::Rhino3dm { kind, .. }) if kind == "helperCrashed")
        );
        let mut bad_json = valid_glb(0);
        bad_json[20] = b'[';
        assert!(
            matches!(validate_glb(&bad_json, request), Err(AppError::Rhino3dm { kind, .. }) if kind == "helperCrashed")
        );
    }

    #[test]
    fn fake_helper_low_budget_and_next_request_are_recoverable() {
        let mut budgets = Rhino3dmBudgets::default();
        budgets.output_bytes = 1024;
        let error = run_fixture("output", budgets).unwrap_err();
        assert!(matches!(error, AppError::Rhino3dm { kind, .. } if kind == "outputLimit"));
        let next = run_fixture("success", Rhino3dmBudgets::default()).unwrap();
        assert_eq!(next.stats.meshes, 1);
    }

    #[test]
    fn fake_helper_reports_structured_memory_error() {
        let mut budgets = Rhino3dmBudgets::default();
        budgets.memory_bytes = 1;
        let error = run_fixture("memory", budgets).unwrap_err();
        match error {
            AppError::Rhino3dm { kind, details, .. } => {
                assert_eq!(kind, "memoryLimit");
                assert_eq!(details.stage.as_deref(), Some("parse"));
                assert_eq!(details.limit, Some(1));
                assert_eq!(details.observed, None);
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn fake_helper_timeout_is_distinct_from_crash() {
        let mut budgets = Rhino3dmBudgets::default();
        budgets.timeout_ms = 100;
        let error = run_fixture("timeout", budgets).unwrap_err();
        assert!(matches!(error, AppError::Rhino3dm { kind, .. } if kind == "timeout"));
    }

    #[test]
    fn fake_helper_crash_without_result_is_not_classified_as_memory_limit() {
        let error = run_fixture("crash", Rhino3dmBudgets::default()).unwrap_err();
        assert!(matches!(error, AppError::Rhino3dm { kind, .. } if kind == "helperCrashed"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_job_attribute_starts_helper_before_conversion() {
        let temp = tempfile::tempdir().unwrap();
        let marker = temp.path().join("started.marker");
        let result =
            run_fixture_with_limit("marker", Rhino3dmBudgets::default(), true, Some(&marker));
        match result {
            Ok(result) => {
                assert_eq!(result.stats.output_bytes, result.bytes.len() as u64);
                assert_eq!(fs::read(&marker).unwrap(), b"started");
            }
            Err(AppError::Rhino3dm { kind, details, .. }) => {
                // A host process already inside a non-nestable Job Object is
                // a valid startup refusal; otherwise the marker proves the
                // child reached its own entrypoint under the job.
                assert_eq!(kind, "helperCrashed");
                if details.stage.as_deref() == Some("limitSetup") {
                    assert!(!marker.exists());
                } else {
                    assert!(marker.exists());
                }
            }
            Err(other) => panic!("unexpected startup error: {other:?}"),
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_low_job_budget_does_not_guess_memory_limit_on_abnormal_exit() {
        let temp = tempfile::tempdir().unwrap();
        let marker = temp.path().join("low-budget.marker");
        let mut budgets = Rhino3dmBudgets::default();
        budgets.memory_bytes = 1;
        let result = run_fixture_with_limit("marker", budgets, true, Some(&marker));
        match result {
            Err(AppError::Rhino3dm { kind, .. }) => assert_ne!(kind, "memoryLimit"),
            Ok(_) => panic!("a one-byte process budget must not produce a successful preview"),
            Err(other) => panic!("unexpected low-budget error: {other:?}"),
        }
    }

    #[test]
    fn omitted_budgets_resolve_to_the_same_defaults_as_explicit_defaults() {
        assert_eq!(
            resolve_budgets(None),
            resolve_budgets(Some(Rhino3dmBudgets::default()))
        );
    }

    #[test]
    fn partial_budgets_deserialize_with_struct_defaults() {
        let budgets: Rhino3dmBudgets = serde_json::from_str(r#"{"timeoutMs":1234}"#).unwrap();
        assert_eq!(budgets.timeout_ms, 1234);
        assert_eq!(
            Rhino3dmBudgets {
                timeout_ms: DEFAULT_TIMEOUT_MS,
                ..budgets
            },
            Rhino3dmBudgets::default()
        );
    }

    #[test]
    fn packet_header_precedes_glb_without_json_number_arrays() {
        let glb = valid_glb(0);
        let payload = Rhino3dmPreviewPayload {
            bytes: glb.clone(),
            warnings: vec![Rhino3dmWarning {
                kind: "fixtureWarning".into(),
                count: 1,
            }],
            stats: Rhino3dmStats {
                output_bytes: glb.len() as u64,
                ..Default::default()
            },
        };
        let packet = encode_preview_packet(payload).unwrap();
        assert_eq!(&packet[..8], RHINO3DM_PACKET_MAGIC);
        let header_len = u32::from_le_bytes(packet[8..12].try_into().unwrap()) as usize;
        let header_start = RHINO3DM_PACKET_FIXED_BYTES;
        let header_end = header_start + header_len;
        let header: serde_json::Value =
            serde_json::from_slice(&packet[header_start..header_end]).expect("packet header JSON");
        assert_eq!(header["packetVersion"], RHINO3DM_PACKET_VERSION);
        assert_eq!(header["protocolVersion"], RHINO3DM_PROTOCOL_VERSION);
        assert_eq!(header["glbBytes"], glb.len() as u64);
        assert_eq!(&packet[header_end..], glb.as_slice());
        validate_glb(&packet[header_end..], "packet-test").unwrap();
    }

    #[test]
    fn cancellation_terminates_fixture_and_next_request_succeeds() {
        let _lock = FAKE_HELPER_LOCK.lock().unwrap();
        let temp = tempfile::tempdir().unwrap();
        let input = temp.path().join("fixture.3dm");
        fs::write(&input, b"3dm fixture").unwrap();
        let request_id = "fixture-cancel";
        let (program, prefix) = fake_launcher(temp.path());
        std::env::set_var("YW_LOOK_RHINO3DM_FAKE_HELPER", "1");
        std::env::set_var("YW_LOOK_RHINO3DM_FAKE_MODE", "cancel");
        let cancel = Arc::new(AtomicBool::new(false));
        let worker_cancel = Arc::clone(&cancel);
        let budgets = Rhino3dmBudgets::default();
        let worker = std::thread::spawn(move || {
            run_conversion_with_launcher(
                &program,
                &prefix,
                &input,
                request_id,
                &budgets,
                &worker_cancel,
                false,
            )
        });
        thread::sleep(Duration::from_millis(100));
        cancel.store(true, Ordering::Release);
        let result = worker.join().unwrap().unwrap_err();
        assert!(matches!(result, AppError::Rhino3dm { kind, .. } if kind == "cancelled"));
        std::env::remove_var("YW_LOOK_RHINO3DM_FAKE_HELPER");
        std::env::remove_var("YW_LOOK_RHINO3DM_FAKE_MODE");
    }
}
