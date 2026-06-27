import { useCallback, useEffect, useMemo } from "react";
import { type AssetMetadata } from "../components/assetMetadata";
import {
  buildStatusLeftItems,
  buildStatusRightItems,
} from "../components/appStatusItems";
import {
  debugPanelDirectoryListing,
  debugPanelFile,
  debugPanelMetadata,
  debugPanelWarnings,
} from "../components/debugPanelFixtures";
import {
  formatUsdErrorForDisplay,
  isInvalidVariantSelectionError,
  parseUsdError,
  type AssetIssue,
} from "../lib/usd";
import type { FileState } from "../stores/fileStore";
import type { UiState } from "../stores/uiStore";
import type { ViewerState } from "../stores/viewerStore";
import type { AppStatusBarItem } from "../types/ui";
import type { UpdateCheckPayload } from "../lib/updater";

type DiagnosticCounts = {
  errorCount: number;
  warningCount: number;
  total: number;
};

function formatAssetIssue(issue: AssetIssue): string {
  const prefix = issue.level === "error" ? "USD error" : "USD warning";
  const context = issue.contextPath ? ` (${issue.contextPath})` : "";
  return `${prefix}: ${issue.message}${context}`;
}

function formatMmdDiagnostic(
  diagnostic: NonNullable<AssetMetadata["mmd"]>["diagnostics"][number],
): string {
  const prefix = diagnostic.level === "error" ? "MMD error" : "MMD warning";
  return `${prefix}: ${diagnostic.message} (${diagnostic.code})`;
}

function splitViewerWarnings(warning: string | null): string[] {
  return (
    warning
      ?.split("\n")
      .map((line) => line.trim())
      .filter(Boolean) ?? []
  );
}

function isDebugPanelsRequested(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  return (
    params.get("debugPanels") === "1" || params.get("uiDebug") === "panels"
  );
}

type UseViewerDiagnosticsModelOptions = {
  assetMetadata: FileState["assetMetadata"];
  currentFile: FileState["currentFile"];
  directoryListing: FileState["directoryListing"];
  gridUnitLabel: ViewerState["gridUnitLabel"];
  logDiagnosticEventAndRefresh: (params: {
    code: string;
    level: string;
    message: string;
    detail?: string | null;
    contextPath?: string | null;
  }) => Promise<void>;
  openError: FileState["openError"];
  refreshUpdateConfiguration: () => Promise<void>;
  settingsError: string | null;
  showGrid: ViewerState["showGrid"];
  ui: UiState;
  updateCheck: UpdateCheckPayload | null;
  usdIssues: AssetIssue[];
  viewer: ViewerState;
  viewerFeedback: ViewerState["viewerFeedback"];
};

