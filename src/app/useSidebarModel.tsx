import { t, useLocale } from "../lib/i18n";
/* eslint-disable react-refresh/only-export-components -- this file intentionally groups lazy sidebar components with the sidebar model hook. */
import {
  Suspense,
  useCallback,
  lazy,
  useEffect,
  useMemo,
  useRef,
  type PointerEvent,
  type ReactNode,
} from "react";
import { SidebarPanels } from "./SidebarPanels";
import { CurrentFileCard } from "../components/CurrentFileCard";
import { FileBrowserCard } from "../components/FileBrowserCard";
import { HierarchySidebarPanel } from "../components/HierarchySidebarPanel";
import { MaterialListCard } from "../components/MaterialListCard";
import { createSidebarTabs } from "../components/sidebarTabItems";
import { SidebarEmpty, SidebarSection } from "../lib/sidebarPrimitives";
import type { SidebarTabItem } from "../components/SidebarTabs";
import type { SidebarTabId } from "../components/SidebarTabIcons";
import { TexturesSidebarPanel } from "../components/TexturesSidebarPanel";
import { UsdInspectorSidebarPanel } from "../components/UsdInspectorSidebarPanel";
import { WarningsSidebarPanel } from "../components/WarningsSidebarPanel";
import {
  buildDiagnosticCounts,
  buildDiagnosticWarnings,
  isDebugPanelsRequested,
  selectUsdCapabilities,
} from "./assetDiagnostics";
import { errorMessage } from "../lib/errors";
import { isUsdFile } from "../lib/files";
import { useDebugPanelFixtures } from "../hooks/useDebugPanelFixtures";
import type {
  AssetIssue,
  StageInspection,
  StageSummary,
  StageSessionHandle,
} from "../lib/usd";
import { useFileStore } from "../stores/fileStore";
import { useUiStore } from "../stores/uiStore";
import type { OptionalLoaderPackManifest } from "../lib/loaderPacks";
import type { RecentFilesPayload } from "../lib/recentFiles";
import type { SettingsPayload } from "../lib/settings";
import type { FileAssociationSyncResult } from "../lib/fileAssociations";
import type {
  UpdateCheckPayload,
  UpdateConfigurationPayload,
} from "../lib/updater";
import { useViewerStore } from "../stores/viewerStore";
import { listOptionalLoaderPacks } from "../viewer";
import { renderMetadataCardForPackMetadata } from "../packs";
import type { PackMetadata } from "../types/format-pack";

const RecentFilesCard = lazy(() =>
  import("../components/RecentFilesCard").then((module) => ({
    default: module.RecentFilesCard,
  })),
);
const SettingsCard = lazy(() =>
  import("../components/SettingsCard").then((module) => ({
    default: module.SettingsCard,
  })),
);
const UpdateCard = lazy(() =>
  import("../components/UpdateCard").then((module) => ({
    default: module.UpdateCard,
  })),
);

function SidebarCardFallback() {
  useLocale();
  return (
    <SidebarSection title={t("loading")}>
      <SidebarEmpty>{t("loading_panel")}</SidebarEmpty>
    </SidebarSection>
  );
}

type UseSidebarModelOptions = {
  handleCheckForUpdate: () => Promise<void>;
  handleInstallUpdate: () => Promise<void>;
  handleLoadPayload: (primPath: string) => Promise<void>;
  handleOpenDefaultAppsSettings?: () => Promise<void>;
  handleRetryFileAssociations?: () => Promise<void>;
  handleChangeLanguage: (
    language: import("../lib/i18n").LanguagePreference,
  ) => Promise<void>;
  handleToggleAutoCheckForUpdates: () => Promise<void>;
  handleToggleFileAssociations?: () => Promise<void>;
  handleToggleOptionalLoaderPack: (packId: string) => Promise<void>;
  handleUnloadPayload: (primPath: string) => Promise<void>;
  isCheckingForUpdate: boolean;
  isInstallingUpdate: boolean;
  isTauri: boolean;
  fileAssociationError?: string | null;
  fileAssociationResult?: FileAssociationSyncResult | null;
  fileAssociationsAvailable?: boolean;
  optionalLoaderManifests: readonly OptionalLoaderPackManifest[];
  optionalLoaderManifestsError: string | null;
  payloadPrimPaths: ReadonlySet<string>;
  performSelectFilePath: (
    path: string,
    reason: "navigation" | "recent",
  ) => Promise<void>;
  recentFilesError: string | null;
  recentFilesPayload: RecentFilesPayload | null;
  sessionAdjustedUsdSummary: StageSummary | null;
  setRecentFilesError: (error: string | null) => void;
  settingsError: string | null;
  settingsPayload: SettingsPayload | null;
  stageSessionHandle: StageSessionHandle | null;
  unloadedPayloadPaths: ReadonlySet<string>;
  updateCheck: UpdateCheckPayload | null;
  updateConfiguration: UpdateConfigurationPayload | null;
  updateError: string | null;
  usdInspection: StageInspection | null;
  usdInspectorError: string | null;
  usdInspectorLoading: boolean;
  usdIssues: AssetIssue[];
};

