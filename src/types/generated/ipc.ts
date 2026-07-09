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

export type OptionalLoaderPackCompatibility = {
  state: string;
  message: string | null;
};

export type OptionalLoaderPackManifest = {
  id: string;
  name: string;
  version: string;
  minimumAppVersion: string | null;
  maximumAppVersion: string | null;
  compatibility: OptionalLoaderPackCompatibility;
  extensions: Array<string>;
  entry: string;
  packPath: string;
  entryPath: string;
};

export type UpdateConfigurationPayload = {
  currentVersion: string;
  defaultEndpoint: string | null;
  defaultPubkeyAvailable: boolean;
  effectiveEndpoint: string | null;
  effectivePubkeyAvailable: boolean;
  usingOverrideEndpoint: boolean;
  usingOverridePubkey: boolean;
  allowInsecureUpdateEndpoint: boolean;
};

export type UpdateMetadataPayload = {
  version: string;
  currentVersion: string;
  notes: string | null;
  pubDate: string | null;
  target: string;
  downloadUrl: string;
};

export type UpdateCheckPayload = {
  configuration: UpdateConfigurationPayload;
  update: UpdateMetadataPayload | null;
};

export type UpdateInstallPayload = {
  installedVersion: string;
  restartRequired: boolean;
  note: string;
};
