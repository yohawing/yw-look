import type { AssetIssue } from "../lib/usd";
import type { StageInspection, StageSummary } from "../lib/usd";
import type { FileState } from "../stores/fileStore";
import type { ViewerState } from "../stores/viewerStore";

export type DiagnosticCounts = {
  errorCount: number;
  warningCount: number;
  total: number;
};

type AssetDiagnosticInputs = {
  assetMetadata: FileState["assetMetadata"];
  usdCapabilities?: readonly UsdCapabilityInfo[];
  usdIssues: readonly AssetIssue[];
  viewerFeedback: ViewerState["viewerFeedback"];
};

type DiagnosticCountInputs = AssetDiagnosticInputs & {
  debugPanelWarnings?: readonly string[] | null;
};

export type UsdCapabilityInfo = NonNullable<
  StageSummary["capabilities"]
>[number];

const usdCapabilityLabels: Record<UsdCapabilityInfo["kind"], string> = {
  pointInstancer: "Point Instancer",
  materialX: "MaterialX",
  skel: "UsdSkel",
  animationRange: "Animation Range",
  payload: "Payload",
  variantOverride: "Variant Override",
  usdAuthoredSplat: "USD-authored Splat",
};

export function selectUsdCapabilities(
  summary: StageSummary | null | undefined,
  inspection: StageInspection | null | undefined,
): readonly UsdCapabilityInfo[] {
  if (Array.isArray(summary?.capabilities)) {
    return summary.capabilities;
  }

  if (Array.isArray(inspection?.capabilities)) {
    return inspection.capabilities;
  }

  return [];
}

export function formatUsdCapabilityWarnings(
  capabilities: readonly UsdCapabilityInfo[],
): string[] {
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const capability of capabilities) {
    if (
      !capability.detected ||
      (capability.support !== "degraded" &&
        capability.support !== "unsupported")
    ) {
      continue;
    }

    const reason =
      typeof capability.reason === "string" ? capability.reason.trim() : "";
    if (!reason) {
      continue;
    }

    const label = usdCapabilityLabels[capability.kind] ?? capability.kind;
    const warning = `USD capability warning: ${label} (${capability.kind}) ${capability.support}: ${reason}`;
    if (!seen.has(warning)) {
      seen.add(warning);
      warnings.push(warning);
    }
  }

  return warnings;
}

function formatAssetIssue(issue: AssetIssue): string {
  const prefix = issue.level === "error" ? "USD error" : "USD warning";
  const context = issue.contextPath ? ` (${issue.contextPath})` : "";
  return `${prefix}: ${issue.message}${context}`;
}

function formatMmdDiagnostic(
  diagnostic: NonNullable<
    NonNullable<FileState["assetMetadata"]>["mmd"]
  >["diagnostics"][number],
): string {
  const prefix = diagnostic.level === "error" ? "MMD error" : "MMD warning";
  return `${prefix}: ${diagnostic.message} (${diagnostic.code})`;
}

export function splitViewerWarnings(warning: string | null): string[] {
  return (
    warning
      ?.split("\n")
      .map((line) => line.trim())
      .filter(Boolean) ?? []
  );
}

export function buildDiagnosticWarnings({
  assetMetadata,
  usdCapabilities,
  usdIssues,
  viewerFeedback,
}: AssetDiagnosticInputs): string[] {
  const nextWarnings = [...splitViewerWarnings(viewerFeedback.warning)];

  for (const texture of assetMetadata?.textures ?? []) {
    if (texture.sourceKind === "unresolved") {
      nextWarnings.push(`Texture reference is unresolved: ${texture.label}`);
    }
  }

  const sortedIssues = [...usdIssues].sort((a, b) => {
    if (a.level === b.level) return 0;
    return a.level === "error" ? -1 : 1;
  });
  for (const issue of sortedIssues) {
    nextWarnings.push(formatAssetIssue(issue));
  }

  nextWarnings.push(...formatUsdCapabilityWarnings(usdCapabilities ?? []));

  for (const diagnostic of assetMetadata?.mmd?.diagnostics ?? []) {
    nextWarnings.push(formatMmdDiagnostic(diagnostic));
  }

  return nextWarnings;
}

export function buildDiagnosticCounts({
  assetMetadata,
  debugPanelWarnings,
  usdCapabilities,
  usdIssues,
  viewerFeedback,
}: DiagnosticCountInputs): DiagnosticCounts {
  if (debugPanelWarnings) {
    return {
      errorCount: 0,
      warningCount: debugPanelWarnings.length,
      total: debugPanelWarnings.length,
    };
  }

  const loadErrorCount =
    viewerFeedback.mode === "loadFailed" ||
    viewerFeedback.mode === "missingReference"
      ? 1
      : 0;
  const usdErrorCount = usdIssues.filter(
    (issue) => issue.level === "error",
  ).length;
  const usdWarningCount = usdIssues.filter(
    (issue) => issue.level === "warning",
  ).length;
  const usdCapabilityWarningCount = formatUsdCapabilityWarnings(
    usdCapabilities ?? [],
  ).length;
  const unresolvedTextureCount =
    assetMetadata?.textures.filter(
      (texture) => texture.sourceKind === "unresolved",
    ).length ?? 0;
  const viewerWarningCount = splitViewerWarnings(viewerFeedback.warning).length;
  const mmdErrorCount =
    assetMetadata?.mmd?.diagnostics.filter(
      (diagnostic) => diagnostic.level === "error",
    ).length ?? 0;
  const mmdWarningCount =
    assetMetadata?.mmd?.diagnostics.filter(
      (diagnostic) => diagnostic.level === "warning",
    ).length ?? 0;
  const errorCount = loadErrorCount + usdErrorCount + mmdErrorCount;
  const warningCount =
    usdWarningCount +
    usdCapabilityWarningCount +
    unresolvedTextureCount +
    viewerWarningCount +
    mmdWarningCount;

  return {
    errorCount,
    warningCount,
    total: errorCount + warningCount,
  };
}

export function isDebugPanelsRequested(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  return (
    params.get("debugPanels") === "1" || params.get("uiDebug") === "panels"
  );
}
