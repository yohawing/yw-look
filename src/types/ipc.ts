import type {
  AppSettings as GeneratedAppSettings,
  OptionalLoaderPackCompatibility as GeneratedOptionalLoaderPackCompatibility,
  OptionalLoaderPackManifest as GeneratedOptionalLoaderPackManifest,
  OptionalLoaderPackSettings as GeneratedOptionalLoaderPackSettings,
  SettingsPayload as GeneratedSettingsPayload,
  UpdateCheckPayload as GeneratedUpdateCheckPayload,
  UpdateConfigurationPayload as GeneratedUpdateConfigurationPayload,
  UpdateInstallPayload as GeneratedUpdateInstallPayload,
  UpdateMetadataPayload as GeneratedUpdateMetadataPayload,
} from "./generated/ipc";

// ── Error type (mirrors Rust AppError) ──────────────────────────

export type AppError = {
  kind: "io" | "usd" | "serde" | "timeout" | "internal";
  message: string;
};

// ── USD IPC types ────────────────────────────────────────────────

export type StageLoadPolicy = "loadAll" | "noPayloads";

export type BackendCapabilities = {
  inspect: boolean;
  geometry: boolean;
  source: boolean;
  session: boolean;
  light: boolean;
};

export type CompositionArcState = "loaded" | "missing" | "unloaded";

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
  kind?: CompositionArcKind;
};

export type VariantSetInfo = {
  primPath: string;
  setName: string;
  selection: string | null;
  variants: string[];
};

export type VariantSelection = {
  primPath: string;
  setName: string;
  variantName: string;
};

export type UsdInvalidVariantSelectionError = {
  kind: "invalidVariantSelection";
  primPath: string;
  setName: string;
  variantName: string;
};

export type UsdTypedError = UsdInvalidVariantSelectionError;

export type PurposeModes = {
  render: boolean;
  proxy: boolean;
  guide: boolean;
};

export type ExtractGeometryOptions = {
  policy?: StageLoadPolicy;
  variantSelections?: VariantSelection[];
  purposeModes?: PurposeModes;
};

export type LayerInfo = {
  identifier: string;
  depth: number;
  muted: boolean;
  timeOffset: number;
  timeScale: number;
  comment: string | null;
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
  rootPrims: string[];
  composedLayers: string[];
  layers?: LayerInfo[];
  references: CompositionArc[];
  payloads: CompositionArc[];
  inherits?: CompositionArc[];
  specializes?: CompositionArc[];
  variantSelectionArcs?: CompositionArc[];
  missingAssets: string[];
  variantSets: VariantSetInfo[];
  loadPolicy: StageLoadPolicy;
};

export type PrimTypeCount = {
  typeName: string;
  count: number;
};

export type StageSummary = {
  path: string;
  layerCount: number;
  rootPrimCount: number;
  meshCount: number;
  payloadCount: number;
  unloadedPayloadCount: number;
  hasVariants: boolean;
  primTypeCounts: PrimTypeCount[];
  totalVertices: number;
  totalTriangles: number;
  variantSetCount: number;
  durationSeconds: number | null;
  resolvedReferenceCount: number;
  unresolvedReferenceCount: number;
  resolvedPayloadCount: number;
  unresolvedPayloadCount: number;
  warnings: string[];
  loadPolicy: StageLoadPolicy;
};

export type AssetIssueCode =
  | "broken-reference"
  | "missing-sub-layer"
  | "missing-payload"
  | "suspicious-meters-per-unit";

export type AssetIssueLevel = "warning" | "error";

export type AssetIssue = {
  code: AssetIssueCode;
  level: AssetIssueLevel;
  message: string;
  detail: string | null;
  contextPath: string | null;
};

export type AttributeInfo = {
  name: string;
  typeName: string;
  valueSummary: string;
  variability: string;
  custom: boolean;
  timeSampleCount: number;
};

export type RelationshipInfo = {
  name: string;
  targets: string[];
};

export type MetadataEntry = {
  key: string;
  valueSummary: string;
};

export type PrimInspection = {
  primPath: string;
  attributes: AttributeInfo[];
  relationships: RelationshipInfo[];
  metadata: MetadataEntry[];
};

export type ShapingCone = {
  angle: number;
  softness: number;
};

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

