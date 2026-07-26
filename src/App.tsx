import { useEffect, useMemo, useState } from "react";
import { AppShell } from "./app/AppShell";
import { useAppCommands } from "./app/useAppCommands";
import { useAppFileOpen } from "./app/useAppFileOpen";
import { useSettingsActions } from "./app/useSettingsActions";
import { useSessionAdjustedUsdSummary } from "./app/useSessionAdjustedUsdSummary";
import { useSidebarModel } from "./app/useSidebarModel";
import { useViewerDiagnosticsModel } from "./app/useViewerDiagnosticsModel";
import { ViewportHost } from "./app/ViewportHost";
import { CrashRecoveryNotice } from "./components/CrashRecoveryNotice";
import { useDeferredData } from "./hooks/useDeferredData";
import { usePayloadSession } from "./hooks/usePayloadSession";
import { usePerformanceTracker } from "./hooks/usePerformanceTracker";
import { useUpdater } from "./hooks/useUpdater";
import { useUsdInspector } from "./hooks/useUsdInspector";
import {
  loadCrashRecoveryStatus,
  type CrashRecoveryPayload,
} from "./lib/crashRecovery";
import { isTauriEnvironment } from "./lib/platform";
import { useStartupBench } from "./lib/startupBench";
import { useFileStore } from "./stores/fileStore";
import { useUiStore } from "./stores/uiStore";
import { useViewerStore } from "./stores/viewerStore";
import {
  disabledOptionalLoaderPackIds,
  incompatibleOptionalLoaderPackIds,
} from "./viewer";

