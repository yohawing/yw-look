import { t, useLocale } from "../lib/i18n";
import { useCallback, useEffect, useMemo } from "react";
import {
  buildDiagnosticCounts,
  buildDiagnosticWarnings,
  isDebugPanelsRequested,
  selectUsdCapabilities,
  type DiagnosticCounts,
} from "./assetDiagnostics";
import {
  buildStatusLeftItems,
  buildStatusRightItems,
} from "../components/appStatusItems";
import {
  formatUsdErrorForDisplay,
  isInvalidVariantSelectionError,
  parseUsdError,
  type AssetIssue,
  type StageInspection,
  type StageSummary,
} from "../lib/usd";
import type { FileState } from "../stores/fileStore";
import { useUiStore } from "../stores/uiStore";
import { useViewerStore, type ViewerState } from "../stores/viewerStore";
import { useDebugPanelFixtures } from "../hooks/useDebugPanelFixtures";
import type { AppStatusBarItem } from "../types/ui";
import type { UpdateCheckPayload } from "../lib/updater";

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
  updateCheck: UpdateCheckPayload | null;
  usdInspection: StageInspection | null;
  usdIssues: AssetIssue[];
  usdSummary: StageSummary | null;
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
  updateCheck,
  usdInspection,
  usdIssues,
  usdSummary,
  viewerFeedback,
}: UseViewerDiagnosticsModelOptions) {
  const locale = useLocale();
  const setActiveTab = useUiStore((state) => state.setActiveTab);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  const debugPanelsEnabled = isDebugPanelsRequested();
  const { debugFixtures, useDebugFixtures } =
    useDebugPanelFixtures(debugPanelsEnabled);

  const sidebarCurrentFile = useDebugFixtures
    ? debugFixtures.debugPanelFile
    : currentFile;
  const sidebarAssetMetadata = useDebugFixtures
    ? debugFixtures.debugPanelMetadata
    : assetMetadata;
  const sidebarDirectoryListing = useDebugFixtures
    ? debugFixtures.debugPanelDirectoryListing
    : directoryListing;
  const usdCapabilities = useMemo(
    () => selectUsdCapabilities(usdSummary, usdInspection),
    [usdInspection, usdSummary],
  );

  const recordVariantSelectionError = useCallback((error: unknown): boolean => {
    const parsed = parseUsdError(error);
    if (!isInvalidVariantSelectionError(parsed)) {
      return false;
    }

    const message = formatUsdErrorForDisplay(
      error,
      "Variant selection failed.",
    );
    console.error("[usd] variant selection failed:", error);
    useViewerStore.getState().setVariantSelectionError(message);
    return true;
  }, []);

  const viewerStatusLabel = t(`status.${viewerFeedback.mode}`);

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

  const warnings = useMemo(() => {
    return buildDiagnosticWarnings({
      assetMetadata,
      usdCapabilities,
      usdIssues,
      viewerFeedback,
    });
  }, [locale, assetMetadata, usdCapabilities, usdIssues, viewerFeedback]);
  const sidebarWarnings = useDebugFixtures
    ? debugFixtures.debugPanelWarnings
    : warnings;
  const debugPanelWarnings = useDebugFixtures
    ? debugFixtures.debugPanelWarnings
    : null;

  const diagnosticCounts = useMemo<DiagnosticCounts>(() => {
    return buildDiagnosticCounts({
      assetMetadata,
      debugPanelWarnings,
      usdCapabilities,
      usdIssues,
      viewerFeedback,
    });
  }, [
    assetMetadata,
    debugPanelWarnings,
    usdCapabilities,
    usdIssues,
    viewerFeedback,
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
      viewerFeedback.mode === "missingOptionalLoader" ||
      viewerFeedback.mode === "disabledOptionalLoader" ||
      viewerFeedback.mode === "incompatibleOptionalLoader"
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
    setSidebarOpen(true);
    setActiveTab("warnings");
  }, [setActiveTab, setSidebarOpen]);

  const openUpdatePanel = useCallback(() => {
    setSidebarOpen(true);
    setActiveTab("settings");
    void refreshUpdateConfiguration();
  }, [refreshUpdateConfiguration, setActiveTab, setSidebarOpen]);

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
          ? t("status.errors", { count: diagnosticCounts.errorCount })
          : t("status.warnings", { count: diagnosticCounts.warningCount });
      items.push({
        id: "diagnostics",
        content: t("status.diagnostics", { label }),
        onClick: openDiagnosticsPanel,
        tone: diagnosticCounts.errorCount > 0 ? "danger" : "warning",
      });
    }

    return items;
  }, [
    locale,
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
        content: t("status.update", { version: updateCheck.update.version }),
        onClick: openUpdatePanel,
        tone: "warning",
      });
    }

    return items;
  }, [locale, currentFileSummary, openUpdatePanel, updateCheck]);

  return {
    currentFileSummary,
    debugPanelsEnabled,
    diagnosticCounts,
    recordVariantSelectionError,
    sidebarWarnings,
    statusLeftItems,
    statusRightItems,
    viewerStatusLabel,
    warnings,
  };
}
