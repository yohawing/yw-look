//! Test-only extractor for stateful USD payload regression scenarios.

use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use yw_look_lib::usd::{
    types::{ExtractGeometryOptions, PurposeModes, VariantSelection},
    DefaultBackend, StageLoadPolicy, UsdSessionBackend,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Config {
    cases: Vec<Case>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Case {
    id: String,
    stage_path: String,
    #[serde(default)]
    policy: Policy,
    #[serde(default)]
    relationship: CaseRelationship,
    captures: Vec<Capture>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
enum CaseRelationship {
    #[default]
    Payload,
    Independent,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Policy {
    #[default]
    NoPayloads,
    LoadAll,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Capture {
    id: String,
    #[serde(default)]
    payload_ops: Vec<PayloadOp>,
    #[serde(default)]
    variant_selections: Vec<VariantSelection>,
    time_code: Option<f64>,
    #[serde(default)]
    expected_diagnostics: Vec<String>,
    #[serde(default)]
    expected_failure: Option<ExpectedFailure>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExpectedFailure {
    origin: String,
    code: String,
    message: String,
    reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PayloadOp {
    action: PayloadAction,
    prim_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum PayloadAction {
    Load,
    Unload,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    cases: Vec<CaseReport>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaseReport {
    id: String,
    captures: Vec<CaptureReport>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureReport {
    id: String,
    glb_path: String,
    byte_length: usize,
    operation_diagnostics: Vec<String>,
    extraction_diagnostics: Vec<String>,
    error: Option<String>,
    failure: Option<FailureReport>,
    meshes: Vec<String>,
    nodes: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FailureReport {
    origin: String,
    code: String,
    message: String,
    detail: String,
}

fn usage() -> &'static str {
    "usage: cargo run --example usd_stateful_capture -- --config <scenario.json> --out-dir <directory>"
}

fn parse_args() -> Result<(PathBuf, PathBuf), String> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        println!("{}", usage());
        std::process::exit(0);
    }
    let value = |name: &str| -> Result<PathBuf, String> {
        let index = args
            .iter()
            .position(|arg| arg == name)
            .ok_or_else(|| format!("{name} is required"))?;
        let value = args
            .get(index + 1)
            .filter(|value| !value.starts_with("--"))
            .ok_or_else(|| format!("{name} requires a value"))?;
        Ok(PathBuf::from(value))
    };
    if args.len() != 4
        || args
            .iter()
            .enumerate()
            .any(|(index, arg)| index % 2 == 0 && arg != "--config" && arg != "--out-dir")
    {
        return Err(format!("invalid arguments\n{}", usage()));
    }
    Ok((value("--config")?, value("--out-dir")?))
}

fn stage_policy(policy: &Policy) -> StageLoadPolicy {
    match policy {
        Policy::NoPayloads => StageLoadPolicy::NoPayloads,
        Policy::LoadAll => StageLoadPolicy::LoadAll,
    }
}

fn glb_names(glb: &[u8], key: &str) -> Result<Vec<String>, String> {
    if glb.len() < 20 || &glb[..4] != b"glTF" {
        return Err("extraction did not return a GLB".to_string());
    }
    let json_length =
        u32::from_le_bytes(glb[12..16].try_into().map_err(|_| "invalid GLB header")?) as usize;
    let json = glb.get(20..20 + json_length).ok_or("truncated GLB JSON")?;
    let document: Value =
        serde_json::from_slice(json).map_err(|error| format!("invalid GLB JSON: {error}"))?;
    Ok(document
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("name").and_then(Value::as_str).map(str::to_owned))
                .collect()
        })
        .unwrap_or_default())
}

fn usd_failure(origin: &str, error: &yw_look_lib::usd::UsdError) -> FailureReport {
    match error {
        yw_look_lib::usd::UsdError::Io(message) => FailureReport {
            origin: origin.to_owned(),
            code: "USD_BACKEND_IO".to_owned(),
            message: error.to_string(),
            detail: message.clone(),
        },
        yw_look_lib::usd::UsdError::Parse(message) => FailureReport {
            origin: origin.to_owned(),
            code: "USD_BACKEND_PARSE".to_owned(),
            message: error.to_string(),
            detail: message.clone(),
        },
        yw_look_lib::usd::UsdError::InvalidVariantSelection {
            prim_path,
            set_name,
            variant_name,
        } => FailureReport {
            origin: origin.to_owned(),
            code: "USD_INVALID_VARIANT_SELECTION".to_owned(),
            message: error.to_string(),
            detail: format!(
                "primPath={prim_path};setName={set_name};variantName={variant_name}"
            ),
        },
    }
}

fn main() -> Result<(), String> {
    let (config_path, out_dir) = parse_args()?;
    let config: Config =
        serde_json::from_slice(&fs::read(&config_path).map_err(|error| error.to_string())?)
            .map_err(|error| format!("invalid scenario JSON: {error}"))?;
    if config.cases.is_empty() {
        return Err("scenario must contain at least one case".to_string());
    }
    let mut case_ids = HashSet::new();
    let mut output_capture_ids = HashSet::new();
    fs::create_dir_all(&out_dir).map_err(|error| error.to_string())?;
    let backend = DefaultBackend::new();
    let mut report = Report { cases: Vec::new() };
    for case in config.cases {
        if !case_ids.insert(case.id.clone()) || case.id.is_empty() {
            return Err("case ids must be unique and non-empty".to_string());
        }
        if case.captures.is_empty() {
            return Err(format!("case {} has no captures", case.id));
        }
        let stage_path = config_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(&case.stage_path);
        let stage = backend
            .open_stage_session(&stage_path, stage_policy(&case.policy))
            .map_err(|error| error.to_string())?;
        let _relationship = case.relationship;
        let mut capture_ids = HashSet::new();
        let mut captures = Vec::new();
        for capture in case.captures {
            if !capture_ids.insert(capture.id.clone()) || capture.id.is_empty() {
                return Err(format!(
                    "case {} has duplicate or empty capture id",
                    case.id
                ));
            }
            if !capture.id.chars().all(|character| {
                character.is_ascii_alphanumeric() || character == '_' || character == '-'
            }) {
                return Err(format!("capture id is not filename-safe: {}", capture.id));
            }
            if !output_capture_ids.insert(capture.id.clone()) {
                return Err(format!(
                    "capture ids must be unique across cases: {}",
                    capture.id
                ));
            }
            let glb_path = out_dir.join(format!("{}.glb", capture.id));
            let mut operation_diagnostics = Vec::new();
            let mut extraction_diagnostics = Vec::new();
            let mut error = None;
            let mut failure = None;
            if capture.time_code.is_some() {
                let message =
                    "timeCode is unsupported by this stateful session extractor; use null"
                        .to_string();
                error = Some(message.clone());
                failure = Some(FailureReport {
                    origin: "adapter".to_owned(),
                    code: "USD_STATEFUL_TIMECODE_UNSUPPORTED".to_owned(),
                    message,
                    detail: "ExtractGeometryOptions has no timeCode field".to_owned(),
                });
            }
            if error.is_none() {
                for op in capture.payload_ops {
                    let result = match op.action {
                        PayloadAction::Load => backend.load_payload(&stage, &op.prim_path),
                        PayloadAction::Unload => backend.unload_payload(&stage, &op.prim_path),
                    };
                    if let Err(operation_error) = result {
                        let message = operation_error.to_string();
                        operation_diagnostics.push(message);
                        error = Some(operation_error.to_string());
                        failure = Some(usd_failure("operation", &operation_error));
                        break;
                    }
                }
            }
            let mut glb = Vec::new();
            if error.is_none() {
                let options = ExtractGeometryOptions {
                    policy: stage_policy(&case.policy),
                    variant_selections: capture.variant_selections,
                    purpose_modes: PurposeModes::default(),
                };
                match backend.extract_geometry_from_session(&stage, &stage_path, &options) {
                    Ok(bytes) => glb = bytes,
                    Err(extraction_error) => {
                        let message = extraction_error.to_string();
                        extraction_diagnostics.push(message);
                        error = Some(extraction_error.to_string());
                        failure = Some(usd_failure("extraction", &extraction_error));
                    }
                }
            }
            let (meshes, nodes) = if error.is_none() {
                let evidence = glb_names(&glb, "meshes")
                    .and_then(|meshes| glb_names(&glb, "nodes").map(|nodes| (meshes, nodes)));
                match evidence {
                    Ok(value) => value,
                    Err(evidence_error) => {
                        error = Some(evidence_error.clone());
                        failure = Some(FailureReport {
                            origin: "evidence".to_owned(),
                            code: "USD_GLB_EVIDENCE_INVALID".to_owned(),
                            message: evidence_error,
                            detail: "extracted GLB did not contain readable evidence".to_owned(),
                        });
                        (Vec::new(), Vec::new())
                    }
                }
            } else {
                (Vec::new(), Vec::new())
            };
            let _expected_diagnostics = capture.expected_diagnostics;
            let _expected_failure = capture.expected_failure;
            if error.is_none() {
                fs::write(&glb_path, &glb).map_err(|write_error| write_error.to_string())?;
            }
            captures.push(CaptureReport {
                id: capture.id,
                glb_path: glb_path.to_string_lossy().into_owned(),
                byte_length: glb.len(),
                operation_diagnostics,
                extraction_diagnostics,
                error,
                failure,
                meshes,
                nodes,
            });
        }
        report.cases.push(CaseReport {
            id: case.id,
            captures,
        });
    }
    let report_path = out_dir.join("report.json");
    fs::write(
        &report_path,
        serde_json::to_vec_pretty(&report).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}
