import {
  ACESFilmicToneMapping,
  Color,
  LinearToneMapping,
  ReinhardToneMapping,
  Scene,
  Texture,
  type ToneMapping,
  WebGLRenderer,
} from "three";
import type { SelectedFile } from "../lib/files";
import type { BackgroundPreset, ToneMappingMode } from "../types/viewer";
import {
  DEFAULT_PREVIEW_RENDERING_PRESET,
  applyPreviewRenderingPreset,
  getPreviewRenderingPresetForExtension,
} from "../viewer";

const backgroundPresetColors: Record<BackgroundPreset, string> = {
  gray: "#717781",
  charcoal: "#0f1011",
  light: "#d9dee7",
};

export const toneMappingModeMap: Record<ToneMappingMode, ToneMapping> = {
  linear: LinearToneMapping,
  aces: ACESFilmicToneMapping,
  reinhard: ReinhardToneMapping,
};

export function applyViewportRenderingSettings(
  renderer: WebGLRenderer,
  extension: string | undefined,
  toneMappingMode: ToneMappingMode,
  exposure: number,
) {
  const preset = getPreviewRenderingPresetForExtension(extension);
  if (preset === DEFAULT_PREVIEW_RENDERING_PRESET) {
    renderer.outputColorSpace = preset.outputColorSpace;
    renderer.toneMapping = toneMappingModeMap[toneMappingMode];
    renderer.toneMappingExposure = exposure;
    return;
  }

  applyPreviewRenderingPreset(renderer, preset);
}

export function runCleanupCallbacks(callbacks: Array<() => void>) {
  for (const cleanup of callbacks) {
    cleanup();
  }
}

export function applyViewportBackground(
  renderer: WebGLRenderer,
  scene: Scene,
  backgroundPreset: BackgroundPreset,
  environmentTexture: Texture | null,
) {
  const color = backgroundPresetColors[backgroundPreset];
  // setClearColor still matters: it is used when the scene has no
  // background (rare) and when a frame is rendered without clearing
  // the environment texture (e.g. during resize before relayout).
  renderer.setClearColor(color);
  scene.background = environmentTexture ?? new Color(color);
}

export function shouldFlipTexturePreviewY(
  texture: Texture,
  file: SelectedFile | null,
): boolean {
  return (
    (file?.extension === "pmx" || file?.extension === "pmd") &&
    texture.flipY === false
  );
}
