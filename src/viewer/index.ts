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
  applyPresetView,
  applyControlsSensitivity,
  computeAutoSensitivity,
  getObjectMaxDimension,
  normalizeObjectScale,
  applyDynamicGrid,
  applyDynamicAxes,
  applyTextureView,
  getScaleWarning,
  applyDisplayMode,
  applyBackfaceCulling,
  applyTextureFilter,
  applyVertexColors,
  applySkeletonHelpers,
  removeSkeletonHelpers,
  applyBoundingBoxHelpers,
  removeBoundingBoxHelpers,
  applyNormalHelpers,
  removeNormalHelpers,
  ensureShadowCatcher,
  applyShadows,
} from "./scene";
export type {
  CameraPreset,
  GridConfig,
  ScaleNormalizationResult,
  TextureFilterMode,
} from "./scene";

export { loadPreviewObject, tryExtractUsdaText } from "./loaders";

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
