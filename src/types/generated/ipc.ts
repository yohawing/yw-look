// This file is generated from Rust serde payload types.
// Run `cargo test --manifest-path src-tauri/Cargo.toml ipc_type_exports::generated_ipc_types_are_current --no-default-features --features backend-openusd-rs` after changing exported IPC structs.

export type OptionalLoaderPackSettings = { enabled: boolean };

export type AppSettings = {
  version: number;
  recentFilesLimit: number;
  diagnosticsLogLevel: string;
  fileAssociationsEnabled: boolean;
  optionalLoaderPacks: { [key in string]: OptionalLoaderPackSettings };
  updateEndpointOverride: string | null;
  updatePublicKeyOverride: string | null;
  allowInsecureUpdateEndpoint: boolean;
  autoCheckForUpdates: boolean;
};

export type SettingsPayload = { settingsPath: string; settings: AppSettings };
