export type {
  ViewerFeedback,
  ViewerMode,
  DisplayMode,
  ViewerSurfaceMode,
  TextureViewMode,
  SceneContext,
  LoadedPreview,
  MissingReferenceError,
} from "./types";

export { implementedPreviewExtensions, neutralFeedback } from "./types";

export {
  DEFAULT_SCENE_DIMENSION,
  revokeUrls,
  disposeObject,
  disposePreviewObject,
  stopAnimations,
  resetSceneObjects,
  applyInitialView,
  getObjectMaxDimension,
  normalizeObjectScale,
  applyDynamicGrid,
  applyDynamicAxes,
  applyTextureView,
  getScaleWarning,
  applyDisplayMode,
} from "./scene";
export type { GridConfig, ScaleNormalizationResult } from "./scene";

export { loadPreviewObject } from "./loaders";

export {
  collectAssetMetadata,
  buildMissingReferenceMetadata,
} from "./metadata";
export type { MetadataCollection } from "./metadata";

export { createTextureViewerObject } from "./texture";

export {
  getClipLabel,
  activateClip,
  setActionPlayback,
  seekAction,
  stepAction,
} from "./animationController";

export { getCachedBuffer, evictAll, prefetchAdjacent } from "./prefetchCache";
