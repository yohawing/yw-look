import { useCallback } from "react";
import { useViewerStore } from "../stores/viewerStore";
import type { CameraEntry, LightEntry } from "../types/viewer";
import type { UsdLightInfo } from "../lib/usd";
import { SceneLightsCamerasCard } from "./SceneLightsCamerasCard";

type SceneLightsCamerasPanelProps = {
  lights: LightEntry[];
  cameras: CameraEntry[];
  usdLights?: UsdLightInfo[];
  usdLightsError?: string | null;
};

export function SceneLightsCamerasPanel({
  lights,
  cameras,
  usdLights,
  usdLightsError,
}: SceneLightsCamerasPanelProps) {
  const activeCameraId = useViewerStore((state) => state.activeCameraId);

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
