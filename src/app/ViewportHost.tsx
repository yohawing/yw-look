import { ArrowLeftIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import { AssetViewport } from "../components/AssetViewport";
import { Button } from "../components/ui/Button";
import { ViewportControls } from "../components/ViewportControls";
import type { DeferredTextureSnapshot } from "../types/viewer";
import { useViewportHostViewerModel } from "./useViewportHostViewerModel";
import { useViewportToolbarModel } from "./useViewportToolbarModel";
import { useFileStore } from "../stores/fileStore";
import { useUiStore } from "../stores/uiStore";
import type { StageInspection } from "../lib/usd";
import "../styles/viewport.css";

type ViewportHostProps = {
  deferredPayloadProgress: DeferredTextureSnapshot | null;
  disabledOptionalLoaderPackIds: readonly string[];
  incompatibleOptionalLoaderPackIds: readonly string[];
  handleOpenFile: () => Promise<void>;
  isDragActive: boolean;
  recordVariantSelectionError: (error: unknown) => boolean;
  sessionGlbBuffer: ArrayBuffer | null;
  usdInspection: StageInspection | null;
};

export function ViewportHost({
  deferredPayloadProgress,
  disabledOptionalLoaderPackIds,
  incompatibleOptionalLoaderPackIds,
  handleOpenFile,
  isDragActive,
  recordVariantSelectionError,
  sessionGlbBuffer,
  usdInspection,
}: ViewportHostProps) {
  const { displayMode, viewportToolbarItems } = useViewportToolbarModel();
  const viewer = useViewportHostViewerModel();
  const viewerActions = viewer.actions;
  const currentFile = useFileStore((state) => state.currentFile);
  const packFileRequest = useFileStore((state) => state.packFileRequest);
  const setAssetMetadata = useFileStore((state) => state.setAssetMetadata);
  const setPackMetadata = useFileStore((state) => state.setPackMetadata);

  const viewportPanelOpen = useUiStore((state) => state.viewportPanelOpen);
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const setViewportPanelOpen = useUiStore(
    (state) => state.setViewportPanelOpen,
  );
  const toggleSidebarOpen = useUiStore((state) => state.toggleSidebarOpen);

  return (
    <div className="viewer-panel">
      <AssetViewport
        currentFile={currentFile}
        disabledOptionalLoaderPackIds={disabledOptionalLoaderPackIds}
        incompatibleOptionalLoaderPackIds={incompatibleOptionalLoaderPackIds}
        packFileRequest={packFileRequest}
        displayMode={displayMode}
        backgroundPreset={viewer.backgroundPreset}
        onFeedbackChange={viewerActions.setViewerFeedback}
        onOpenFile={() => void handleOpenFile()}
        onMetadataChange={setAssetMetadata}
        onPackMetadataChange={setPackMetadata}
        onResourceDiagnosticsChange={viewerActions.setResourceDiagnostics}
        selectedTextureId={viewer.selectedTextureId}
        viewerSurfaceMode={viewer.viewerSurfaceMode}
        textureViewMode={viewer.textureViewMode}
        textureExposure={viewer.textureExposure}
        textureBlackPoint={viewer.textureBlackPoint}
        textureWhitePoint={viewer.textureWhitePoint}
        textureTileCount={viewer.textureTileCount}
        textureGamma={viewer.textureGamma}
        showGrid={viewer.showGrid}
        showAxes={viewer.showAxes}
        showSkeleton={viewer.showSkeleton}
        showLocalAxis={viewer.showLocalAxis}
        showJointNames={viewer.showJointNames}
        showBoundingBoxes={viewer.showBoundingBoxes}
        showNormals={viewer.showNormals}
        showVertexColors={viewer.showVertexColors}
        showEnvironmentBackground={viewer.showEnvironmentBackground}
        environmentRotation={viewer.environmentRotation}
        backfaceCulling={viewer.backfaceCulling}
        textureFilterMode={viewer.textureFilterMode}
        controlSensitivity={viewer.controlSensitivity}
        cameraFov={viewer.cameraFov}
        renderScale={viewer.renderScale}
        showShadows={viewer.showShadows}
        showUnlit={viewer.showUnlit}
        fxaaEnabled={viewer.fxaaEnabled}
        showRendererStats={viewer.showRendererStats}
        toneMappingMode={viewer.toneMappingMode}
        exposure={viewer.exposure}
        onGridUnitChange={viewerActions.setGridUnitLabel}
        onUsdError={recordVariantSelectionError}
        environmentPreset={viewer.environmentPreset}
        cameraSpeedMultiplier={viewer.cameraSpeedMultiplier}
        usdLoadPolicy={viewer.usdLoadPolicy}
        usdInspection={usdInspection}
        texturePreview3D={viewer.texturePreview3D}
        onSelectMesh={viewerActions.setSelectedMeshName}
        selectedMeshName={viewer.selectedMeshName}
        morphTargetValues={viewer.morphTargetValues}
        purposeModes={viewer.purposeModes}
        variantSelections={viewer.variantSelections}
        activeCameraId={viewer.activeCameraId}
        onActiveCameraReset={viewerActions.resetActiveCamera}
        glbOverride={sessionGlbBuffer}
        deferredProgress={deferredPayloadProgress}
        onScaleNormalizationChange={viewerActions.setScaleNormalization}
      />

      <ViewportControls
        isOpen={viewportPanelOpen}
        onToggleOpen={() => setViewportPanelOpen(!viewportPanelOpen)}
        items={viewportToolbarItems}
      />
      {/* InfoPanel toggle button */}
      <Button
        aria-pressed={sidebarOpen}
        className="viewport-sidebar-toggle"
        iconOnly
        onClick={toggleSidebarOpen}
        size="md"
        variant={sidebarOpen ? "subtle" : "ghost"}
      >
        <InfoCircledIcon aria-hidden="true" />
      </Button>

      {/* Texture mode banner */}
      {viewer.viewerSurfaceMode === "texture" &&
      currentFile?.kind !== "texture" ? (
        <button
          className="viewport-texture-mode-banner"
          onClick={() => viewerActions.setViewerSurfaceMode("asset")}
          type="button"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Back to 3D View
        </button>
      ) : null}

      {/* Drop overlay */}
      {isDragActive ? (
        <div className="drop-overlay">
          <p>Drop file to open or attach motion</p>
        </div>
      ) : null}
    </div>
  );
}
