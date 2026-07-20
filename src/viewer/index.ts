export type {
  ViewerFeedback,
  ViewerMode,
  DisplayMode,
  ViewerSurfaceMode,
  TextureViewMode,
  SceneContext,
  LoadedPreview,
  ViewerAssetKind,
  DeferredTextureSnapshot,
  LoadingStageId,
  LoadingStageSnapshot,
  MissingReferenceError,
  OptionalLoaderPackStatus,
} from "./types";

export { neutralFeedback } from "./types";
export {
  formatDisabledOptionalLoaderMessage,
  formatIncompatibleOptionalLoaderMessage,
  formatMissingOptionalLoaderMessage,
  formatUnsupportedFormatMessage,
} from "./types";

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
  collectSceneTraversal,
  normalizeObjectScale,
  cancelScaleNormalization,
  formatScaleFactor,
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
  applyNormalSurfaceMaterial,
  applySurfaceMaterialMode,
  isNormalSurfaceMaterialActive,
  isViewportHelperObject,
  ensureShadowCatcher,
  applyShadows,
  applyUnlitMaterial,
} from "./scene";
export type {
  CameraPreset,
  GridConfig,
  ScaleNormalizationResult,
  TextureFilterMode,
  SurfaceMaterialMode,
  SceneTraversalSnapshot,
} from "./scene";

export {
  loadPreviewObject,
  loadMmdMotion,
  tryExtractUsdaText,
  loaderRegistry,
  getPreviewSupportState,
  listRegisteredLoaders,
  listOptionalLoaderPacks,
  disabledOptionalLoaderPackIds,
  incompatibleOptionalLoaderPackIds,
} from "./loaders";
export type {
  FormatPack,
  LoaderContext,
  LoaderPlugin,
  PackMetadata,
  PackRuntime,
} from "./loaderRegistry";

export {
  captureRendererScreenshot,
  captureWebGLCanvasScreenshot,
  isRendererCanvasNonBlank,
} from "./screenshot";
export type {
  AssetViewportApi,
  CanvasScreenshot,
  CanvasScreenshotOptions,
} from "./screenshot";

export {
  collectAssetMetadata,
  buildMissingReferenceMetadata,
  cameraDisplayName,
  cameraSelectionKey,
  scheduleTextureThumbnailEnrichment,
} from "./metadata";
export type { MetadataCollection } from "./metadata";

export { createTextureViewerObject } from "./texture";
export {
  applyPreviewLightingPreset,
  DEFAULT_LIGHTING_PRESET,
  MMD_EXAMPLE_LIGHTING_PRESET,
} from "./lighting";
export type { PreviewLightingPreset } from "./lighting";
export {
  applyPreviewRenderingPreset,
  DEFAULT_PREVIEW_RENDERING_PRESET,
  getPreviewRenderingPresetForExtension,
  MMD_PREVIEW_RENDERING_PRESET,
} from "./rendering";
export type { PreviewRenderingPreset } from "./rendering";

export {
  getClipLabel,
  activateClip,
  setActionPlayback,
  seekAction,
  stepAction,
} from "./animationController";

export { getCachedBuffer, evictAll, prefetchAdjacent } from "./prefetchCache";
export {
  applySelectionMaterialCustomizer,
  isSelectionProxy,
  selectionProxyTarget,
  setSelectionMaterialCustomizer,
  setSelectionProxyTarget,
  type SelectionMaterialCustomizer,
} from "./selectionProxy";
export {
  explicitObjectSelectionKey,
  resolveObjectSelectionKey,
  setObjectSelectionKey,
} from "./selectionKeys";

export {
  applySelectionHighlight,
  applySelectionHighlightToObject,
  clearSelectionHighlight,
  clearSelectionHighlightFromObject,
} from "./highlight";
export {
  createMeshBvhRaycastBuilder,
  isStaticMeshBvhCandidate,
  LARGE_PICK_MESH_TRIANGLE_THRESHOLD,
  meshTriangleCount,
} from "./meshBvhRaycast";