export type TimeSampleEntry = {
  time: number;
  valueSummary: string;
};

export type AttributeTimeSamples = {
  primPath: string;
  attributeName: string;
  samples: TimeSampleEntry[];
  totalCount: number;
  numericMin: number | null;
  numericMax: number | null;
  numericMean: number | null;
};

export type UsdSourcePayload =
  | { kind: "text"; source: string }
  | { kind: "binary" };

export type StageSessionHandle = number;

// ── Diagnostics IPC types ────────────────────────────────────────

export type DiagnosticRecordInput = {
  code: string;
  level: string;
  message: string;
  detail?: string | null;
  contextPath?: string | null;
};

export type DiagnosticsPayload = {
  appVersion: string;
  platform: string;
  arch: string;
  appLogDir: string;
  diagnosticsLogPath: string;
  diagnosticsSnapshot: string[];
};

export type CrashRecoveryPayload = {
  previousCrashDetected: boolean;
  markerPath: string;
  previousStartedAt: string | null;
  previousPid: number | null;
};

export type ProcessMemoryMetrics = {
  residentSetBytes: number;
  virtualMemoryBytes: number;
};

export type WebGLResourceMetrics = {
  geometries: number;
  textures: number;
  programs: number | null;
  calls: number;
  triangles: number;
  points: number;
  lines: number;
};

export type RuntimeMemoryMetrics = {
  jsHeapUsedBytes: number | null;
  jsHeapTotalBytes: number | null;
  jsHeapLimitBytes: number | null;
};

export type AssetResourceMetrics = {
  vertices: number;
  triangles: number;
  materials: number;
  textures: number;
};

export type ResourceDiagnosticsSnapshot = {
  sampledAt: number;
  webgl: WebGLResourceMetrics;
  memory: RuntimeMemoryMetrics;
  asset: AssetResourceMetrics | null;
};

// ── Settings IPC types ───────────────────────────────────────────

export type AppSettings = {
  [K in keyof GeneratedAppSettings]: K extends "optionalLoaderPacks"
    ? Record<string, OptionalLoaderPackSettings | undefined>
    : GeneratedAppSettings[K];
};

export type OptionalLoaderPackSettings = GeneratedOptionalLoaderPackSettings;

export type SettingsPayload = Omit<GeneratedSettingsPayload, "settings"> & {
  settings: AppSettings;
};

// Wire Option fields are `T | null`; facade keeps them optional for frontend
// fixtures and partial objects that may omit absent payload fields.
export type OptionalLoaderPackCompatibility = Omit<
  GeneratedOptionalLoaderPackCompatibility,
  "message"
> & {
  message?: GeneratedOptionalLoaderPackCompatibility["message"];
};

export type OptionalLoaderPackManifest = Omit<
  GeneratedOptionalLoaderPackManifest,
  "minimumAppVersion" | "maximumAppVersion" | "compatibility"
> & {
  minimumAppVersion?: GeneratedOptionalLoaderPackManifest["minimumAppVersion"];
  maximumAppVersion?: GeneratedOptionalLoaderPackManifest["maximumAppVersion"];
  compatibility: OptionalLoaderPackCompatibility;
};

// ── Updater IPC types ────────────────────────────────────────────

export type UpdateConfigurationPayload = Omit<
  GeneratedUpdateConfigurationPayload,
  "defaultEndpoint" | "effectiveEndpoint"
> & {
  defaultEndpoint?: GeneratedUpdateConfigurationPayload["defaultEndpoint"];
  effectiveEndpoint?: GeneratedUpdateConfigurationPayload["effectiveEndpoint"];
};

export type UpdateMetadataPayload = Omit<
  GeneratedUpdateMetadataPayload,
  "notes" | "pubDate"
> & {
  notes?: GeneratedUpdateMetadataPayload["notes"];
  pubDate?: GeneratedUpdateMetadataPayload["pubDate"];
};

export type UpdateCheckPayload = Omit<
  GeneratedUpdateCheckPayload,
  "configuration" | "update"
> & {
  configuration: UpdateConfigurationPayload;
  update?: UpdateMetadataPayload | null;
};

export type UpdateInstallPayload = GeneratedUpdateInstallPayload;
