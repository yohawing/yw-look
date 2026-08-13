import type {
  AppSettings as GeneratedAppSettings,
  AssetIssue as GeneratedAssetIssue,
  AssetIssueCode as GeneratedAssetIssueCode,
  AssetIssueLevel as GeneratedAssetIssueLevel,
  AttributeInfo as GeneratedAttributeInfo,
  AttributeTimeSamples as GeneratedAttributeTimeSamples,
  BackendCapabilities as GeneratedBackendCapabilities,
  CompositionArc as GeneratedCompositionArc,
  CompositionArcKind as GeneratedCompositionArcKind,
  CompositionArcState as GeneratedCompositionArcState,
  CrashRecoveryPayload as GeneratedCrashRecoveryPayload,
  DiagnosticRecordInput as GeneratedDiagnosticRecordInput,
  DiagnosticsPayload as GeneratedDiagnosticsPayload,
  ExtractGeometryOptions as GeneratedExtractGeometryOptions,
  FileAssociationSyncResult as GeneratedFileAssociationSyncResult,
  LayerInfo as GeneratedLayerInfo,
  MetadataEntry as GeneratedMetadataEntry,
  OptionalLoaderPackCompatibility as GeneratedOptionalLoaderPackCompatibility,
  OptionalLoaderPackManifest as GeneratedOptionalLoaderPackManifest,
  OptionalLoaderPackSettings as GeneratedOptionalLoaderPackSettings,
  PrimInspection as GeneratedPrimInspection,
  PrimTypeCount as GeneratedPrimTypeCount,
  ProcessMemoryPayload as GeneratedProcessMemoryPayload,
  PurposeModes as GeneratedPurposeModes,
  RelationshipInfo as GeneratedRelationshipInfo,
  SettingsPayload as GeneratedSettingsPayload,
  ShapingCone as GeneratedShapingCone,
  StageCapabilityInfo as GeneratedStageCapabilityInfo,
  StageCapabilityKind as GeneratedStageCapabilityKind,
  StageCapabilitySupport as GeneratedStageCapabilitySupport,
  StageInspection as GeneratedStageInspection,
  StageLoadPolicy as GeneratedStageLoadPolicy,
  StageSummary as GeneratedStageSummary,
  TimeSampleEntry as GeneratedTimeSampleEntry,
  UpdateCheckPayload as GeneratedUpdateCheckPayload,
  UpdateConfigurationPayload as GeneratedUpdateConfigurationPayload,
  UpdateInstallPayload as GeneratedUpdateInstallPayload,
  UpdateMetadataPayload as GeneratedUpdateMetadataPayload,
  UsdLightInfo as GeneratedUsdLightInfo,
  VariantSelection as GeneratedVariantSelection,
  VariantSetInfo as GeneratedVariantSetInfo,
} from "./generated/ipc";

// ── Error type (mirrors Rust AppError) ──────────────────────────

export type AppError = {
  kind: "io" | "usd" | "serde" | "timeout" | "internal";
  message: string;
};

// ── USD IPC types ────────────────────────────────────────────────

export type StageLoadPolicy = GeneratedStageLoadPolicy;

export type BackendCapabilities = GeneratedBackendCapabilities;

export type CompositionArcState = GeneratedCompositionArcState;

export type CompositionArcKind = GeneratedCompositionArcKind;

export type CompositionArc = Omit<GeneratedCompositionArc, "kind"> & {
  kind?: GeneratedCompositionArc["kind"];
};

export type VariantSetInfo = GeneratedVariantSetInfo;

export type VariantSelection = GeneratedVariantSelection;

export type UsdInvalidVariantSelectionError = {
  kind: "invalidVariantSelection";
  primPath: string;
  setName: string;
  variantName: string;
};

export type UsdTypedError = UsdInvalidVariantSelectionError;

export type PurposeModes = GeneratedPurposeModes;

export type ExtractGeometryOptions = Omit<
  GeneratedExtractGeometryOptions,
  "policy" | "variantSelections" | "purposeModes"
> & {
  policy?: GeneratedExtractGeometryOptions["policy"];
  variantSelections?: GeneratedExtractGeometryOptions["variantSelections"];
  purposeModes?: GeneratedExtractGeometryOptions["purposeModes"];
};

export type LayerInfo = GeneratedLayerInfo;

export type StageCapabilityKind = GeneratedStageCapabilityKind;

export type StageCapabilitySupport = GeneratedStageCapabilitySupport;

export type StageCapabilityInfo = GeneratedStageCapabilityInfo;

export type StageInspection = Omit<
  GeneratedStageInspection,
  | "layers"
  | "references"
  | "payloads"
  | "inherits"
  | "specializes"
  | "variantSelectionArcs"
  | "capabilities"
> & {
  layers?: GeneratedStageInspection["layers"];
  references: CompositionArc[];
  payloads: CompositionArc[];
  inherits?: CompositionArc[];
  specializes?: CompositionArc[];
  variantSelectionArcs?: CompositionArc[];
  capabilities?: GeneratedStageInspection["capabilities"];
};

export type PrimTypeCount = GeneratedPrimTypeCount;

export type StageSummary = Omit<GeneratedStageSummary, "capabilities"> & {
  capabilities?: GeneratedStageSummary["capabilities"];
};

export type AssetIssueCode = GeneratedAssetIssueCode;

export type AssetIssueLevel = GeneratedAssetIssueLevel;

export type AssetIssue = GeneratedAssetIssue;

export type AttributeInfo = GeneratedAttributeInfo;

export type RelationshipInfo = GeneratedRelationshipInfo;

export type MetadataEntry = GeneratedMetadataEntry;

export type PrimInspection = GeneratedPrimInspection;

export type ShapingCone = GeneratedShapingCone;

export type UsdLightInfo = GeneratedUsdLightInfo;

export type TimeSampleEntry = GeneratedTimeSampleEntry;

export type AttributeTimeSamples = GeneratedAttributeTimeSamples;

export type UsdSourcePayload =
  | { kind: "text"; source: string }
  | { kind: "binary" };

export type StageSessionHandle = number;

// ── Diagnostics IPC types ────────────────────────────────────────

// Wire Option fields are `T | null`; facade keeps them optional so callers may
// omit absent payload fields when constructing records on the frontend.
export type DiagnosticRecordInput = Omit<
  GeneratedDiagnosticRecordInput,
  "detail" | "contextPath"
> & {
  detail?: GeneratedDiagnosticRecordInput["detail"];
  contextPath?: GeneratedDiagnosticRecordInput["contextPath"];
};

export type DiagnosticsPayload = Omit<
  GeneratedDiagnosticsPayload,
  "diagnosticsSnapshot"
> & {
  diagnosticsSnapshot: string[];
};

export type CrashRecoveryPayload = GeneratedCrashRecoveryPayload;

// Rust wire name is ProcessMemoryPayload; keep the existing frontend name.
export type ProcessMemoryMetrics = GeneratedProcessMemoryPayload;

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

export type FileAssociationSyncResult = GeneratedFileAssociationSyncResult;

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
