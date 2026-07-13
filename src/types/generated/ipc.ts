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

export type FileAssociationSyncResult = {
  platform: string;
  supported: boolean;
  effectiveExtensions: Array<string>;
  requiresUserConfirmation: boolean;
  message: string;
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

export type BackendCapabilities = {
  inspect: boolean;
  geometry: boolean;
  source: boolean;
  session: boolean;
  light: boolean;
};

export type StageLoadPolicy = "loadAll" | "noPayloads";

export type VariantSetInfo = {
  primPath: string;
  setName: string;
  selection: string | null;
  variants: Array<string>;
};

export type VariantSelection = {
  primPath: string;
  setName: string;
  variantName: string;
};

export type PurposeModes = {
  render: boolean;
  proxy: boolean;
  guide: boolean;
};

export type ExtractGeometryOptions = {
  policy: StageLoadPolicy;
  variantSelections: Array<VariantSelection>;
  purposeModes: PurposeModes;
};

export type StageInspection = {
  path: string;
  defaultPrim: string | null;
  upAxis: string | null;
  metersPerUnit: number | null;
  timeCodesPerSecond: number | null;
  framesPerSecond: number | null;
  startTimeCode: number | null;
  endTimeCode: number | null;
  comment: string | null;
  rootLayerIsBinary: boolean;
  rootPrims: Array<string>;
  composedLayers: Array<string>;
  layers: Array<LayerInfo>;
  references: Array<CompositionArc>;
  payloads: Array<CompositionArc>;
  inherits: Array<CompositionArc>;
  specializes: Array<CompositionArc>;
  variantSelectionArcs: Array<CompositionArc>;
  missingAssets: Array<string>;
  variantSets: Array<VariantSetInfo>;
  loadPolicy: StageLoadPolicy;
};

export type PrimTypeCount = { typeName: string; count: number };

export type StageSummary = {
  path: string;
  layerCount: number;
  rootPrimCount: number;
  meshCount: number;
  payloadCount: number;
  unloadedPayloadCount: number;
  hasVariants: boolean;
  primTypeCounts: Array<PrimTypeCount>;
  totalVertices: number;
  totalTriangles: number;
  variantSetCount: number;
  durationSeconds: number | null;
  resolvedReferenceCount: number;
  unresolvedReferenceCount: number;
  resolvedPayloadCount: number;
  unresolvedPayloadCount: number;
  warnings: Array<string>;
  loadPolicy: StageLoadPolicy;
};

export type AssetIssue = {
  code: AssetIssueCode;
  level: AssetIssueLevel;
  message: string;
  detail: string | null;
  contextPath: string | null;
};

export type AssetIssueCode =
  | "broken-reference"
  | "missing-sub-layer"
  | "missing-payload"
  | "suspicious-meters-per-unit";

export type AssetIssueLevel = "warning" | "error";

export type CompositionArcKind =
  | "reference"
  | "payload"
  | "inherits"
  | "specializes"
  | "variantSelection"
  | "over";

export type CompositionArc = {
  sourcePrim: string;
  assetPath: string;
  targetPrim: string;
  state: CompositionArcState;
  kind: CompositionArcKind;
};

export type AttributeInfo = {
  name: string;
  typeName: string;
  valueSummary: string;
  variability: string;
  custom: boolean;
  timeSampleCount: number;
};

export type RelationshipInfo = { name: string; targets: Array<string> };

export type MetadataEntry = { key: string; valueSummary: string };

export type PrimInspection = {
  primPath: string;
  attributes: Array<AttributeInfo>;
  relationships: Array<RelationshipInfo>;
  metadata: Array<MetadataEntry>;
};

export type CompositionArcState = "loaded" | "missing" | "unloaded";

export type LayerInfo = {
  identifier: string;
  depth: number;
  muted: boolean;
  timeOffset: number;
  timeScale: number;
  comment: string | null;
};

export type ShapingCone = { angle: number; softness: number };

export type UsdLightInfo = {
  primPath: string;
  lightKind: string;
  color: [number, number, number];
  intensity: number;
  exposure: number;
  colorTemperature: number | null;
  specular: number;
  diffuse: number;
  domeTextureFile: string | null;
  shapingCone: ShapingCone | null;
};

export type TimeSampleEntry = { time: number; valueSummary: string };

export type AttributeTimeSamples = {
  primPath: string;
  attributeName: string;
  samples: Array<TimeSampleEntry>;
  totalCount: number;
  numericMin: number | null;
  numericMax: number | null;
  numericMean: number | null;
};
