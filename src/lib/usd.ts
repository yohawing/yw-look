import { invoke } from "@tauri-apps/api/core";

export type CompositionArc = {
  sourcePrim: string;
  assetPath: string;
  targetPrim: string;
};

export type StageInspection = {
  path: string;
  defaultPrim: string | null;
  upAxis: string | null;
  metersPerUnit: number | null;
  rootPrims: string[];
  composedLayers: string[];
  references: CompositionArc[];
  payloads: CompositionArc[];
  missingAssets: string[];
};

export type StageSummary = {
  path: string;
  layerCount: number;
  rootPrimCount: number;
  meshCount: number;
  payloadCount: number;
  hasVariants: boolean;
  warnings: string[];
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

export async function inspectStage(path: string) {
  return invoke<StageInspection>("inspect_stage", { path });
}

export async function summarizeStage(path: string) {
  return invoke<StageSummary>("summarize_stage", { path });
}

export async function collectAssetIssues(path: string) {
  return invoke<AssetIssue[]>("collect_asset_issues", { path });
}
