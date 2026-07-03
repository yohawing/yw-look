import { useCallback } from "react";
import { useDebugPanelFixtures } from "../hooks/useDebugPanelFixtures";
import { useFileStore } from "../stores/fileStore";
import { useViewerStore } from "../stores/viewerStore";
import type { CameraEntry, LightEntry } from "../types/viewer";
import type { UsdLightInfo } from "../lib/usd";
import { SceneLightsCamerasCard } from "./SceneLightsCamerasCard";

type SceneLightsCamerasPanelProps = {
  debugPanelsEnabled?: boolean;
  usdLights?: UsdLightInfo[];
  usdLightsError?: string | null;
};

const EMPTY_LIGHTS: LightEntry[] = [];
const EMPTY_CAMERAS: CameraEntry[] = [];

export function SceneLightsCamerasPanel({
  debugPanelsEnabled = false,
  usdLights,
  usdLightsError,
}: SceneLightsCamerasPanelProps) {
  const storeAssetMetadata = useFileStore((state) => state.assetMetadata);
  const activeCameraId = useViewerStore((state) => state.activeCameraId);
  const { debugFixtures, useDebugFixtures } =
    useDebugPanelFixtures(debugPanelsEnabled);
  const assetMetadata = useDebugFixtures
    ? debugFixtures.debugPanelMetadata
    : storeAssetMetadata;
  const lights = assetMetadata?.lights ?? EMPTY_LIGHTS;
  const cameras = assetMetadata?.cameras ?? EMPTY_CAMERAS;

  const handleSelectCamera = useCallback((cameraId: string | null) => {
    useViewerStore.getState().setActiveCameraId(cameraId);
  }, []);

  return (
    <SceneLightsCamerasCard
      activeCameraId={activeCameraId}
      cameras={cameras}
      lights={lights}
      onSelectCamera={handleSelectCamera}
      usdLights={usdLights}
      usdLightsError={usdLightsError}
    />
  );
}
