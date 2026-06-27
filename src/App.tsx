import { AppShell } from "./app/AppShell";
import { useAppCommands } from "./app/useAppCommands";
import { useAppFileOpen } from "./app/useAppFileOpen";
import { useSettingsActions } from "./app/useSettingsActions";
import {
  useSessionAdjustedUsdSummary,
  useSidebarModel,
} from "./app/useSidebarModel";
import { useViewerDiagnosticsModel } from "./app/useViewerDiagnosticsModel";
import { useViewportToolbarModel } from "./app/useViewportToolbarModel";
import { ViewportHost } from "./app/ViewportHost";
import { useDeferredData } from "./hooks/useDeferredData";
import { usePayloadSession } from "./hooks/usePayloadSession";
import { usePerformanceTracker } from "./hooks/usePerformanceTracker";
import { useUpdater } from "./hooks/useUpdater";
import { useUsdInspector } from "./hooks/useUsdInspector";
import { isTauriEnvironment } from "./lib/platform";
import { useFileStore } from "./stores/fileStore";
import { useUiStore } from "./stores/uiStore";
import { useViewerStore } from "./stores/viewerStore";

export function App() {
  const viewer = useViewerStore();
  const file = useFileStore();
  const ui = useUiStore();

  const { activeTab, sidebarOpen, sidebarWidth, isDragActive, dialogState } =
    ui;
  const {
    currentFile,
    assetInspection,
    directoryListing,
    assetMetadata,
    openError,
  } = file;
  const {
    showGrid,
    gridUnitLabel,
    viewerFeedback,
    resourceDiagnostics,
    usdLoadPolicy,
    selectedMeshName,
    selectedTextureId,
    viewerSurfaceMode,
    selectedUsdPrimPath,
    morphTargetValues,
    activeCameraId,
    variantSelections,
    variantSelectionError,
  } = viewer;

  const isTauri = isTauriEnvironment();
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

  const { displayMode, viewportToolbarItems } = useViewportToolbarModel(viewer);

  const {
    usdSummary,
    usdInspection,
    usdIssues,
    usdLights,
    usdInspectorLoading,
    usdInspectorError,
  } = useUsdInspector(currentFile, isTauri, usdLoadPolicy);

  const {
    settingsPayload,
    settingsError,
    setSettingsPayload,
    setSettingsError,
    recentFilesPayload,
    recentFilesError,
    setRecentFilesError,
    integrationPayload,
    integrationError,
    logDiagnosticEventAndRefresh,
  } = useDeferredData(
    isTauri,
    shouldLoadRecentFiles,
    shouldLoadDeferredData,
    currentFile,
    resourceDiagnostics,
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

  const {
    debugPanelsEnabled,
    diagnosticCounts,
    recordVariantSelectionError,
    sidebarAssetMetadata,
    sidebarCurrentFile,
    sidebarDirectoryListing,
    sidebarWarnings,
    statusLeftItems,
    statusRightItems,
  } = useViewerDiagnosticsModel({
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
  });

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
    viewer.purposeModes,
    recordVariantSelectionError,
  );

  const { handleOpenFile, performSelectFilePath } = useAppFileOpen({
    assetMetadata,
    currentFile,
    file,
    isTauri,
    recordLoadTiming,
    selectedTextureId,
    setSessionGlbBuffer,
    ui,
    usdLoadPolicy,
    viewer,
    viewerSurfaceMode,
  });

  useAppCommands({
    canNavigateNext,
    canNavigatePrev,
    directoryListing,
    displayMode,
    file,
    handleOpenFile,
    isTauri,
    performSelectFilePath,
    ui,
    viewer,
  });

  const { handleToggleAutoCheckForUpdates, handleToggleFileAssociations } =
    useSettingsActions({
      refreshUpdateConfiguration,
      setSettingsError,
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
      activeCameraId,
      activeTab,
      assetInspection,
      currentFile,
      debugPanelsEnabled,
      diagnosticCounts,
      handleCheckForUpdate,
      handleInstallUpdate,
      handleLoadPayload,
      handleToggleAutoCheckForUpdates,
      handleToggleFileAssociations,
      handleUnloadPayload,
      integrationError,
      integrationPayload,
      isCheckingForUpdate,
      isInstallingUpdate,
      isTauri,
      morphTargetValues,
      payloadPrimPaths,
      performSelectFilePath,
      recentFilesError,
      recentFilesPayload,
      selectedMeshName,
      selectedTextureId,
      selectedUsdPrimPath,
      sessionAdjustedUsdSummary,
      setRecentFilesError,
      settingsError,
      settingsPayload,
      sidebarAssetMetadata,
      sidebarCurrentFile,
      sidebarDirectoryListing,
      sidebarWarnings,
      sidebarWidth,
      stageSessionHandle,
      ui,
      unloadedPayloadPaths,
      updateCheck,
      updateConfiguration,
      updateError,
      usdInspection,
      usdInspectorError,
      usdInspectorLoading,
      usdIssues,
      usdLights,
      usdLoadPolicy,
      variantSelectionError,
      variantSelections,
      viewer,
      viewerSurfaceMode,
    });

  return (
    <AppShell
      activeTab={activeTab}
      dialogState={dialogState}
      handleSidebarResizeStart={handleSidebarResizeStart}
      onCloseDialog={() => ui.setDialogState(null)}
      onTabChange={ui.setActiveTab}
      sidebarContent={sidebarContent}
      sidebarOpen={sidebarOpen}
      sidebarTabs={sidebarTabs}
      sidebarWidth={sidebarWidth}
      statusLeftItems={statusLeftItems}
      statusRightItems={statusRightItems}
      viewport={
        <ViewportHost
          deferredPayloadProgress={deferredPayloadProgress}
          displayMode={displayMode}
          file={file}
          handleOpenFile={handleOpenFile}
          isDragActive={isDragActive}
          recordVariantSelectionError={recordVariantSelectionError}
          sessionGlbBuffer={sessionGlbBuffer}
          ui={ui}
          viewer={viewer}
          viewportToolbarItems={viewportToolbarItems}
        />
      }
    />
  );
}
