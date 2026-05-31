import {
  ACESFilmicToneMapping,
  NoToneMapping,
  SRGBColorSpace,
  type WebGLRenderer,
} from "three";

import type { PreviewRenderingPreset } from "../types/viewer";

export type { PreviewRenderingPreset } from "../types/viewer";

export const DEFAULT_PREVIEW_RENDERING_PRESET: PreviewRenderingPreset = {
  logarithmicDepthBuffer: false,
  outputColorSpace: SRGBColorSpace,
  toneMapping: ACESFilmicToneMapping,
  toneMappingExposure: 1.1,
};

export const MMD_PREVIEW_RENDERING_PRESET: PreviewRenderingPreset = {
  logarithmicDepthBuffer: true,
  outputColorSpace: SRGBColorSpace,
  toneMapping: NoToneMapping,
  toneMappingExposure: 1,
};

export function isMmdPreviewExtension(extension: string | undefined) {
  return extension === "pmx" || extension === "pmd";
}

export function getPreviewRenderingPresetForExtension(
  extension: string | undefined,
) {
  return isMmdPreviewExtension(extension)
    ? MMD_PREVIEW_RENDERING_PRESET
    : DEFAULT_PREVIEW_RENDERING_PRESET;
}

export function applyPreviewRenderingPreset(
  renderer: WebGLRenderer,
  preset: PreviewRenderingPreset,
) {
  renderer.outputColorSpace = preset.outputColorSpace;
  renderer.toneMapping = preset.toneMapping;
  renderer.toneMappingExposure = preset.toneMappingExposure;
}
