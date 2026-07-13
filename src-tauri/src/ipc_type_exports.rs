use ts_rs::{Config, TS};

use crate::commands::diagnostics::{
    CrashRecoveryPayload, DiagnosticRecordInput, DiagnosticsPayload, ProcessMemoryPayload,
};
use crate::commands::file_associations::FileAssociationSyncResult;
use crate::commands::files::{
    AssetInspection, DirectoryListingPayload, FormatSupportPayload, ImageDimensions,
    RecentFileEntry, RecentFilesPayload, SelectedFilePayload,
};
use crate::commands::loader_packs::{OptionalLoaderPackCompatibility, OptionalLoaderPackManifest};
use crate::commands::settings::SettingsPayload;
use crate::commands::updater::{
    UpdateCheckPayload, UpdateConfigurationPayload, UpdateInstallPayload, UpdateMetadataPayload,
};
use crate::state::{AppSettings, BackendCapabilities, OptionalLoaderPackSettings};
use crate::usd::types::{
    AssetIssue, AssetIssueCode, AssetIssueLevel, AttributeInfo, AttributeTimeSamples,
    CompositionArc, CompositionArcKind, CompositionArcState, ExtractGeometryOptions, LayerInfo,
    MetadataEntry, PrimInspection, PrimTypeCount, PurposeModes, RelationshipInfo, ShapingCone,
    StageInspection, StageLoadPolicy, StageSummary, TimeSampleEntry, UsdLightInfo,
    VariantSelection, VariantSetInfo,
};

const GENERATED_IPC_TYPES: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/../src/types/generated/ipc.ts",);

fn generated_ipc_types() -> String {
    let cfg = Config::default();
    [
        "// This file is generated from Rust serde payload types.",
        "// Run `cargo test --manifest-path src-tauri/Cargo.toml ipc_type_exports::generated_ipc_types_are_current --no-default-features --features backend-openusd-rs` after changing exported IPC structs.",
        "",
        &format_tsrs_decl(OptionalLoaderPackSettings::decl(&cfg)),
        "",
        &format_tsrs_decl(AppSettings::decl(&cfg)),
        "",
        &format_tsrs_decl(SettingsPayload::decl(&cfg)),
        "",
        &format_tsrs_decl(OptionalLoaderPackCompatibility::decl(&cfg)),
        "",
        &format_tsrs_decl(OptionalLoaderPackManifest::decl(&cfg)),
        "",
        &format_tsrs_decl(FileAssociationSyncResult::decl(&cfg)),
        "",
        &format_tsrs_decl(UpdateConfigurationPayload::decl(&cfg)),
        "",
        &format_tsrs_decl(UpdateMetadataPayload::decl(&cfg)),
        "",
        &format_tsrs_decl(UpdateCheckPayload::decl(&cfg)),
        "",
        &format_tsrs_decl(UpdateInstallPayload::decl(&cfg)),
        "",
        &format_tsrs_decl(DiagnosticRecordInput::decl(&cfg)),
        "",
        &format_tsrs_decl(DiagnosticsPayload::decl(&cfg)),
        "",
        &format_tsrs_decl(CrashRecoveryPayload::decl(&cfg)),
        "",
        &format_tsrs_decl(ProcessMemoryPayload::decl(&cfg)),
        "",
        &format_tsrs_decl(SelectedFilePayload::decl(&cfg)),
        "",
        &format_tsrs_decl(DirectoryListingPayload::decl(&cfg)),
        "",
        &format_tsrs_decl(RecentFileEntry::decl(&cfg)),
        "",
        &format_tsrs_decl(RecentFilesPayload::decl(&cfg)),
        "",
        &format_tsrs_decl(FormatSupportPayload::decl(&cfg)),
        "",
        &format_tsrs_decl(ImageDimensions::decl(&cfg)),
        "",
        &format_tsrs_decl(AssetInspection::decl(&cfg)),
        "",
        &format_tsrs_decl(BackendCapabilities::decl(&cfg)),
        "",
        &format_tsrs_decl(StageLoadPolicy::decl(&cfg)),
        "",
        &format_tsrs_decl(VariantSetInfo::decl(&cfg)),
        "",
        &format_tsrs_decl(VariantSelection::decl(&cfg)),
        "",
        &format_tsrs_decl(PurposeModes::decl(&cfg)),
        "",
        &format_tsrs_decl(ExtractGeometryOptions::decl(&cfg)),
        "",
        &format_tsrs_decl(StageInspection::decl(&cfg)),
        "",
        &format_tsrs_decl(PrimTypeCount::decl(&cfg)),
        "",
        &format_tsrs_decl(StageSummary::decl(&cfg)),
        "",
        &format_tsrs_decl(AssetIssue::decl(&cfg)),
        "",
        &format_tsrs_decl(AssetIssueCode::decl(&cfg)),
        "",
        &format_tsrs_decl(AssetIssueLevel::decl(&cfg)),
        "",
        &format_tsrs_decl(CompositionArcKind::decl(&cfg)),
        "",
        &format_tsrs_decl(CompositionArc::decl(&cfg)),
        "",
        &format_tsrs_decl(AttributeInfo::decl(&cfg)),
        "",
        &format_tsrs_decl(RelationshipInfo::decl(&cfg)),
        "",
        &format_tsrs_decl(MetadataEntry::decl(&cfg)),
        "",
        &format_tsrs_decl(PrimInspection::decl(&cfg)),
        "",
        &format_tsrs_decl(CompositionArcState::decl(&cfg)),
        "",
        &format_tsrs_decl(LayerInfo::decl(&cfg)),
        "",
        &format_tsrs_decl(ShapingCone::decl(&cfg)),
        "",
        &format_tsrs_decl(UsdLightInfo::decl(&cfg)),
        "",
        &format_tsrs_decl(TimeSampleEntry::decl(&cfg)),
        "",
        &format_tsrs_decl(AttributeTimeSamples::decl(&cfg)),
        "",
    ]
    .join("\n")
}

