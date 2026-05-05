//! Private regression checks for false-positive Kitchen Set payload warnings.
//!
//! The Pixar Kitchen Set sample is ignored under `samples/private`, so this
//! test skips when the local sample has not been fetched.

#![cfg(feature = "backend-openusd-rs")]

use std::path::PathBuf;

use yw_look_lib::usd::{OpenusdBackend, UsdInspectBackend};

fn kitchen_set_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("samples")
        .join("private")
        .join("usd")
        .join("Kitchen_set")
        .join("Kitchen_set.usd")
}

#[test]
fn kitchen_set_payload_files_are_not_reported_missing() {
    let path = kitchen_set_path();
    if !path.exists() {
        eprintln!(
            "Skipping private Kitchen Set payload warning test: {}",
            path.display()
        );
        return;
    }

    let backend = OpenusdBackend::new();
    let issues = backend
        .collect_asset_issues(&path)
        .expect("collect Kitchen Set asset issues");
    let missing_payloads: Vec<_> = issues
        .iter()
        .filter(|issue| issue.message.starts_with("Missing payload:"))
        .map(|issue| issue.message.as_str())
        .collect();

    assert!(
        missing_payloads.is_empty(),
        "existing nested Kitchen Set payloads must not be reported missing: {:?}",
        missing_payloads
    );
}