export function useSidebarModel({
  handleCheckForUpdate,
  handleInstallUpdate,
  handleLoadPayload,
  handleOpenDefaultAppsSettings,
  handleRetryFileAssociations,
  handleChangeLanguage,
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
}: UseSidebarModelOptions) {
  const locale = useLocale();
  const currentFile = useFileStore((state) => state.currentFile);
  const assetMetadata = useFileStore((state) => state.assetMetadata);
  const packMetadata = useFileStore((state) => state.packMetadata);
  const viewerFeedback = useViewerStore((state) => state.viewerFeedback);
  const activeTab = useUiStore((state) => state.activeTab);
  const sidebarWidth = useUiStore((state) => state.sidebarWidth);
  const setSidebarWidth = useUiStore((state) => state.setSidebarWidth);
  useEffect(() => {
    const resize = () => setSidebarWidth(useUiStore.getState().sidebarWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [setSidebarWidth]);
  const sidebarResizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      sidebarResizeCleanupRef.current?.();
    },
    [],
  );
  const debugPanelsEnabled = isDebugPanelsRequested();
  const { debugFixtures, useDebugFixtures } =
    useDebugPanelFixtures(debugPanelsEnabled);
  const usdCapabilities = useMemo(
    () => selectUsdCapabilities(sessionAdjustedUsdSummary, usdInspection),
    [sessionAdjustedUsdSummary, usdInspection],
  );

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
  const debugMmdMetadata = debugFixtures?.debugPanelMetadata.mmd ?? null;
  const sidebarPackMetadata = useMemo<PackMetadata | null>(
    () =>
      useDebugFixtures && debugMmdMetadata
        ? { kind: "mmd", asset: debugMmdMetadata }
        : packMetadata,
    [debugMmdMetadata, packMetadata, useDebugFixtures],
  );
  const packMetadataCard = useMemo(
    () =>
      sidebarPackMetadata
        ? renderMetadataCardForPackMetadata(sidebarPackMetadata, {
            onSelect: useViewerStore.getState().setSelectedMeshName,
          })
        : null,
    [sidebarPackMetadata],
  );
  const sidebarRecentFilesPayload = useDebugFixtures
    ? debugFixtures.debugPanelRecentFiles
    : recentFilesPayload;
  const sidebarRecentFilesError = useDebugFixtures ? null : recentFilesError;
  const diagnosticCounts = useMemo(() => {
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

  const renderSidebarPanel = useCallback(
    (tab: SidebarTabId): ReactNode => {
      switch (tab) {
        case "properties":
          return (
            <>
              <CurrentFileCard
                debugPanelsEnabled={debugPanelsEnabled}
                usdPayloadSummary={
                  useDebugFixtures
                    ? debugFixtures.debugUsdSummary
                    : sessionAdjustedUsdSummary
                }
                warnings={sidebarWarnings}
              />
              {packMetadataCard}
              {isTauri && isUsdFile(currentFile) && (
                <>
                  <UsdInspectorSidebarPanel
                    error={usdInspectorError}
                    inspection={usdInspection}
                    issues={usdIssues}
                    loading={usdInspectorLoading}
                    summary={sessionAdjustedUsdSummary}
                  />
                </>
              )}
              {useDebugFixtures && (
                <UsdInspectorSidebarPanel
                  error={null}
                  inspection={debugFixtures.debugUsdInspection}
                  issues={[]}
                  loading={false}
                  summary={debugFixtures.debugUsdSummary}
                />
              )}
            </>
          );
        case "file":
          return (
            <>
              <FileBrowserCard
                debugPanelsEnabled={debugPanelsEnabled}
                onOpenPath={(path) => {
                  void performSelectFilePath(path, "navigation").catch(
                    (error: unknown) => {
                      setRecentFilesError(
                        errorMessage(error, "Failed to open file."),
                      );
                    },
                  );
                }}
              />
              <Suspense fallback={<SidebarCardFallback />}>
                <RecentFilesCard
                  onOpenPath={(path) => {
                    void performSelectFilePath(path, "recent").catch(
                      (error: unknown) => {
                        setRecentFilesError(
                          errorMessage(error, "Failed to open recent file."),
                        );
                      },
                    );
                  }}
                  recentFilesError={sidebarRecentFilesError}
                  recentFilesPayload={sidebarRecentFilesPayload}
                />
              </Suspense>
            </>
          );
        case "hierarchy":
          return (
            <HierarchySidebarPanel
              debugPanelsEnabled={debugPanelsEnabled}
              inspection={
                useDebugFixtures
                  ? debugFixtures.debugUsdInspection
                  : usdInspection
              }
              stageSessionHandle={stageSessionHandle}
              payloadPrimPaths={payloadPrimPaths}
              unloadedPayloadPaths={unloadedPayloadPaths}
              onLoadPayload={handleLoadPayload}
              onUnloadPayload={handleUnloadPayload}
            />
          );
        case "materials":
          return <MaterialListCard debugPanelsEnabled={debugPanelsEnabled} />;
        case "textures":
          return (
            <TexturesSidebarPanel debugPanelsEnabled={debugPanelsEnabled} />
          );
        case "settings":
          return (
            <>
              <Suspense fallback={<SidebarCardFallback />}>
                <SettingsCard
                  onChangeLanguage={handleChangeLanguage}
                  settingsPayload={settingsPayload}
                  settingsError={settingsError}
                  fileAssociationError={fileAssociationError}
                  fileAssociationResult={fileAssociationResult}
                  fileAssociationsAvailable={fileAssociationsAvailable}
                  optionalLoaderPacks={listOptionalLoaderPacks(
                    settingsPayload?.settings.optionalLoaderPacks,
                    optionalLoaderManifests,
                  )}
                  optionalLoaderPacksError={optionalLoaderManifestsError}
                  onToggleAutoCheckForUpdates={() =>
                    void handleToggleAutoCheckForUpdates()
                  }
                  onToggleFileAssociations={() =>
                    void handleToggleFileAssociations?.()
                  }
                  onToggleOptionalLoaderPack={(packId) =>
                    void handleToggleOptionalLoaderPack(packId)
                  }
                  onOpenDefaultAppsSettings={() =>
                    void handleOpenDefaultAppsSettings?.()
                  }
                  onRetryFileAssociations={() =>
                    void handleRetryFileAssociations?.()
                  }
                />
              </Suspense>
              <Suspense fallback={<SidebarCardFallback />}>
                <UpdateCard
                  isCheckingForUpdate={isCheckingForUpdate}
                  isInstallingUpdate={isInstallingUpdate}
                  onCheckForUpdate={() => void handleCheckForUpdate()}
                  onInstallUpdate={() => void handleInstallUpdate()}
                  updateCheck={updateCheck}
                  updateConfiguration={updateConfiguration}
                  updateError={updateError}
                />
              </Suspense>
            </>
          );
        case "warnings":
          return <WarningsSidebarPanel warnings={sidebarWarnings} />;
      }
    },
    [
      currentFile,
      debugFixtures,
      debugPanelsEnabled,
      handleCheckForUpdate,
      handleInstallUpdate,
      handleLoadPayload,
      handleOpenDefaultAppsSettings,
      handleRetryFileAssociations,
      handleChangeLanguage,
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
      setRecentFilesError,
      sessionAdjustedUsdSummary,
      settingsError,
      settingsPayload,
      packMetadataCard,
      sidebarPackMetadata,
      sidebarRecentFilesError,
      sidebarRecentFilesPayload,
      sidebarWarnings,
      stageSessionHandle,
      unloadedPayloadPaths,
      updateCheck,
      updateConfiguration,
      updateError,
      useDebugFixtures,
      usdInspection,
      usdInspectorError,
      usdInspectorLoading,
      usdIssues,
    ],
  );

  const sidebarContent = useMemo(
    () => (
      <SidebarPanels
        activeTab={activeTab}
        fileIdentity={currentFile?.path ?? null}
        renderPanel={renderSidebarPanel}
      />
    ),
    [activeTab, currentFile?.path, renderSidebarPanel],
  );

  const sidebarTabs = useMemo<SidebarTabItem<SidebarTabId>[]>(
    () =>
      createSidebarTabs().map((tab) => {
        if (tab.id === "warnings" && diagnosticCounts.total > 0) {
          return {
            ...tab,
            badge: {
              label: t("active_diagnostics"),
              tone:
                diagnosticCounts.errorCount > 0
                  ? ("danger" as const)
                  : ("warning" as const),
            },
          };
        }

        if (tab.id === "settings" && updateCheck?.update) {
          return {
            ...tab,
            badge: {
              label: t("update.versionAvailable", {
                version: updateCheck.update.version,
              }),
              tone: "warning" as const,
            },
          };
        }

        return tab;
      }),
    [
      locale,
      diagnosticCounts.errorCount,
      diagnosticCounts.total,
      updateCheck?.update,
    ],
  );

  const handleSidebarResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    sidebarResizeCleanupRef.current?.();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const nextWidth = startWidth + (startX - moveEvent.clientX);
      setSidebarWidth(nextWidth);
    };

    const stopResize = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      window.removeEventListener("blur", stopResize);
      document.body.classList.remove("is-resizing-sidebar");
      sidebarResizeCleanupRef.current = null;
    };

    document.body.classList.add("is-resizing-sidebar");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    window.addEventListener("blur", stopResize);
    sidebarResizeCleanupRef.current = stopResize;
  };

  return {
    handleSidebarResizeStart,
    sidebarContent,
    sidebarTabs,
  };
}
