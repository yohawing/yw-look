import { useShallow } from "zustand/react/shallow";
import { useViewerStore, type ViewerState } from "../stores/viewerStore";
import { isUsdFile, type SelectedFile } from "../lib/files";
import type { AssetMetadata } from "../types/viewer";

export function resolveViewportMaterialNavigation(
  currentFile: SelectedFile | null,
  assetMetadata: AssetMetadata | null,
  selectionKey: string | null,
): string | null {
  if (!selectionKey || !isUsdFile(currentFile)) return null;

  const materialIds = assetMetadata?.objectInfo[selectionKey]?.materialIds;
  if (materialIds?.length !== 1) return null;

  const material = assetMetadata?.materials.find(
    (candidate) => candidate.id === materialIds[0],
  );
  return material?.usdPrimPath !== null && material?.usdPrimPath !== undefined
    ? material.id
    : null;
}

type ViewportHostViewerState = Pick<
  ViewerState,
  | "ambientOcclusionEnabled"
  | "activeCameraId"
  | "backgroundPreset"
  | "backfaceCulling"
  | "cameraFov"
  | "cameraSpeedMultiplier"
  | "controlSensitivity"
  | "environmentPreset"
  | "environmentRotation"
  | "exposure"
  | "fxaaEnabled"
  | "morphTargetValues"
  | "purposeModes"
  | "renderScale"
  | "selectedMeshName"
  | "selectedTextureId"
  | "showAxes"
  | "showBoundingBoxes"
  | "showEnvironmentBackground"
  | "showGrid"
  | "showJointNames"
  | "showLocalAxis"
  | "showNormals"
  | "showRendererStats"
  | "showShadows"
  | "showSkeleton"
  | "showUnlit"
  | "showVertexColors"
  | "textureBlackPoint"
  | "textureExposure"
  | "textureFilterMode"
  | "textureGamma"
  | "texturePreview3D"
  | "textureTileCount"
  | "textureViewMode"
  | "textureWhitePoint"
  | "toneMappingMode"
  | "usdLoadPolicy"
  | "variantSelections"
  | "viewerSurfaceMode"
>;

type ViewportHostViewerActions = Pick<
  ViewerState,
  | "setActiveCameraId"
  | "setGridUnitLabel"
  | "setResourceDiagnostics"
  | "requestMaterialNavigation"
  | "setScaleNormalization"
  | "setSelectedMeshName"
  | "setViewerFeedback"
  | "setViewerSurfaceMode"
> & {
  resetActiveCamera: () => void;
};

const viewportHostViewerActions = {
  setActiveCameraId: (value) =>
    useViewerStore.getState().setActiveCameraId(value),
  setGridUnitLabel: (value) =>
    useViewerStore.getState().setGridUnitLabel(value),
  setResourceDiagnostics: (value) =>
    useViewerStore.getState().setResourceDiagnostics(value),
  requestMaterialNavigation: (materialId) =>
    useViewerStore.getState().requestMaterialNavigation(materialId),
  setScaleNormalization: (value) =>
    useViewerStore.getState().setScaleNormalization(value),
  setSelectedMeshName: (value) =>
    useViewerStore.getState().setSelectedMeshName(value),
  setViewerFeedback: (value) =>
    useViewerStore.getState().setViewerFeedback(value),
  setViewerSurfaceMode: (value) =>
    useViewerStore.getState().setViewerSurfaceMode(value),
  resetActiveCamera: () => useViewerStore.getState().setActiveCameraId(null),
} satisfies ViewportHostViewerActions;

export function useViewportHostViewerModel() {
  const state = useViewerStore(
    useShallow((state): ViewportHostViewerState => ({
      ambientOcclusionEnabled: state.ambientOcclusionEnabled,
      activeCameraId: state.activeCameraId,
      backgroundPreset: state.backgroundPreset,
      backfaceCulling: state.backfaceCulling,
      cameraFov: state.cameraFov,
      cameraSpeedMultiplier: state.cameraSpeedMultiplier,
      controlSensitivity: state.controlSensitivity,
      environmentPreset: state.environmentPreset,
      environmentRotation: state.environmentRotation,
      exposure: state.exposure,
      fxaaEnabled: state.fxaaEnabled,
      morphTargetValues: state.morphTargetValues,
      purposeModes: state.purposeModes,
      renderScale: state.renderScale,
      selectedMeshName: state.selectedMeshName,
      selectedTextureId: state.selectedTextureId,
      showAxes: state.showAxes,
      showBoundingBoxes: state.showBoundingBoxes,
      showEnvironmentBackground: state.showEnvironmentBackground,
      showGrid: state.showGrid,
      showJointNames: state.showJointNames,
      showLocalAxis: state.showLocalAxis,
      showNormals: state.showNormals,
      showRendererStats: state.showRendererStats,
      showShadows: state.showShadows,
      showSkeleton: state.showSkeleton,
      showUnlit: state.showUnlit,
      showVertexColors: state.showVertexColors,
      textureBlackPoint: state.textureBlackPoint,
      textureExposure: state.textureExposure,
      textureFilterMode: state.textureFilterMode,
      textureGamma: state.textureGamma,
      texturePreview3D: state.texturePreview3D,
      textureTileCount: state.textureTileCount,
      textureViewMode: state.textureViewMode,
      textureWhitePoint: state.textureWhitePoint,
      toneMappingMode: state.toneMappingMode,
      usdLoadPolicy: state.usdLoadPolicy,
      variantSelections: state.variantSelections,
      viewerSurfaceMode: state.viewerSurfaceMode,
    })),
  );

  return {
    ...state,
    actions: viewportHostViewerActions,
  };
}
