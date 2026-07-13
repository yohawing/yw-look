import { create } from "zustand";
import type {
  BackgroundPreset,
  EnvironmentPreset,
  TextureFilterMode,
  TextureViewMode,
  TextureColorSpace,
  ToneMappingMode,
  ViewerFeedback,
  ViewerSurfaceMode,
} from "../types/viewer";
import type { ResourceDiagnosticsSnapshot } from "../lib/diagnostics";
import type {
  PurposeModes,
  StageLoadPolicy,
  VariantSelection,
} from "../lib/usd";

export interface ViewerState {
  showTexture: boolean;
  showWireframe: boolean;
  showUnlit: boolean;
  showGrid: boolean;
  showAxes: boolean;
  showSkeleton: boolean;
  showLocalAxis: boolean;
  showJointNames: boolean;
  showBoundingBoxes: boolean;
  showNormals: boolean;
  showVertexColors: boolean;
  showEnvironmentBackground: boolean;
  environmentRotation: number;
  backfaceCulling: boolean;
  textureFilterMode: TextureFilterMode;
  controlSensitivity: number;
  cameraFov: number;
  renderScale: number;
  showShadows: boolean;
  fxaaEnabled: boolean;
  showRendererStats: boolean;
  toneMappingMode: ToneMappingMode;
  exposure: number;
  cameraSpeedMultiplier: number;
  backgroundPreset: BackgroundPreset;
  environmentPreset: EnvironmentPreset;
  gridUnitLabel: string;
  viewerFeedback: ViewerFeedback;
  viewerSurfaceMode: ViewerSurfaceMode;
  selectedTextureId: string | null;
  textureViewMode: TextureViewMode;
  textureColorSpace: TextureColorSpace;
  textureExposure: number;
  textureBlackPoint: number;
  textureWhitePoint: number;
  textureTileCount: number;
  textureGamma: number;
  texturePreview3D: boolean;
  resourceDiagnostics: ResourceDiagnosticsSnapshot | null;
  usdLoadPolicy: StageLoadPolicy;
  selectedMeshName: string | null;
  morphTargetValues: Record<string, Record<number, number>>;
  selectedUsdPrimPath: string | null;
  purposeModes: PurposeModes;
  activeCameraId: string | null;
  variantSelections: VariantSelection[];
  variantSelectionError: string | null;
  scaleNormalization: { applied: boolean; factor: number } | null;

  setShowTexture: (v: boolean) => void;
  setShowWireframe: (v: boolean) => void;
  setShowUnlit: (v: boolean) => void;
  setShowGrid: (v: boolean) => void;
  setShowAxes: (v: boolean) => void;
  setShowSkeleton: (v: boolean) => void;
  setShowLocalAxis: (v: boolean) => void;
  setShowJointNames: (v: boolean) => void;
  setShowBoundingBoxes: (v: boolean) => void;
  setShowNormals: (v: boolean) => void;
  setShowVertexColors: (v: boolean) => void;
  setShowEnvironmentBackground: (v: boolean) => void;
  setShowShadows: (v: boolean) => void;
  setEnvironmentPreset: (v: EnvironmentPreset) => void;
  setBackgroundPreset: (v: BackgroundPreset) => void;
  setGridUnitLabel: (v: string) => void;
  setViewerFeedback: (v: ViewerFeedback) => void;
  setViewerSurfaceMode: (v: ViewerSurfaceMode) => void;
  setSelectedTextureId: (v: string | null) => void;
  setTextureViewMode: (v: TextureViewMode) => void;
  setTextureColorSpace: (v: TextureColorSpace) => void;
  setTextureGamma: (v: number) => void;
  setResourceDiagnostics: (v: ResourceDiagnosticsSnapshot | null) => void;
  setUsdLoadPolicy: (v: StageLoadPolicy) => void;
  setSelectedMeshName: (v: string | null) => void;
  setMorphTargetValues: (v: Record<string, Record<number, number>>) => void;
  setSelectedUsdPrimPath: (v: string | null) => void;
  setPurposeModes: (v: PurposeModes) => void;
  setActiveCameraId: (v: string | null) => void;
  setVariantSelections: (v: VariantSelection[]) => void;
  setVariantSelectionError: (v: string | null) => void;
  setScaleNormalization: (
    v: { applied: boolean; factor: number } | null,
  ) => void;

  toggleShowTexture: () => void;
  toggleShowWireframe: () => void;
  toggleShowGrid: () => void;
  toggleShowUnlit: () => void;
  toggleShowNormals: () => void;
  toggleShowVertexColors: () => void;
  toggleShowShadows: () => void;
  toggleShowEnvironmentBackground: () => void;
  toggleShowBoundingBoxes: () => void;
  toggleShowSkeleton: () => void;
  toggleShowLocalAxis: () => void;
  toggleShowJointNames: () => void;
  updateViewerFeedback: (partial: Partial<ViewerFeedback>) => void;
}

