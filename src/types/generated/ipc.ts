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

export type DiagnosticRecordInput = {
  code: string;
  level: string;
  message: string;
  detail: string | null;
  contextPath: string | null;
};

export type DiagnosticsPayload = {
  appVersion: string;
  platform: string;
  arch: string;
  appLogDir: string;
  diagnosticsLogPath: string;
  diagnosticsSnapshot: Array<string>;
};

export type CrashRecoveryPayload = {
  previousCrashDetected: boolean;
  markerPath: string;
  previousStartedAt: string | null;
  previousPid: number | null;
};

export type ProcessMemoryPayload = {
  residentSetBytes: number;
  virtualMemoryBytes: number;
};

export type SelectedFilePayload = {
  path: string;
  fileName: string;
  extension: string;
  kind: string;
  parentDirectory: string;
};

export type DirectoryListingPayload = {
  files: Array<SelectedFilePayload>;
  currentIndex: number | null;
};

export type RecentFileEntry = {
  path: string;
  kind: string;
  lastAccessedAt: string;
};

export type RecentFilesPayload = {
  recentFilesPath: string;
  entries: Array<RecentFileEntry>;
};

export type FormatSupportPayload = {
  modelExtensions: Array<string>;
  textureExtensions: Array<string>;
  motionExtensions: Array<string>;
  previewImplemented: Array<string>;
};

export type ImageDimensions = {
  width: number;
  height: number;
  source: string;
};

export type AssetInspection = {
  path: string;
  fileName: string;
  extension: string;
  kind: string;
  fileSizeBytes: number;
  modifiedAt: string | null;
  createdAt: string | null;
  previewImplemented: boolean;
  imageDimensions: ImageDimensions | null;
};
