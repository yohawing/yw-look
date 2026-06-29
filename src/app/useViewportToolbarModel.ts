import { useCallback, useMemo } from "react";
import {
  type CameraPreset,
  type DisplayMode,
  type EnvironmentPreset,
  type TextureViewMode,
} from "../components/AssetViewport";
import { build3DToolbar } from "../components/toolbar/build3DToolbar";
import {
  buildImageToolbar,
  type TextureColorSpace,
} from "../components/toolbar/buildImageToolbar";
import type { ToolbarItem } from "../components/toolbar/types";
import { useViewerStore, type ViewerState } from "../stores/viewerStore";

function deriveDisplayMode(
  showTexture: boolean,
  showWireframe: boolean,
): DisplayMode {
  if (showTexture && showWireframe) return "texturedWireframe";
  if (showTexture) return "textured";
  if (showWireframe) return "wireframe";
  return "untextured";
}

const environmentPresets: Array<{
  id: EnvironmentPreset;
  label: string;
}> = [
  { id: "studio", label: "Studio" },
  { id: "neutral", label: "Neutral" },
  { id: "outdoor", label: "Outdoor" },
];

const cameraPresetOptions: Array<{
  id: CameraPreset;
  label: string;
}> = [
  { id: "front", label: "Front" },
  { id: "back", label: "Back" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
];

export function useViewportToolbarModel(viewer: ViewerState) {
  const displayMode = useMemo(
    () => deriveDisplayMode(viewer.showTexture, viewer.showWireframe),
    [viewer.showTexture, viewer.showWireframe],
  );

  const handleSelectCameraPreset = useCallback((preset: string) => {
    const prev = useViewerStore.getState().cameraPresetRequest;
    useViewerStore.getState().setCameraPresetRequest({
      preset: preset as CameraPreset,
      version: (prev?.version ?? 0) + 1,
    });
  }, []);

  const handleSelectEnvironmentPreset = useCallback(
    (preset: string) => {
      viewer.setEnvironmentPreset(preset as EnvironmentPreset);
    },
    [viewer],
  );

  // Image mode handlers
  const channelOptions = useMemo(
    () => [
      { id: "rgb", label: "RGB" },
      { id: "r", label: "R" },
      { id: "g", label: "G" },
      { id: "b", label: "B" },
      { id: "a", label: "A" },
    ],
    [],
  );

  const handleSelectChannel = useCallback(
    (mode: string) => {
      if (mode === "a") {
        viewer.setTextureViewMode("alpha");
      } else {
        viewer.setTextureViewMode(mode as TextureViewMode);
      }
    },
    [viewer],
  );

  const handleSelectColorSpace = useCallback(
    (mode: TextureColorSpace) => {
      viewer.setTextureColorSpace(mode);
      switch (mode) {
        case "srgb":
          viewer.setTextureGamma(2.2);
          break;
        case "linear":
          viewer.setTextureGamma(1.0);
          break;
        case "raw":
          viewer.setTextureGamma(1.0);
          break;
      }
    },
    [viewer],
  );

  const viewportToolbarItems = useMemo<ToolbarItem[]>(() => {
    if (viewer.viewerSurfaceMode === "texture") {
      return buildImageToolbar({
        channelMode: viewer.textureViewMode,
        channelOptions,
        onSelectChannel: handleSelectChannel,
        colorSpace: viewer.textureColorSpace,
        onSelectColorSpace: handleSelectColorSpace,
        exposure: viewer.textureExposure,
        bgMode: "checker",
        tilingMode: "clamp",
        tileCount: viewer.textureTileCount,
      });
    }

    return build3DToolbar({
      // Camera
      cameraPreset: viewer.cameraPresetRequest?.preset ?? null,
      cameraPresetOptions,
      onSelectCameraPreset: handleSelectCameraPreset,
      // Shading
      showTexture: viewer.showTexture,
      onToggleTexture: () => useViewerStore.getState().toggleShowTexture(),
      showUnlit: viewer.showUnlit,
      onToggleUnlit: () => useViewerStore.getState().toggleShowUnlit(),
      showNormals: viewer.showNormals,
      onToggleNormals: () => useViewerStore.getState().toggleShowNormals(),
      showVertexColors: viewer.showVertexColors,
      onToggleVertexColors: () =>
        useViewerStore.getState().toggleShowVertexColors(),
      // Wireframe
      showWireframe: viewer.showWireframe,
      onToggleWireframe: () => useViewerStore.getState().toggleShowWireframe(),
      // Look
      environmentPreset: viewer.environmentPreset,
      environmentPresetOptions: environmentPresets,
      onSelectEnvironmentPreset: handleSelectEnvironmentPreset,
      showShadows: viewer.showShadows,
      onToggleShadows: () => useViewerStore.getState().toggleShowShadows(),
      showEnvironmentBackground: viewer.showEnvironmentBackground,
      onToggleEnvironmentBackground: () =>
        useViewerStore.getState().toggleShowEnvironmentBackground(),
      // Overlay
      showBoundingBoxes: viewer.showBoundingBoxes,
      onToggleBoundingBoxes: () =>
        useViewerStore.getState().toggleShowBoundingBoxes(),
      showSkeleton: viewer.showSkeleton,
      onToggleSkeleton: () => useViewerStore.getState().toggleShowSkeleton(),
      showLocalAxis: viewer.showLocalAxis,
      onToggleLocalAxis: () => useViewerStore.getState().toggleShowLocalAxis(),
      showJointNames: viewer.showJointNames,
      onToggleJointNames: () =>
        useViewerStore.getState().toggleShowJointNames(),
    });
  }, [
    channelOptions,
    handleSelectCameraPreset,
    handleSelectChannel,
    handleSelectColorSpace,
    handleSelectEnvironmentPreset,
    viewer,
  ]);

  return {
    displayMode,
    viewportToolbarItems,
  };
}