fn format_tsrs_decl(decl: String) -> String {
    let decl = decl.replacen("type ", "export type ", 1);
    let Some((prefix, body)) = decl.split_once(" = { ") else {
        return format_tsrs_union_decl(decl);
    };
    let body = body
        .strip_suffix(", };")
        .unwrap_or_else(|| panic!("unsupported ts-rs object body: {decl}"));
    let body = strip_ts_doc_comments(body);
    let fields = split_ts_object_fields(&body);

    let inline_decl = format!("{prefix} = {{ {} }};", fields.join("; "));
    if fields.len() <= 2 && inline_decl.len() <= 80 {
        return inline_decl;
    }

    format!("{prefix} = {{\n  {};\n}};", fields.join(";\n  "))
}

fn format_tsrs_union_decl(decl: String) -> String {
    if decl.len() <= 100 || !decl.contains(" | ") {
        return decl;
    }

    let Some((prefix, union)) = decl
        .strip_suffix(';')
        .and_then(|decl| decl.split_once(" = "))
    else {
        return decl;
    };
    format!("{prefix} =\n  | {};", union.replace(" | ", "\n  | "))
}

fn strip_ts_doc_comments(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find("/**") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start + 3..];
        let Some(end) = after_start.find("*/") else {
            break;
        };
        rest = &after_start[end + 2..];
    }
    output.push_str(rest);
    output
}

fn split_ts_object_fields(body: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut start = 0;
    let mut depth = 0i32;

    for (index, ch) in body.char_indices() {
        match ch {
            '{' | '[' | '(' | '<' => depth += 1,
            '}' | ']' | ')' | '>' => depth -= 1,
            ',' if depth == 0 => {
                let field = body[start..index].trim();
                if !field.is_empty() {
                    fields.push(field.to_string());
                }
                start = index + 1;
            }
            _ => {}
        }
    }

    let field = body[start..].trim();
    if !field.is_empty() {
        fields.push(field.to_string());
    }

    fields
}

#[test]
fn generated_ipc_types_are_current() {
    let expected = generated_ipc_types();
    if std::env::var_os("YW_LOOK_UPDATE_IPC_TYPES").is_some() {
        std::fs::write(GENERATED_IPC_TYPES, &expected)
            .unwrap_or_else(|error| panic!("failed to write {GENERATED_IPC_TYPES}: {error}"));
        return;
    }

    let actual = std::fs::read_to_string(GENERATED_IPC_TYPES)
        .unwrap_or_else(|error| panic!("failed to read {GENERATED_IPC_TYPES}: {error}"));
    assert_eq!(
        actual, expected,
        "generated IPC types are stale; update {GENERATED_IPC_TYPES}"
    );
}

#[test]
fn formats_tsrs_object_decls_with_nested_commas_and_docs() {
    let formatted = format_tsrs_decl(
        r#"type Example = { /** Comment, with comma. */ name: string, tuple: [number, number, number], map: { [key in string]: Array<string> }, };"#
            .to_string(),
    );

    assert_eq!(
        formatted,
        "export type Example = {\n  name: string;\n  tuple: [number, number, number];\n  map: { [key in string]: Array<string> };\n};"
    );
}

#[test]
fn formats_long_tsrs_union_decls_like_prettier() {
    let formatted = format_tsrs_decl(
        r#"type AssetIssueCode = "broken-reference" | "missing-sub-layer" | "missing-payload" | "suspicious-meters-per-unit";"#
            .to_string(),
    );

    assert_eq!(
        formatted,
        "export type AssetIssueCode =\n  | \"broken-reference\"\n  | \"missing-sub-layer\"\n  | \"missing-payload\"\n  | \"suspicious-meters-per-unit\";"
    );
}
