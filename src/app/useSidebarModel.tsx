/* eslint-disable react-refresh/only-export-components -- this file intentionally groups lazy sidebar components with the sidebar model hook. */
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { type AssetMetadata } from "../components/assetMetadata";
import { CurrentFileCard } from "../components/CurrentFileCard";
import { FileBrowserCard } from "../components/FileBrowserCard";
import { HierarchyCard } from "../components/HierarchyCard";
import { UsdPrimPropertyPanel } from "../components/UsdPrimPropertyPanel";
import { MaterialListCard } from "../components/MaterialListCard";
import { MmdMetadataCard } from "../components/MmdMetadataCard";
import { SceneLightsCamerasCard } from "../components/SceneLightsCamerasCard";
import { createSidebarTabs } from "../components/sidebarTabItems";
import { SidebarEmpty, SidebarSection } from "../components/sidebarPrimitives";
import type { SidebarTabItem } from "../components/SidebarTabs";
import type { SidebarTabId } from "../components/SidebarTabIcons";
import { TextureListCard } from "../components/TextureListCard";
import { UsdInspectorCard } from "../components/UsdInspectorCard";
import { WarningsCard } from "../components/WarningsCard";
import { isUsdFile } from "../lib/files";
import type {
  AssetIssue,
  StageInspection,
  StageLoadPolicy,
  StageSummary,
  StageSessionHandle,
  UsdLightInfo,
  VariantSelection,
} from "../lib/usd";
import { useViewerStore, type ViewerState } from "../stores/viewerStore";
import type { FileState } from "../stores/fileStore";
import type { UiState } from "../stores/uiStore";
import type { IntegrationPayload } from "../lib/integrations";
import type { OptionalLoaderPackManifest } from "../lib/loaderPacks";
import type { RecentFilesPayload } from "../lib/recentFiles";
import type { SettingsPayload } from "../lib/settings";
import type {
  UpdateCheckPayload,
  UpdateConfigurationPayload,
} from "../lib/updater";
import { listOptionalLoaderPacks } from "../viewer";

const CompositionArcsCard = lazy(() =>
  import("../components/CompositionArcsCard").then((module) => ({
    default: module.CompositionArcsCard,
  })),
);
const IntegrationCard = lazy(() =>
  import("../components/IntegrationCard").then((module) => ({
    default: module.IntegrationCard,
  })),
);
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
const UsdSourceCard = lazy(() =>
  import("../components/UsdSourceCard").then((module) => ({
    default: module.UsdSourceCard,
  })),
);

type DebugPanelFixtures = typeof import("../components/debugPanelFixtures");

function SidebarCardFallback() {
  return (
    <SidebarSection title="Loading">
      <SidebarEmpty>Loading panel…</SidebarEmpty>
    </SidebarSection>
  );
}

type DiagnosticCounts = {
  errorCount: number;
  warningCount: number;
  total: number;
};

type UseSidebarModelOptions = {
  activeCameraId: ViewerState["activeCameraId"];
  activeTab: SidebarTabId;
  assetInspection: FileState["assetInspection"];
  currentFile: FileState["currentFile"];
  debugPanelsEnabled: boolean;
  diagnosticCounts: DiagnosticCounts;
  handleCheckForUpdate: () => Promise<void>;
  handleInstallUpdate: () => Promise<void>;
  handleLoadPayload: (primPath: string) => Promise<void>;
  handleToggleAutoCheckForUpdates: () => Promise<void>;
  handleToggleFileAssociations: () => Promise<void>;
  handleToggleOptionalLoaderPack: (packId: string) => Promise<void>;
  handleUnloadPayload: (primPath: string) => Promise<void>;
  integrationError: string | null;
  integrationPayload: IntegrationPayload | null;
  isCheckingForUpdate: boolean;
  isInstallingUpdate: boolean;
  isTauri: boolean;
  optionalLoaderManifests: readonly OptionalLoaderPackManifest[];
  optionalLoaderManifestsError: string | null;
  morphTargetValues: ViewerState["morphTargetValues"];
  payloadPrimPaths: ReadonlySet<string>;
  performSelectFilePath: (
    path: string,
    reason: "navigation" | "recent",
  ) => Promise<void>;
  recentFilesError: string | null;
  recentFilesPayload: RecentFilesPayload | null;
  selectedMeshName: ViewerState["selectedMeshName"];
  selectedTextureId: ViewerState["selectedTextureId"];
  selectedUsdPrimPath: ViewerState["selectedUsdPrimPath"];
  sessionAdjustedUsdSummary: StageSummary | null;
  setRecentFilesError: (error: string | null) => void;
  settingsError: string | null;
  settingsPayload: SettingsPayload | null;
  sidebarAssetMetadata: AssetMetadata | null;
  sidebarCurrentFile: FileState["currentFile"];
  sidebarDirectoryListing: FileState["directoryListing"];
  sidebarWarnings: string[];
  sidebarWidth: number;
  stageSessionHandle: StageSessionHandle | null;
  ui: UiState;
  unloadedPayloadPaths: ReadonlySet<string>;
  updateCheck: UpdateCheckPayload | null;
  updateConfiguration: UpdateConfigurationPayload | null;
  updateError: string | null;
  usdInspection: StageInspection | null;
  usdInspectorError: string | null;
  usdInspectorLoading: boolean;
  usdIssues: AssetIssue[];
  usdLights: UsdLightInfo[] | null;
  usdLightsError: string | null;
  usdLoadPolicy: StageLoadPolicy;
  variantSelectionError: ViewerState["variantSelectionError"];
  variantSelections: VariantSelection[];
  viewer: ViewerState;
  viewerSurfaceMode: ViewerState["viewerSurfaceMode"];
};

