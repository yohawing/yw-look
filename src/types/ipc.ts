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
  diagnosticsLogPath: string;
  diagnosticsSnapshot: string[];
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
  version: number;
  recentFilesLimit: number;
  diagnosticsLogLevel: string;
  fileAssociationsEnabled: boolean;
  updateEndpointOverride?: string | null;
  updatePublicKeyOverride?: string | null;
  allowInsecureUpdateEndpoint: boolean;
  autoCheckForUpdates: boolean;
};

export type SettingsPayload = {
  settingsPath: string;
  settings: AppSettings;
};

export type OptionalLoaderPackManifest = {
  id: string;
  name: string;
  version: string;
  extensions: string[];
  entry: string;
  packPath: string;
  entryPath: string;
};

// ── Updater IPC types ────────────────────────────────────────────

export type UpdateConfigurationPayload = {
  currentVersion: string;
  defaultEndpoint?: string | null;
  defaultPubkeyAvailable: boolean;
  effectiveEndpoint?: string | null;
  effectivePubkeyAvailable: boolean;
  usingOverrideEndpoint: boolean;
  usingOverridePubkey: boolean;
  allowInsecureUpdateEndpoint: boolean;
};

export type UpdateMetadataPayload = {
  version: string;
  currentVersion: string;
  notes?: string | null;
  pubDate?: string | null;
  target: string;
  downloadUrl: string;
};

export type UpdateCheckPayload = {
  configuration: UpdateConfigurationPayload;
  update?: UpdateMetadataPayload | null;
};

export type UpdateInstallPayload = {
  installedVersion: string;
  restartRequired: boolean;
  note: string;
};

// ── Integrations IPC types ───────────────────────────────────────

export type IntegrationPayload = {
  fileAssociationsEnabled: boolean;
  installStrategy: string;
  supportedExtensions: string[];
};
