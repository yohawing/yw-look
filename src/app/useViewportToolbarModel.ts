import { useCallback, useMemo, useState } from "react";
import {
  type CameraPreset,
  type EnvironmentPreset,
  type TextureViewMode,
} from "../types/viewer";
import { deriveViewportDisplayState } from "./displayMode";
import { build3DToolbar } from "../components/toolbar/build3DToolbar";
import {
  buildImageToolbar,
  type TextureColorSpace,
} from "../components/toolbar/buildImageToolbar";
import type { ToolbarItem } from "../components/toolbar/types";
import { useViewerStore } from "../stores/viewerStore";
import { requestViewportCameraPreset } from "../viewport/viewportCommands";

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

export function useViewportToolbarModel() {
  const [activeCameraPreset, setActiveCameraPreset] =
    useState<CameraPreset | null>(null);
  const viewerSurfaceMode = useViewerStore((state) => state.viewerSurfaceMode);
  const textureViewMode = useViewerStore((state) => state.textureViewMode);
  const textureColorSpace = useViewerStore((state) => state.textureColorSpace);
  const textureExposure = useViewerStore((state) => state.textureExposure);
  const textureTileCount = useViewerStore((state) => state.textureTileCount);
  const showTexture = useViewerStore((state) => state.showTexture);
  const showUnlit = useViewerStore((state) => state.showUnlit);
  const showNormals = useViewerStore((state) => state.showNormals);
  const showVertexColors = useViewerStore((state) => state.showVertexColors);
  const showWireframe = useViewerStore((state) => state.showWireframe);
  const environmentPreset = useViewerStore((state) => state.environmentPreset);
  const showShadows = useViewerStore((state) => state.showShadows);
  const showEnvironmentBackground = useViewerStore(
    (state) => state.showEnvironmentBackground,
  );
  const showBoundingBoxes = useViewerStore((state) => state.showBoundingBoxes);
  const showSkeleton = useViewerStore((state) => state.showSkeleton);
  const showLocalAxis = useViewerStore((state) => state.showLocalAxis);
  const showJointNames = useViewerStore((state) => state.showJointNames);

  const displayState = useMemo(
    () =>
      deriveViewportDisplayState({
        showTexture,
        showWireframe,
        showUnlit,
        showNormals,
        showVertexColors,
      }),
    [showNormals, showTexture, showUnlit, showVertexColors, showWireframe],
  );

  const handleSelectCameraPreset = useCallback((preset: string) => {
    const typedPreset = preset as CameraPreset;
    if (requestViewportCameraPreset(typedPreset)) {
      setActiveCameraPreset(typedPreset);
    }
  }, []);

  const handleSelectEnvironmentPreset = useCallback((preset: string) => {
    useViewerStore.getState().setEnvironmentPreset(preset as EnvironmentPreset);
  }, []);

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

  const handleSelectChannel = useCallback((mode: string) => {
    if (mode === "a") {
      useViewerStore.getState().setTextureViewMode("alpha");
    } else {
      useViewerStore.getState().setTextureViewMode(mode as TextureViewMode);
    }
  }, []);

  const handleSelectColorSpace = useCallback((mode: TextureColorSpace) => {
    const { setTextureColorSpace, setTextureGamma } = useViewerStore.getState();
    setTextureColorSpace(mode);
    switch (mode) {
      case "srgb":
        setTextureGamma(2.2);
        break;
      case "linear":
        setTextureGamma(1.0);
        break;
      case "raw":
        setTextureGamma(1.0);
        break;
    }
  }, []);

  const viewportToolbarItems = useMemo<ToolbarItem[]>(() => {
    if (viewerSurfaceMode === "texture") {
      return buildImageToolbar({
        channelMode: textureViewMode,
        channelOptions,
        onSelectChannel: handleSelectChannel,
        colorSpace: textureColorSpace,
        onSelectColorSpace: handleSelectColorSpace,
        exposure: textureExposure,
        bgMode: "checker",
        tilingMode: "clamp",
        tileCount: textureTileCount,
      });
    }

    return build3DToolbar({
      // Camera
      cameraPreset: activeCameraPreset,
      cameraPresetOptions,
      onSelectCameraPreset: handleSelectCameraPreset,
      // Shading
      showTexture: showTexture,
      onToggleTexture: () => useViewerStore.getState().toggleShowTexture(),
      showUnlit: showUnlit,
      onToggleUnlit: () => useViewerStore.getState().toggleShowUnlit(),
      showNormals: showNormals,
      onToggleNormals: () => useViewerStore.getState().toggleShowNormals(),
      showVertexColors: showVertexColors,
      onToggleVertexColors: () =>
        useViewerStore.getState().toggleShowVertexColors(),
      // Wireframe
      showWireframe: showWireframe,
      onToggleWireframe: () => useViewerStore.getState().toggleShowWireframe(),
      // Look
      environmentPreset: environmentPreset,
      environmentPresetOptions: environmentPresets,
      onSelectEnvironmentPreset: handleSelectEnvironmentPreset,
      showShadows: showShadows,
      onToggleShadows: () => useViewerStore.getState().toggleShowShadows(),
      showEnvironmentBackground: showEnvironmentBackground,
      onToggleEnvironmentBackground: () =>
        useViewerStore.getState().toggleShowEnvironmentBackground(),
      // Overlay
      showBoundingBoxes: showBoundingBoxes,
      onToggleBoundingBoxes: () =>
        useViewerStore.getState().toggleShowBoundingBoxes(),
      showSkeleton: showSkeleton,
      onToggleSkeleton: () => useViewerStore.getState().toggleShowSkeleton(),
      showLocalAxis: showLocalAxis,
      onToggleLocalAxis: () => useViewerStore.getState().toggleShowLocalAxis(),
      showJointNames: showJointNames,
      onToggleJointNames: () =>
        useViewerStore.getState().toggleShowJointNames(),
    });
  }, [
    channelOptions,
    handleSelectCameraPreset,
    handleSelectChannel,
    handleSelectColorSpace,
    handleSelectEnvironmentPreset,
    activeCameraPreset,
    environmentPreset,
    showBoundingBoxes,
    showEnvironmentBackground,
    showJointNames,
    showLocalAxis,
    showNormals,
    showShadows,
    showSkeleton,
    showTexture,
    showUnlit,
    showVertexColors,
    showWireframe,
    textureColorSpace,
    textureExposure,
    textureTileCount,
    textureViewMode,
    viewerSurfaceMode,
  ]);

  return {
    displayMode: displayState.displayMode,
    viewportToolbarItems,
  };
}