export function useSessionAdjustedUsdSummary({
  payloadPrimPaths,
  unloadedPayloadPaths,
  usdInspection,
  usdLoadPolicy,
  usdSummary,
}: {
  payloadPrimPaths: ReadonlySet<string>;
  unloadedPayloadPaths: ReadonlySet<string>;
  usdInspection: StageInspection | null;
  usdLoadPolicy: StageLoadPolicy;
  usdSummary: StageSummary | null;
}) {
  return useMemo(() => {
    if (
      !usdSummary ||
      !usdInspection ||
      usdLoadPolicy !== "noPayloads" ||
      payloadPrimPaths.size === 0
    ) {
      return usdSummary;
    }
    const payloadArcCounts = usdInspection.payloads.reduce(
      (counts, arc) => {
        if (arc.state === "missing") {
          counts.unresolved += 1;
        } else if (
          arc.state === "unloaded" &&
          unloadedPayloadPaths.has(arc.sourcePrim)
        ) {
          counts.unloaded += 1;
        } else {
          counts.resolved += 1;
        }
        return counts;
      },
      { resolved: 0, unloaded: 0, unresolved: 0 },
    );
    return {
      ...usdSummary,
      unloadedPayloadCount: payloadArcCounts.unloaded,
      resolvedPayloadCount: payloadArcCounts.resolved,
      unresolvedPayloadCount: payloadArcCounts.unresolved,
    };
  }, [
    payloadPrimPaths.size,
    unloadedPayloadPaths,
    usdInspection,
    usdLoadPolicy,
    usdSummary,
  ]);
}