export function useViewerDiagnosticsModel({
  assetMetadata,
  currentFile,
  directoryListing,
  gridUnitLabel,
  logDiagnosticEventAndRefresh,
  openError,
  refreshUpdateConfiguration,
  settingsError,
  showGrid,
  ui,
  updateCheck,
  usdIssues,
  viewer,
  viewerFeedback,
}: UseViewerDiagnosticsModelOptions) {
  const debugPanelsEnabled = isDebugPanelsRequested();
  const sidebarCurrentFile = debugPanelsEnabled ? debugPanelFile : currentFile;
  const sidebarAssetMetadata = debugPanelsEnabled
    ? debugPanelMetadata
    : assetMetadata;
  const sidebarDirectoryListing = debugPanelsEnabled
    ? debugPanelDirectoryListing
    : directoryListing;

  const { setVariantSelectionError } = viewer;
  const recordVariantSelectionError = useCallback(
    (error: unknown): boolean => {
      const parsed = parseUsdError(error);
      if (!isInvalidVariantSelectionError(parsed)) {
        return false;
      }

      const message = formatUsdErrorForDisplay(
        error,
        "Variant selection failed.",
      );
      console.error("[usd] variant selection failed:", error);
      setVariantSelectionError(message);
      return true;
    },
    [setVariantSelectionError],
  );

  const viewerStatusLabel = useMemo(() => {
    switch (viewerFeedback.mode) {
      case "loading":
        return "loading preview";
      case "ready":
        return "preview ready";
      case "unsupported":
        return "unsupported format";
      case "missingOptionalLoader":
        return "optional loader missing";
      case "loadFailed":
        return "preview failed";
      case "missingReference":
        return "missing external resource";
      default:
        return "idle";
    }
  }, [viewerFeedback.mode]);

  const currentFileSummary = useMemo(() => {
    if (!sidebarCurrentFile) {
      return "none";
    }

    if (
      sidebarDirectoryListing?.currentIndex !== null &&
      sidebarDirectoryListing?.files.length
    ) {
      return `${sidebarCurrentFile.fileName} (${sidebarDirectoryListing.currentIndex + 1}/${sidebarDirectoryListing.files.length})`;
    }

    return `${sidebarCurrentFile.fileName} (${sidebarCurrentFile.kind})`;
  }, [sidebarDirectoryListing, sidebarCurrentFile]);

  const viewerWarningLines = useMemo(
    () => splitViewerWarnings(viewerFeedback.warning),
    [viewerFeedback.warning],
  );

  const warnings = useMemo(() => {
    const nextWarnings: string[] = [];

    nextWarnings.push(...viewerWarningLines);

    for (const texture of assetMetadata?.textures ?? []) {
      if (texture.sourceKind === "unresolved") {
        nextWarnings.push(`Texture reference is unresolved: ${texture.label}`);
      }
    }

    // Phase 2: surface Rust-side USD asset hygiene issues in the existing
    // warnings pipeline. Errors sort before warnings so broken references
    // are visible first.
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
  }, [
    assetMetadata?.mmd?.diagnostics,
    assetMetadata?.textures,
    usdIssues,
    viewerWarningLines,
  ]);
  const sidebarWarnings = debugPanelsEnabled ? debugPanelWarnings : warnings;

  const diagnosticCounts = useMemo<DiagnosticCounts>(() => {
    if (debugPanelsEnabled) {
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
    const viewerWarningCount = viewerWarningLines.length;
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
  }, [
    assetMetadata?.mmd?.diagnostics,
    assetMetadata?.textures,
    debugPanelsEnabled,
    usdIssues,
    viewerWarningLines,
    viewerFeedback.mode,
  ]);

  useEffect(() => {
    if (!openError) {
      return;
    }

    void (async () => {
      await logDiagnosticEventAndRefresh({
        code: "APP_OPEN_ERROR",
        level: "error",
        message: openError,
        contextPath: currentFile?.path ?? null,
      });
    })();
  }, [currentFile?.path, openError, logDiagnosticEventAndRefresh]);

  useEffect(() => {
    // "loading" is a transient state — do not record it as a diagnostic
    // event. Only terminal states (failure / unsupported / missingReference)
    // are worth persisting so the Diagnostics panel stays signal-rich.
    if (
      viewerFeedback.mode === "ready" ||
      viewerFeedback.mode === "empty" ||
      viewerFeedback.mode === "loading"
    ) {
      return;
    }

    const level =
      viewerFeedback.mode === "missingReference" ||
      viewerFeedback.mode === "unsupported" ||
      viewerFeedback.mode === "missingOptionalLoader"
        ? "warn"
        : "error";

    // Mirror to the webview console so the issue is visible in devtools
    // (Tauri: Ctrl+Shift+I) without having to open the Diagnostics panel.
    const logFn = level === "warn" ? console.warn : console.error;
    logFn(
      `[viewer] ${viewerFeedback.mode}:`,
      viewerFeedback.message,
      viewerFeedback.warning ?? "",
    );

    void (async () => {
      await logDiagnosticEventAndRefresh({
        code: `VIEWER_${viewerFeedback.mode.toUpperCase()}`,
        level,
        message: viewerFeedback.message,
        detail: viewerFeedback.warning,
        contextPath: currentFile?.path ?? null,
      });
    })();
  }, [
    currentFile?.path,
    viewerFeedback.message,
    viewerFeedback.mode,
    viewerFeedback.warning,
    logDiagnosticEventAndRefresh,
  ]);

  const openDiagnosticsPanel = useCallback(() => {
    ui.setSidebarOpen(true);
    ui.setActiveTab("warnings");
  }, [ui]);

  const openUpdatePanel = useCallback(() => {
    ui.setSidebarOpen(true);
    ui.setActiveTab("settings");
    void refreshUpdateConfiguration();
  }, [refreshUpdateConfiguration, ui]);

  const statusLeftItems = useMemo<AppStatusBarItem[]>(() => {
    const items = buildStatusLeftItems({
      assetMetadata: sidebarAssetMetadata,
      currentFile: sidebarCurrentFile,
      gridUnitLabel,
      settingsError,
      showGrid,
      viewerFeedback,
      viewerStatusLabel,
    });

    if (diagnosticCounts.total > 0) {
      const label =
        diagnosticCounts.errorCount > 0
          ? `${diagnosticCounts.errorCount} error${diagnosticCounts.errorCount === 1 ? "" : "s"}`
          : `${diagnosticCounts.warningCount} warning${diagnosticCounts.warningCount === 1 ? "" : "s"}`;
      items.push({
        id: "diagnostics",
        content: `Diagnostics: ${label}`,
        onClick: openDiagnosticsPanel,
        tone: diagnosticCounts.errorCount > 0 ? "danger" : "warning",
      });
    }

    return items;
  }, [
    diagnosticCounts.errorCount,
    diagnosticCounts.total,
    diagnosticCounts.warningCount,
    gridUnitLabel,
    openDiagnosticsPanel,
    sidebarAssetMetadata,
    sidebarCurrentFile,
    settingsError,
    showGrid,
    viewerFeedback,
    viewerStatusLabel,
  ]);

  const statusRightItems = useMemo<AppStatusBarItem[]>(() => {
    const items = buildStatusRightItems({
      currentFileSummary,
    });

    if (updateCheck?.update) {
      items.unshift({
        id: "update-available",
        content: `Update: ${updateCheck.update.version}`,
        onClick: openUpdatePanel,
        tone: "warning",
      });
    }

    return items;
  }, [currentFileSummary, openUpdatePanel, updateCheck]);

  return {
    currentFileSummary,
    debugPanelsEnabled,
    diagnosticCounts,
    recordVariantSelectionError,
    sidebarAssetMetadata,
    sidebarCurrentFile,
    sidebarDirectoryListing,
    sidebarWarnings,
    statusLeftItems,
    statusRightItems,
    viewerStatusLabel,
    warnings,
  };
}
