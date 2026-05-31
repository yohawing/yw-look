import type { AmbientLight, DirectionalLight } from "three";

import type { PreviewLightingPreset } from "../types/viewer";

export type { PreviewLightingPreset } from "../types/viewer";

export const DEFAULT_LIGHTING_PRESET: PreviewLightingPreset = {
  ambientIntensity: 1.8,
  keyIntensity: 2.4,
  keyPosition: [6, 8, 5],
  fillIntensity: 1.2,
};

export const MMD_EXAMPLE_LIGHTING_PRESET: PreviewLightingPreset = {
  ambientIntensity: 0.15,
  keyIntensity: 1.0,
  keyPosition: [3, 4, 5],
  fillIntensity: 0,
};

export function applyPreviewLightingPreset(
  preset: PreviewLightingPreset,
  lights: {
    ambient: AmbientLight | null;
    key: DirectionalLight | null;
    fill: DirectionalLight | null;
  },
) {
  if (lights.ambient) {
    lights.ambient.intensity = preset.ambientIntensity;
  }
  if (lights.key) {
    lights.key.intensity = preset.keyIntensity;
    lights.key.position.set(...preset.keyPosition);
  }
  if (lights.fill) {
    lights.fill.intensity = preset.fillIntensity;
  }
}
