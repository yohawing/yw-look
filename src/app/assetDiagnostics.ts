import type { AssetIssue } from "../lib/usd";
import type { FileState } from "../stores/fileStore";
import type { ViewerState } from "../stores/viewerStore";

export type DiagnosticCounts = {
  errorCount: number;
  warningCount: number;
  total: number;
};

type AssetDiagnosticInputs = {
  assetMetadata: FileState["assetMetadata"];
  usdIssues: readonly AssetIssue[];
  viewerFeedback: ViewerState["viewerFeedback"];
};

type DiagnosticCountInputs = AssetDiagnosticInputs & {
  debugPanelWarnings?: readonly string[] | null;
};

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

  for (const diagnostic of assetMetadata?.mmd?.diagnostics ?? []) {
    nextWarnings.push(formatMmdDiagnostic(diagnostic));
  }

  return nextWarnings;
}

export function buildDiagnosticCounts({
  assetMetadata,
  debugPanelWarnings,
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