export const useViewerStore = create<ViewerState>((set) => ({
  showTexture: true,
  showWireframe: false,
  showUnlit: false,
  showGrid: true,
  showAxes: false,
  showSkeleton: false,
  showLocalAxis: true,
  showJointNames: false,
  showBoundingBoxes: false,
  showNormals: false,
  showVertexColors: false,
  showEnvironmentBackground: false,
  environmentRotation: 0,
  backfaceCulling: true,
  textureFilterMode: "trilinear",
  controlSensitivity: 1,
  cameraFov: 45,
  renderScale: 1,
  showShadows: false,
  fxaaEnabled: false,
  showRendererStats: false,
  toneMappingMode: "aces",
  exposure: 1.1,
  cameraSpeedMultiplier: 1,
  backgroundPreset: "gray",
  environmentPreset: "studio",
  gridUnitLabel: "1 m",
  viewerFeedback: {
    mode: "empty",
    message: "Open a supported asset to initialize the preview scene.",
    warning: null,
    canResetCamera: false,
  },
  viewerSurfaceMode: "asset",
  selectedTextureId: null,
  textureViewMode: "rgba",
  textureColorSpace: "srgb",
  textureExposure: 0,
  textureBlackPoint: 0,
  textureWhitePoint: 1,
  textureTileCount: 1,
  textureGamma: 2.2,
  texturePreview3D: false,
  resourceDiagnostics: null,
  // Model inspection should display complete geometry by default. Deferred
  // loading remains opt-in and upgrades its lightweight stage to a full
  // payload preview asynchronously.
  usdLoadPolicy: "loadAll",
  selectedMeshName: null,
  morphTargetValues: {},
  selectedUsdPrimPath: null,
  purposeModes: { render: true, proxy: false, guide: false },
  activeCameraId: null,
  variantSelections: [],
  variantSelectionError: null,
  scaleNormalization: null,

  setShowTexture: (showTexture) => set({ showTexture }),
  setShowWireframe: (showWireframe) => set({ showWireframe }),
  setShowUnlit: (showUnlit) => set({ showUnlit }),
  setShowGrid: (showGrid) => set({ showGrid }),
  setShowAxes: (showAxes) => set({ showAxes }),
  setShowSkeleton: (showSkeleton) => set({ showSkeleton }),
  setShowLocalAxis: (showLocalAxis) => set({ showLocalAxis }),
  setShowJointNames: (showJointNames) => set({ showJointNames }),
  setShowBoundingBoxes: (showBoundingBoxes) => set({ showBoundingBoxes }),
  setShowNormals: (showNormals) => set({ showNormals }),
  setShowVertexColors: (showVertexColors) => set({ showVertexColors }),
  setShowEnvironmentBackground: (showEnvironmentBackground) =>
    set({ showEnvironmentBackground }),
  setShowShadows: (showShadows) => set({ showShadows }),
  setEnvironmentPreset: (environmentPreset) => set({ environmentPreset }),
  setBackgroundPreset: (backgroundPreset) => set({ backgroundPreset }),
  setGridUnitLabel: (gridUnitLabel) => set({ gridUnitLabel }),
  setViewerFeedback: (viewerFeedback) => set({ viewerFeedback }),
  setViewerSurfaceMode: (viewerSurfaceMode) => set({ viewerSurfaceMode }),
  setSelectedTextureId: (selectedTextureId) => set({ selectedTextureId }),
  setTextureViewMode: (textureViewMode) => set({ textureViewMode }),
  setTextureColorSpace: (textureColorSpace) => set({ textureColorSpace }),
  setTextureGamma: (textureGamma) => set({ textureGamma }),
  setResourceDiagnostics: (resourceDiagnostics) => set({ resourceDiagnostics }),
  setUsdLoadPolicy: (usdLoadPolicy) => set({ usdLoadPolicy }),
  setSelectedMeshName: (selectedMeshName) => set({ selectedMeshName }),
  setMorphTargetValues: (morphTargetValues) => set({ morphTargetValues }),
  setSelectedUsdPrimPath: (selectedUsdPrimPath) => set({ selectedUsdPrimPath }),
  setPurposeModes: (purposeModes) => set({ purposeModes }),
  setActiveCameraId: (activeCameraId) => set({ activeCameraId }),
  setVariantSelections: (variantSelections) => set({ variantSelections }),
  setVariantSelectionError: (variantSelectionError) =>
    set({ variantSelectionError }),
  setScaleNormalization: (scaleNormalization) => set({ scaleNormalization }),

  toggleShowTexture: () => set((s) => ({ showTexture: !s.showTexture })),
  toggleShowWireframe: () => set((s) => ({ showWireframe: !s.showWireframe })),
  toggleShowGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleShowUnlit: () => set((s) => ({ showUnlit: !s.showUnlit })),
  toggleShowNormals: () => set((s) => ({ showNormals: !s.showNormals })),
  toggleShowVertexColors: () =>
    set((s) => ({ showVertexColors: !s.showVertexColors })),
  toggleShowShadows: () => set((s) => ({ showShadows: !s.showShadows })),
  toggleShowEnvironmentBackground: () =>
    set((s) => ({
      showEnvironmentBackground: !s.showEnvironmentBackground,
    })),
  toggleShowBoundingBoxes: () =>
    set((s) => ({
      showBoundingBoxes: !s.showBoundingBoxes,
    })),
  toggleShowSkeleton: () => set((s) => ({ showSkeleton: !s.showSkeleton })),
  toggleShowLocalAxis: () => set((s) => ({ showLocalAxis: !s.showLocalAxis })),
  toggleShowJointNames: () =>
    set((s) => ({ showJointNames: !s.showJointNames })),
  updateViewerFeedback: (partial) =>
    set((s) => ({
      viewerFeedback: { ...s.viewerFeedback, ...partial },
    })),
}));
