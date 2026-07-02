import type { DisplayMode } from "../components/AssetViewport";
import { AssetViewport } from "../components/AssetViewport";
import { Button } from "../components/ui/Button";
import type { ToolbarItem } from "../components/toolbar/types";
import { ViewportControls } from "../components/ViewportControls";
import type { DeferredTextureSnapshot } from "../types/viewer";
import { useFileStore } from "../stores/fileStore";
import { useUiStore } from "../stores/uiStore";
import { useViewerStore } from "../stores/viewerStore";
import type { StageInspection } from "../lib/usd";
import "../styles/viewport.css";

type ViewportHostProps = {
  deferredPayloadProgress: DeferredTextureSnapshot | null;
  disabledOptionalLoaderPackIds: readonly string[];
  incompatibleOptionalLoaderPackIds: readonly string[];
  displayMode: DisplayMode;
  handleOpenFile: () => Promise<void>;
  isDragActive: boolean;
  recordVariantSelectionError: (error: unknown) => boolean;
  sessionGlbBuffer: ArrayBuffer | null;
  usdInspection: StageInspection | null;
  viewportToolbarItems: ToolbarItem[];
};

export function ViewportHost({
  deferredPayloadProgress,
  disabledOptionalLoaderPackIds,
  incompatibleOptionalLoaderPackIds,
  displayMode,
  handleOpenFile,
  isDragActive,
  recordVariantSelectionError,
  sessionGlbBuffer,
  usdInspection,
  viewportToolbarItems,
}: ViewportHostProps) {
  const currentFile = useFileStore((state) => state.currentFile);
  const mmdMotionRequest = useFileStore((state) => state.mmdMotionRequest);
  const setAssetMetadata = useFileStore((state) => state.setAssetMetadata);

  const viewportPanelOpen = useUiStore((state) => state.viewportPanelOpen);
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const setViewportPanelOpen = useUiStore(
    (state) => state.setViewportPanelOpen,
  );
  const toggleSidebarOpen = useUiStore((state) => state.toggleSidebarOpen);

  const backgroundPreset = useViewerStore((state) => state.backgroundPreset);
  const selectedTextureId = useViewerStore((state) => state.selectedTextureId);
  const viewerSurfaceMode = useViewerStore((state) => state.viewerSurfaceMode);
  const textureViewMode = useViewerStore((state) => state.textureViewMode);
  const textureExposure = useViewerStore((state) => state.textureExposure);
  const textureBlackPoint = useViewerStore((state) => state.textureBlackPoint);
  const textureWhitePoint = useViewerStore((state) => state.textureWhitePoint);
  const textureTileCount = useViewerStore((state) => state.textureTileCount);
  const textureGamma = useViewerStore((state) => state.textureGamma);
  const resetVersion = useViewerStore((state) => state.resetVersion);
  const viewportShortcutCommand = useViewerStore(
    (state) => state.viewportShortcutCommand,
  );
  const showGrid = useViewerStore((state) => state.showGrid);
  const showAxes = useViewerStore((state) => state.showAxes);
  const showSkeleton = useViewerStore((state) => state.showSkeleton);
  const showLocalAxis = useViewerStore((state) => state.showLocalAxis);
  const showJointNames = useViewerStore((state) => state.showJointNames);
  const showBoundingBoxes = useViewerStore((state) => state.showBoundingBoxes);
  const showNormals = useViewerStore((state) => state.showNormals);
  const showVertexColors = useViewerStore((state) => state.showVertexColors);
  const showEnvironmentBackground = useViewerStore(
    (state) => state.showEnvironmentBackground,
  );
  const environmentRotation = useViewerStore(
    (state) => state.environmentRotation,
  );
  const backfaceCulling = useViewerStore((state) => state.backfaceCulling);
  const textureFilterMode = useViewerStore((state) => state.textureFilterMode);
  const cameraPresetRequest = useViewerStore(
    (state) => state.cameraPresetRequest,
  );
  const controlSensitivity = useViewerStore(
    (state) => state.controlSensitivity,
  );
  const cameraFov = useViewerStore((state) => state.cameraFov);
  const renderScale = useViewerStore((state) => state.renderScale);
  const showShadows = useViewerStore((state) => state.showShadows);
  const showUnlit = useViewerStore((state) => state.showUnlit);
  const fxaaEnabled = useViewerStore((state) => state.fxaaEnabled);
  const showRendererStats = useViewerStore((state) => state.showRendererStats);
  const toneMappingMode = useViewerStore((state) => state.toneMappingMode);
  const exposure = useViewerStore((state) => state.exposure);
  const environmentPreset = useViewerStore((state) => state.environmentPreset);
  const cameraSpeedMultiplier = useViewerStore(
    (state) => state.cameraSpeedMultiplier,
  );
  const usdLoadPolicy = useViewerStore((state) => state.usdLoadPolicy);
  const texturePreview3D = useViewerStore((state) => state.texturePreview3D);
  const selectedMeshName = useViewerStore((state) => state.selectedMeshName);
  const morphTargetValues = useViewerStore((state) => state.morphTargetValues);
  const purposeModes = useViewerStore((state) => state.purposeModes);
  const variantSelections = useViewerStore((state) => state.variantSelections);
  const activeCameraId = useViewerStore((state) => state.activeCameraId);
  const cancelScaleNormalizeVersion = useViewerStore(
    (state) => state.cancelScaleNormalizeVersion,
  );
  const setViewerFeedback = useViewerStore((state) => state.setViewerFeedback);
  const setResourceDiagnostics = useViewerStore(
    (state) => state.setResourceDiagnostics,
  );
  const setGridUnitLabel = useViewerStore((state) => state.setGridUnitLabel);
  const setSelectedMeshName = useViewerStore(
    (state) => state.setSelectedMeshName,
  );
  const setActiveCameraId = useViewerStore((state) => state.setActiveCameraId);
  const setScaleNormalization = useViewerStore(
    (state) => state.setScaleNormalization,
  );
  const setViewerSurfaceMode = useViewerStore(
    (state) => state.setViewerSurfaceMode,
  );

  return (
    <div className="viewer-panel">
      <AssetViewport
        currentFile={currentFile}
        disabledOptionalLoaderPackIds={disabledOptionalLoaderPackIds}
        incompatibleOptionalLoaderPackIds={incompatibleOptionalLoaderPackIds}
        mmdMotionRequest={mmdMotionRequest}
        displayMode={displayMode}
        backgroundPreset={backgroundPreset}
        onFeedbackChange={setViewerFeedback}
        onOpenFile={() => void handleOpenFile()}
        onMetadataChange={setAssetMetadata}
        onResourceDiagnosticsChange={setResourceDiagnostics}
        selectedTextureId={selectedTextureId}
        viewerSurfaceMode={viewerSurfaceMode}
        textureViewMode={textureViewMode}
        textureExposure={textureExposure}
        textureBlackPoint={textureBlackPoint}
        textureWhitePoint={textureWhitePoint}
        textureTileCount={textureTileCount}
        textureGamma={textureGamma}
        resetVersion={resetVersion}
        viewportShortcutCommand={viewportShortcutCommand}
        showGrid={showGrid}
        showAxes={showAxes}
        showSkeleton={showSkeleton}
        showLocalAxis={showLocalAxis}
        showJointNames={showJointNames}
        showBoundingBoxes={showBoundingBoxes}
        showNormals={showNormals}
        showVertexColors={showVertexColors}
        showEnvironmentBackground={showEnvironmentBackground}
        environmentRotation={environmentRotation}
        backfaceCulling={backfaceCulling}
        textureFilterMode={textureFilterMode}
        cameraPresetRequest={cameraPresetRequest}
        controlSensitivity={controlSensitivity}
        cameraFov={cameraFov}
        renderScale={renderScale}
        showShadows={showShadows}
        showUnlit={showUnlit}
        fxaaEnabled={fxaaEnabled}
        showRendererStats={showRendererStats}
        toneMappingMode={toneMappingMode}
        exposure={exposure}
        onGridUnitChange={setGridUnitLabel}
        onUsdError={recordVariantSelectionError}
        environmentPreset={environmentPreset}
        cameraSpeedMultiplier={cameraSpeedMultiplier}
        usdLoadPolicy={usdLoadPolicy}
        usdInspection={usdInspection}
        texturePreview3D={texturePreview3D}
        onSelectMesh={setSelectedMeshName}
        selectedMeshName={selectedMeshName}
        morphTargetValues={morphTargetValues}
        purposeModes={purposeModes}
        variantSelections={variantSelections}
        activeCameraId={activeCameraId}
        onActiveCameraReset={() => setActiveCameraId(null)}
        glbOverride={sessionGlbBuffer}
        deferredProgress={deferredPayloadProgress}
        onScaleNormalizationChange={setScaleNormalization}
        cancelScaleNormalizationVersion={cancelScaleNormalizeVersion}
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
        <svg viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect
            x="2"
            y="2"
            width="14"
            height="14"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path d="M11 2v14" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M13.5 6h1M13.5 9h1M13.5 12h1"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </Button>

      {/* Texture mode banner */}
      {viewerSurfaceMode === "texture" ? (
        <button
          className="viewport-texture-mode-banner"
          onClick={() => setViewerSurfaceMode("asset")}
          type="button"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M8.5 2L4 7l4.5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
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