export function useSidebarModel({
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
  handleToggleOptionalLoaderPack,
  handleUnloadPayload,
  integrationError,
  integrationPayload,
  isCheckingForUpdate,
  isInstallingUpdate,
  isTauri,
  optionalLoaderManifests,
  optionalLoaderManifestsError,
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
  usdLightsError,
  usdLoadPolicy,
  variantSelectionError,
  variantSelections,
  viewer,
  viewerSurfaceMode,
}: UseSidebarModelOptions) {
  const [debugFixtures, setDebugFixtures] = useState<DebugPanelFixtures | null>(
    null,
  );
  const useDebugFixtures =
    import.meta.env.DEV && debugPanelsEnabled && debugFixtures !== null;

  useEffect(() => {
    if (!import.meta.env.DEV || !debugPanelsEnabled) {
      return;
    }

    let isActive = true;
    void import("../components/debugPanelFixtures").then((module) => {
      if (isActive) {
        setDebugFixtures(module);
      }
    });
    return () => {
      isActive = false;
    };
  }, [debugPanelsEnabled]);

  const sidebarRecentFilesPayload = useDebugFixtures
    ? debugFixtures.debugPanelRecentFiles
    : recentFilesPayload;
  const sidebarRecentFilesError = useDebugFixtures ? null : recentFilesError;

  const handleMorphTargetChange = useCallback(
    (selectionKey: string, morphTargetIndex: number, value: number) => {
      const clamped = Math.min(1, Math.max(0, value));
      const prev = useViewerStore.getState().morphTargetValues;
      useViewerStore.getState().setMorphTargetValues({
        ...prev,
        [selectionKey]: {
          ...(prev[selectionKey] ?? {}),
          [morphTargetIndex]: clamped,
        },
      });
    },
    [],
  );

  const applyVariantSelection = useCallback(
    (primPath: string, setName: string, variantName: string) => {
      useViewerStore.getState().setVariantSelectionError(null);
      const prev = useViewerStore.getState().variantSelections;
      const next = prev.filter(
        (s) => !(s.primPath === primPath && s.setName === setName),
      );
      next.push({ primPath, setName, variantName });
      useViewerStore.getState().setVariantSelections(next);
    },
    [],
  );

  const sidebarContent = useMemo<ReactNode>(() => {
    switch (activeTab) {
      case "properties":
        return (
          <>
            <CurrentFileCard
              animationClips={sidebarAssetMetadata?.animationClips}
              assetInspection={assetInspection}
              currentFile={sidebarCurrentFile}
              metadata={sidebarAssetMetadata}
              usdPayloadSummary={
                useDebugFixtures
                  ? debugFixtures.debugUsdSummary
                  : sessionAdjustedUsdSummary
              }
              warnings={sidebarWarnings}
            />
            {sidebarAssetMetadata?.mmd ? (
              <MmdMetadataCard metadata={sidebarAssetMetadata.mmd} />
            ) : null}
            {isTauri && isUsdFile(currentFile) && (
              <>
                <UsdInspectorCard
                  error={usdInspectorError}
                  inspection={usdInspection}
                  issues={usdIssues}
                  loading={usdInspectorLoading}
                  summary={sessionAdjustedUsdSummary}
                  loadPolicy={usdLoadPolicy}
                  onLoadPolicyChange={viewer.setUsdLoadPolicy}
                  variantSelectionError={variantSelectionError}
                  variantSelections={variantSelections}
                  onVariantChange={applyVariantSelection}
                />
                <Suspense fallback={<SidebarCardFallback />}>
                  <CompositionArcsCard
                    inspection={usdInspection}
                    loading={usdInspectorLoading}
                  />
                </Suspense>
                <Suspense fallback={<SidebarCardFallback />}>
                  <UsdSourceCard currentFile={currentFile} />
                </Suspense>
              </>
            )}
            {useDebugFixtures && (
              <UsdInspectorCard
                error={null}
                inspection={debugFixtures.debugUsdInspection}
                issues={[]}
                loading={false}
                summary={debugFixtures.debugUsdSummary}
                loadPolicy={usdLoadPolicy}
                onLoadPolicyChange={viewer.setUsdLoadPolicy}
                variantSelectionError={variantSelectionError}
                variantSelections={variantSelections}
                onVariantChange={applyVariantSelection}
              />
            )}
            {sidebarAssetMetadata && (
              <SceneLightsCamerasCard
                lights={sidebarAssetMetadata.lights}
                cameras={sidebarAssetMetadata.cameras}
                usdLights={usdLights ?? undefined}
                usdLightsError={usdLightsError}
                activeCameraId={activeCameraId}
                onSelectCamera={viewer.setActiveCameraId}
              />
            )}
          </>
        );
      case "file":
        return (
          <>
            <FileBrowserCard
              currentFile={sidebarCurrentFile}
              directoryListing={sidebarDirectoryListing}
              onOpenPath={(path) => {
                void performSelectFilePath(path, "navigation").catch(
                  (error: unknown) => {
                    setRecentFilesError(
                      error instanceof Error
                        ? error.message
                        : "Failed to open file.",
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
                        error instanceof Error
                          ? error.message
                          : "Failed to open recent file.",
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
          <>
            <HierarchyCard
              hierarchy={sidebarAssetMetadata?.hierarchy ?? []}
              objectInfo={sidebarAssetMetadata?.objectInfo}
              morphTargetValues={morphTargetValues}
              onMorphTargetChange={handleMorphTargetChange}
              selectedName={selectedMeshName}
              onSelectName={viewer.setSelectedMeshName}
              onSelectPrimPath={
                isUsdFile(currentFile)
                  ? (primPath) => viewer.setSelectedUsdPrimPath(primPath)
                  : undefined
              }
              payloadPrimPaths={
                stageSessionHandle !== null ? payloadPrimPaths : undefined
              }
              unloadedPayloadPaths={
                stageSessionHandle !== null ? unloadedPayloadPaths : undefined
              }
              onLoadPayload={
                stageSessionHandle !== null ? handleLoadPayload : undefined
              }
              onUnloadPayload={
                stageSessionHandle !== null ? handleUnloadPayload : undefined
              }
            />
            {isUsdFile(currentFile) && (
              <UsdPrimPropertyPanel
                path={currentFile?.path ?? null}
                selectedPrimPath={selectedUsdPrimPath}
              />
            )}
          </>
        );
      case "materials":
        return (
          <MaterialListCard materials={sidebarAssetMetadata?.materials ?? []} />
        );
      case "textures":
        return (
          <TextureListCard
            activeTextureId={
              selectedTextureId ?? sidebarAssetMetadata?.textures[0]?.id ?? null
            }
            onSelectTexture={(textureId) => {
              if (
                textureId === selectedTextureId &&
                viewerSurfaceMode === "texture"
              ) {
                viewer.setViewerSurfaceMode("asset");
              } else {
                viewer.setSelectedTextureId(textureId);
                viewer.setViewerSurfaceMode("texture");
              }
            }}
            textures={sidebarAssetMetadata?.textures ?? []}
          />
        );
      case "settings":
        return (
          <>
            <Suspense fallback={<SidebarCardFallback />}>
              <SettingsCard
                settingsPayload={settingsPayload}
                settingsError={settingsError}
                optionalLoaderPacks={listOptionalLoaderPacks(
                  settingsPayload?.settings.optionalLoaderPacks,
                  optionalLoaderManifests,
                )}
                optionalLoaderPacksError={optionalLoaderManifestsError}
                onToggleFileAssociations={() =>
                  void handleToggleFileAssociations()
                }
                onToggleAutoCheckForUpdates={() =>
                  void handleToggleAutoCheckForUpdates()
                }
                onToggleOptionalLoaderPack={(packId) =>
                  void handleToggleOptionalLoaderPack(packId)
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
            <Suspense fallback={<SidebarCardFallback />}>
              <IntegrationCard
                integrationError={integrationError}
                integrationPayload={integrationPayload}
              />
            </Suspense>
          </>
        );
      case "warnings":
        return (
          <>
            <WarningsCard
              warnings={sidebarWarnings}
              scaleNormalizationApplied={
                viewer.scaleNormalization?.applied ?? false
              }
              onCancelScaleNormalization={
                viewer.bumpCancelScaleNormalizeVersion
              }
            />
          </>
        );
    }
  }, [
    activeCameraId,
    activeTab,
    applyVariantSelection,
    assetInspection,
    currentFile,
    debugFixtures,
    handleCheckForUpdate,
    handleInstallUpdate,
    handleLoadPayload,
    handleMorphTargetChange,
    handleToggleAutoCheckForUpdates,
    handleToggleFileAssociations,
    handleToggleOptionalLoaderPack,
    handleUnloadPayload,
    integrationError,
    integrationPayload,
    isCheckingForUpdate,
    isInstallingUpdate,
    isTauri,
    optionalLoaderManifests,
    optionalLoaderManifestsError,
    morphTargetValues,
    payloadPrimPaths,
    performSelectFilePath,
    setRecentFilesError,
    selectedMeshName,
    selectedTextureId,
    selectedUsdPrimPath,
    sessionAdjustedUsdSummary,
    settingsError,
    settingsPayload,
    sidebarAssetMetadata,
    sidebarCurrentFile,
    sidebarDirectoryListing,
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
    usdLights,
    usdLightsError,
    usdLoadPolicy,
    variantSelectionError,
    variantSelections,
    viewer,
    viewerSurfaceMode,
  ]);

  const sidebarTabs = useMemo<SidebarTabItem<SidebarTabId>[]>(
    () =>
      createSidebarTabs().map((tab) =>
        tab.id === "warnings" && diagnosticCounts.total > 0
          ? {
              ...tab,
              badge: {
                count: diagnosticCounts.total,
                tone:
                  diagnosticCounts.errorCount > 0
                    ? ("danger" as const)
                    : ("warning" as const),
              },
            }
          : tab,
      ),
    [diagnosticCounts.errorCount, diagnosticCounts.total],
  );

  const handleSidebarResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const minWidth = 300;
    const maxWidth = Math.min(560, Math.floor(window.innerWidth * 0.48));

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const nextWidth = startWidth + (startX - moveEvent.clientX);
      ui.setSidebarWidth(Math.min(maxWidth, Math.max(minWidth, nextWidth)));
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.classList.remove("is-resizing-sidebar");
    };

    document.body.classList.add("is-resizing-sidebar");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  return {
    handleSidebarResizeStart,
    sidebarContent,
    sidebarTabs,
  };
}
