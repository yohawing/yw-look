use ts_rs::{Config, TS};

use crate::commands::loader_packs::{OptionalLoaderPackCompatibility, OptionalLoaderPackManifest};
use crate::commands::settings::SettingsPayload;
use crate::commands::updater::{
    UpdateCheckPayload, UpdateConfigurationPayload, UpdateInstallPayload, UpdateMetadataPayload,
};
use crate::state::{AppSettings, OptionalLoaderPackSettings};

const GENERATED_IPC_TYPES: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/../src/types/generated/ipc.ts",);

fn generated_settings_ipc_types() -> String {
    let cfg = Config::default();
    [
        "// This file is generated from Rust serde payload types.",
        "// Run `cargo test --manifest-path src-tauri/Cargo.toml ipc_type_exports::generated_ipc_types_are_current --no-default-features --features backend-openusd-rs` after changing exported IPC structs.",
        "",
        &format_tsrs_object_decl(OptionalLoaderPackSettings::decl(&cfg)),
        "",
        &format_tsrs_object_decl(AppSettings::decl(&cfg)),
        "",
        &format_tsrs_object_decl(SettingsPayload::decl(&cfg)),
        "",
        &format_tsrs_object_decl(OptionalLoaderPackCompatibility::decl(&cfg)),
        "",
        &format_tsrs_object_decl(OptionalLoaderPackManifest::decl(&cfg)),
        "",
        &format_tsrs_object_decl(UpdateConfigurationPayload::decl(&cfg)),
        "",
        &format_tsrs_object_decl(UpdateMetadataPayload::decl(&cfg)),
        "",
        &format_tsrs_object_decl(UpdateCheckPayload::decl(&cfg)),
        "",
        &format_tsrs_object_decl(UpdateInstallPayload::decl(&cfg)),
        "",
    ]
    .join("\n")
}

fn format_tsrs_object_decl(decl: String) -> String {
    let decl = decl.replacen("type ", "export type ", 1);
    let (prefix, body) = decl
        .split_once(" = { ")
        .unwrap_or_else(|| panic!("unsupported ts-rs declaration: {decl}"));
    let body = body
        .strip_suffix(", };")
        .unwrap_or_else(|| panic!("unsupported ts-rs object body: {decl}"));
    let fields = body
        .split(", ")
        .filter(|field| !field.is_empty())
        .collect::<Vec<_>>();

    let inline_decl = format!("{prefix} = {{ {} }};", fields.join("; "));
    if fields.len() <= 2 && inline_decl.len() <= 80 {
        return inline_decl;
    }

    format!("{prefix} = {{\n  {};\n}};", fields.join(";\n  "))
}

#[test]
fn generated_ipc_types_are_current() {
    let expected = generated_settings_ipc_types();
    let actual = std::fs::read_to_string(GENERATED_IPC_TYPES)
        .unwrap_or_else(|error| panic!("failed to read {GENERATED_IPC_TYPES}: {error}"));
    assert_eq!(
        actual, expected,
        "generated IPC types are stale; update {GENERATED_IPC_TYPES}"
    );
}