export function App() {
  const currentFile = useFileStore((state) => state.currentFile);
  const directoryListing = useFileStore((state) => state.directoryListing);
  const assetMetadata = useFileStore((state) => state.assetMetadata);
  const openError = useFileStore((state) => state.openError);
  const activeTab = useUiStore((state) => state.activeTab);
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const sidebarWidth = useUiStore((state) => state.sidebarWidth);
  const isDragActive = useUiStore((state) => state.isDragActive);
  const dialogState = useUiStore((state) => state.dialogState);
  const setActiveTab = useUiStore((state) => state.setActiveTab);
  const setDialogState = useUiStore((state) => state.setDialogState);
  const showGrid = useViewerStore((state) => state.showGrid);
  const gridUnitLabel = useViewerStore((state) => state.gridUnitLabel);
  const viewerFeedback = useViewerStore((state) => state.viewerFeedback);
  const usdLoadPolicy = useViewerStore((state) => state.usdLoadPolicy);
  const variantSelections = useViewerStore((state) => state.variantSelections);
  const purposeModes = useViewerStore((state) => state.purposeModes);
  const updateViewerFeedback = useViewerStore(
    (state) => state.updateViewerFeedback,
  );

  const isTauri = isTauriEnvironment();
  const [crashRecoveryStatus, setCrashRecoveryStatus] =
    useState<CrashRecoveryPayload | null>(null);

  useStartupBench(isTauri);
  const shouldLoadRecentFiles = sidebarOpen;
  const shouldLoadDeferredData = sidebarOpen;
  const canNavigatePrev =
    directoryListing !== null &&
    directoryListing.currentIndex !== null &&
    directoryListing.currentIndex > 0 &&
    directoryListing.files.length > 0;
  const canNavigateNext =
    directoryListing !== null &&
    directoryListing.currentIndex !== null &&
    directoryListing.currentIndex < directoryListing.files.length - 1;

  const {
    usdSummary,
    usdInspection,
    usdIssues,
    usdLights,
    usdLightsError,
    usdInspectorLoading,
    usdInspectorError,
  } = useUsdInspector(
    currentFile,
    isTauri,
    usdLoadPolicy,
    viewerFeedback.mode === "ready",
  );

  const {
    settingsPayload,
    settingsError,
    setSettingsPayload,
    setSettingsError,
    recentFilesPayload,
    recentFilesError,
    setRecentFilesError,
    setOptionalLoaderManifests,
    optionalLoaderManifests,
    optionalLoaderManifestsError,
    logDiagnosticEventAndRefresh,
  } = useDeferredData(
    isTauri,
    shouldLoadRecentFiles,
    shouldLoadDeferredData,
    currentFile,
  );

  const {
    updateConfiguration,
    updateCheck,
    updateError,
    isCheckingForUpdate,
    isInstallingUpdate,
    setUpdateError,
    refreshUpdateConfiguration,
    handleCheckForUpdate,
    handleInstallUpdate,
  } = useUpdater(shouldLoadDeferredData, settingsPayload);

  const { recordLoadTiming } = usePerformanceTracker(
    settingsPayload,
    settingsError,
  );

  const disabledLoaderPackIds = useMemo(
    () =>
      disabledOptionalLoaderPackIds(
        settingsPayload?.settings.optionalLoaderPacks,
      ),
    [settingsPayload?.settings.optionalLoaderPacks],
  );
  const incompatibleLoaderPackIds = useMemo(
    () => incompatibleOptionalLoaderPackIds(optionalLoaderManifests),
    [optionalLoaderManifests],
  );

  const { recordVariantSelectionError, statusLeftItems, statusRightItems } =
    useViewerDiagnosticsModel({
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
    });

  useEffect(() => {
    if (!isTauri) return;
    let isActive = true;

    loadCrashRecoveryStatus()
      .then((status) => {
        if (isActive) {
          setCrashRecoveryStatus(status);
        }
      })
      .catch((error: unknown) => {
        void logDiagnosticEventAndRefresh({
          code: "crash-recovery-status-failed",
          level: "warn",
          message: "Failed to load crash recovery status.",
          detail: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      isActive = false;
    };
  }, [isTauri, logDiagnosticEventAndRefresh]);

  const {
    stageSessionHandle,
    payloadPrimPaths,
    unloadedPayloadPaths,
    sessionGlbBuffer,
    setSessionGlbBuffer,
    deferredPayloadProgress,
    handleLoadPayload,
    handleUnloadPayload,
  } = usePayloadSession(
    currentFile,
    isTauri,
    usdLoadPolicy,
    usdInspection,
    variantSelections,
    purposeModes,
    recordVariantSelectionError,
    viewerFeedback.warning,
    updateViewerFeedback,
    viewerFeedback.mode === "ready",
  );

  const { handleOpenFile, performSelectFilePath } = useAppFileOpen({
    assetMetadata,
    currentFile,
    isTauri,
    recordLoadTiming,
    setSessionGlbBuffer,
    usdLoadPolicy,
  });

  useAppCommands({
    canNavigateNext,
    canNavigatePrev,
    directoryListing,
    handleOpenFile,
    isTauri,
    performSelectFilePath,
  });

  const {
    fileAssociationError,
    fileAssociationResult,
    fileAssociationsAvailable,
    handleOpenDefaultAppsSettings,
    handleRetryFileAssociations,
    handleToggleAutoCheckForUpdates,
    handleToggleFileAssociations,
    handleToggleOptionalLoaderPack,
  } = useSettingsActions({
    isTauri,
    refreshUpdateConfiguration,
    setSettingsError,
    setOptionalLoaderManifests,
    setSettingsPayload,
    setUpdateError,
    settingsPayload,
  });

  const sessionAdjustedUsdSummary = useSessionAdjustedUsdSummary({
    payloadPrimPaths,
    unloadedPayloadPaths,
    usdInspection,
    usdLoadPolicy,
    usdSummary,
  });

  const { handleSidebarResizeStart, sidebarContent, sidebarTabs } =
    useSidebarModel({
      handleCheckForUpdate,
      handleInstallUpdate,
      handleLoadPayload,
      handleOpenDefaultAppsSettings,
      handleRetryFileAssociations,
      handleToggleAutoCheckForUpdates,
      handleToggleFileAssociations,
      handleToggleOptionalLoaderPack,
      handleUnloadPayload,
      isCheckingForUpdate,
      isInstallingUpdate,
      isTauri,
      fileAssociationError,
      fileAssociationResult,
      fileAssociationsAvailable,
      optionalLoaderManifests,
      optionalLoaderManifestsError,
      payloadPrimPaths,
      performSelectFilePath,
      recentFilesError,
      recentFilesPayload,
      sessionAdjustedUsdSummary,
      setRecentFilesError,
      settingsError,
      settingsPayload,
      stageSessionHandle,
      unloadedPayloadPaths,
      updateCheck,
      updateConfiguration,
      updateError,
      usdInspection,
      usdInspectorError,
      usdInspectorLoading,
      usdIssues,
      usdLights,
      usdLightsError,
    });

  return (
    <AppShell
      activeTab={activeTab}
      banner={<CrashRecoveryNotice status={crashRecoveryStatus} />}
      dialogState={dialogState}
      handleSidebarResizeStart={handleSidebarResizeStart}
      onCloseDialog={() => setDialogState(null)}
      onTabChange={setActiveTab}
      sidebarContent={sidebarContent}
      sidebarOpen={sidebarOpen}
      sidebarTabs={sidebarTabs}
      sidebarWidth={sidebarWidth}
      statusLeftItems={statusLeftItems}
      statusRightItems={statusRightItems}
      viewport={
        <ViewportHost
          deferredPayloadProgress={deferredPayloadProgress}
          handleOpenFile={handleOpenFile}
          isDragActive={isDragActive}
          recordVariantSelectionError={recordVariantSelectionError}
          sessionGlbBuffer={sessionGlbBuffer}
          usdInspection={usdInspection}
          disabledOptionalLoaderPackIds={disabledLoaderPackIds}
          incompatibleOptionalLoaderPackIds={incompatibleLoaderPackIds}
        />
      }
    />
  );
}
