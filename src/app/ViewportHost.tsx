import type { DisplayMode } from "../components/AssetViewport";
import { AssetViewport } from "../components/AssetViewport";
import type { ToolbarItem } from "../components/toolbar/types";
import { ViewportControls } from "../components/ViewportControls";
import type { DeferredTextureSnapshot } from "../types/viewer";
import type { FileState } from "../stores/fileStore";
import type { UiState } from "../stores/uiStore";
import type { ViewerState } from "../stores/viewerStore";

type ViewportHostProps = {
  deferredPayloadProgress: DeferredTextureSnapshot | null;
  disabledOptionalLoaderPackIds: readonly string[];
  incompatibleOptionalLoaderPackIds: readonly string[];
  displayMode: DisplayMode;
  file: FileState;
  handleOpenFile: () => Promise<void>;
  isDragActive: boolean;
  recordVariantSelectionError: (error: unknown) => boolean;
  sessionGlbBuffer: ArrayBuffer | null;
  ui: UiState;
  viewer: ViewerState;
  viewportToolbarItems: ToolbarItem[];
};

export function ViewportHost({
  deferredPayloadProgress,
  disabledOptionalLoaderPackIds,
  incompatibleOptionalLoaderPackIds,
  displayMode,
  file,
  handleOpenFile,
  isDragActive,
  recordVariantSelectionError,
  sessionGlbBuffer,
  ui,
  viewer,
  viewportToolbarItems,
}: ViewportHostProps) {
  return (
    <div className="viewer-panel">
      <AssetViewport
        currentFile={file.currentFile}
        disabledOptionalLoaderPackIds={disabledOptionalLoaderPackIds}
        incompatibleOptionalLoaderPackIds={incompatibleOptionalLoaderPackIds}
        mmdMotionRequest={file.mmdMotionRequest}
        displayMode={displayMode}
        backgroundPreset={viewer.backgroundPreset}
        onFeedbackChange={viewer.setViewerFeedback}
        onOpenFile={() => void handleOpenFile()}
        onMetadataChange={file.setAssetMetadata}
        onResourceDiagnosticsChange={viewer.setResourceDiagnostics}
        selectedTextureId={viewer.selectedTextureId}
        viewerSurfaceMode={viewer.viewerSurfaceMode}
        textureViewMode={viewer.textureViewMode}
        textureExposure={viewer.textureExposure}
        textureBlackPoint={viewer.textureBlackPoint}
        textureWhitePoint={viewer.textureWhitePoint}
        textureTileCount={viewer.textureTileCount}
        textureGamma={viewer.textureGamma}
        resetVersion={viewer.resetVersion}
        viewportShortcutCommand={viewer.viewportShortcutCommand}
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
        cameraPresetRequest={viewer.cameraPresetRequest}
        controlSensitivity={viewer.controlSensitivity}
        cameraFov={viewer.cameraFov}
        renderScale={viewer.renderScale}
        showShadows={viewer.showShadows}
        showUnlit={viewer.showUnlit}
        fxaaEnabled={viewer.fxaaEnabled}
        showRendererStats={viewer.showRendererStats}
        toneMappingMode={viewer.toneMappingMode}
        exposure={viewer.exposure}
        onGridUnitChange={viewer.setGridUnitLabel}
        onUsdError={recordVariantSelectionError}
        environmentPreset={viewer.environmentPreset}
        cameraSpeedMultiplier={viewer.cameraSpeedMultiplier}
        usdLoadPolicy={viewer.usdLoadPolicy}
        texturePreview3D={viewer.texturePreview3D}
        onSelectMesh={viewer.setSelectedMeshName}
        selectedMeshName={viewer.selectedMeshName}
        morphTargetValues={viewer.morphTargetValues}
        purposeModes={viewer.purposeModes}
        variantSelections={viewer.variantSelections}
        activeCameraId={viewer.activeCameraId}
        onActiveCameraReset={() => viewer.setActiveCameraId(null)}
        glbOverride={sessionGlbBuffer}
        deferredProgress={deferredPayloadProgress}
        onScaleNormalizationChange={viewer.setScaleNormalization}
        cancelScaleNormalizationVersion={viewer.cancelScaleNormalizeVersion}
      />

      <ViewportControls
        isOpen={ui.viewportPanelOpen}
        onToggleOpen={() => ui.setViewportPanelOpen(!ui.viewportPanelOpen)}
        items={viewportToolbarItems}
      />
      {/* InfoPanel toggle button */}
      <button
        className={`info-panel-toggle${ui.sidebarOpen ? " is-active" : ""}`}
        onClick={ui.toggleSidebarOpen}
        type="button"
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
      </button>

      {/* Texture mode banner */}
      {viewer.viewerSurfaceMode === "texture" ? (
        <button
          className="texture-mode-banner"
          onClick={() => viewer.setViewerSurfaceMode("asset")}
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
