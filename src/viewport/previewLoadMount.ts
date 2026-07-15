import { AnimationMixer } from "three";
import type { AssetResourceMetrics } from "../lib/diagnostics";
import type { SelectedFile } from "../lib/files";
import type { PurposeModes } from "../lib/usd";
import type { PackMetadata } from "../types/format-pack";
import {
  emptyAnimationState,
  type AnimationState,
  type AssetMetadata,
  type DisplayMode,
  type TextureFilterMode,
  type ViewerSurfaceMode,
} from "../types/viewer";
import {
  activateClip,
  applyBackfaceCulling,
  applyBoundingBoxHelpers,
  applyDisplayMode,
  applyDynamicAxes,
  applyDynamicGrid,
  applySurfaceMaterialMode,
  applyPreviewLightingPreset,
  applyPreviewRenderingPreset,
  applyShadows,
  applySkeletonHelpers,
  applyTextureFilter,
  collectAssetMetadata,
  collectSceneTraversal,
  disposeObject,
  getClipLabel,
  getObjectMaxDimension,
  getScaleWarning,
  loadPreviewObject,
  loaderRegistry,
  normalizeObjectScale,
  resetSceneObjects,
  revokeUrls,
  scheduleTextureThumbnailEnrichment,
  stopAnimations,
  DEFAULT_LIGHTING_PRESET,
  type SceneContext,
} from "../viewer";
import {
  applyMorphTargetValues,
  morphTargetValuesForObject,
} from "../viewer/morphTargets";
import { syncMmdPreviewSpecularDirection } from "../packs";
import {
  findCameraBySelectionKey,
  frameMountedObject,
  syncPerspectiveCameraAspect,
} from "./camera";
import {
  buildReadyPreviewFeedback,
  type ReadyPreviewFeedbackBase,
} from "./loadFeedback";
import { runCleanupCallbacks } from "./renderSettings";
import { applyPurposeVisibility } from "./selection";
import { collectAssetResourceMetrics } from "./resourceDiagnostics";

type LoadedPreviewObject = Awaited<ReturnType<typeof loadPreviewObject>>;

type LoadedPreviewMountState = {
  backfaceCulling: boolean;
  cameraSpeedMultiplier: number;
  displayMode: DisplayMode;
  morphTargetValues: Record<string, Record<number, number>> | undefined;
  selectedPurposeModes: PurposeModes | undefined;
  showAxes: boolean;
  showBoundingBoxes: boolean;
  showGrid: boolean;
  showJointNames: boolean;
  showLocalAxis: boolean;
  showNormals: boolean;
  showShadows: boolean;
  showSkeleton: boolean;
  showUnlit: boolean;
  showVertexColors: boolean;
  textureFilterMode: TextureFilterMode;
  texturePreview3D: boolean;
  viewerSurfaceMode: ViewerSurfaceMode;
};

type MountLoadedPreviewOptions = {
  clearActiveCameraId: () => void;
  currentFile: SelectedFile;
  context: SceneContext;
  getMountState: () => LoadedPreviewMountState;
  host: HTMLElement | null;
  isDisposed: () => boolean;
  keyLight: import("three").DirectionalLight | null;
  lightingTargets: Parameters<typeof applyPreviewLightingPreset>[1];
  preserveCameraView?: boolean;
  replaceExistingPreview?: boolean;
  runtimeWarnings: readonly string[];
  update: {
    onFeedbackChange: (
      feedback: ReturnType<typeof buildReadyPreviewFeedback>,
    ) => void;
    onGridUnitChange: (label: string) => void;
    onMetadataChange: (metadata: AssetMetadata) => void;
    onPackMetadataChange: (metadata: PackMetadata | null) => void;
    onScaleNormalizationChange?: (
      normalization: { applied: boolean; factor: number } | null,
    ) => void;
    publishResourceDiagnostics: (context: SceneContext | null) => void;
    setActivePreviewPath: (path: string) => void;
    setAnimationState: (state: AnimationState) => void;
    setOverlayReady: () => void;
  };
  refs: {
    activeCameraIdRef: { current: string | null | undefined };
    activeCameraRef: { current: import("three").Camera | null };
    assetResourceMetricsRef: { current: AssetResourceMetrics | null };
    scaleNormalizationRef: {
      current: {
        applied: boolean;
        originalScale: import("three").Vector3;
      } | null;
    };
  };
};

export async function mountLoadedPreview(
  result: LoadedPreviewObject,
  options: MountLoadedPreviewOptions,
): Promise<ReadyPreviewFeedbackBase | null> {
  const {
    clearActiveCameraId,
    context,
    currentFile,
    getMountState,
    host,
    isDisposed,
    keyLight,
    lightingTargets,
    preserveCameraView = false,
    replaceExistingPreview = false,
    refs,
    runtimeWarnings,
    update,
  } = options;
  const {
    object,
    cleanupCallbacks = [],
    cleanupUrls,
    clips,
    formatVersion,
    lighting = DEFAULT_LIGHTING_PRESET,
    rendering,
    skipScaleNormalization = false,
    mmdModel,
    mmdMotion,
    warnings = [],
    assetKind = "mesh",
  } = result;

  const abortMountedPreview = (): null => {
    const ownsMountedObject = context.mountedObject === object;
    const ownsSourceObject = context.sourceObject === object;
    const ownsAnimationRoot = context.animationRoot === object;
    context.scene.remove(object);
    if (ownsMountedObject) {
      context.mountedObject = null;
      context.boneOnlyPreview = false;
    }
    if (ownsSourceObject) {
      context.sourceObject = null;
    }
    if (ownsAnimationRoot) {
      context.animationRoot = null;
    }
    runCleanupCallbacks(cleanupCallbacks);
    if (context.cleanupCallbacks === cleanupCallbacks) {
      context.cleanupCallbacks = [];
    }
    disposeObject(object);
    revokeUrls(cleanupUrls);
    if (context.cleanupUrls === cleanupUrls) {
      context.cleanupUrls = [];
    }
    if (ownsMountedObject || ownsSourceObject || ownsAnimationRoot) {
      refs.scaleNormalizationRef.current = null;
    }
    return null;
  };

  if (isDisposed()) {
    runCleanupCallbacks(cleanupCallbacks);
    disposeObject(object);
    revokeUrls(cleanupUrls);
    return null;
  }

  if (replaceExistingPreview) {
    context.packRuntime?.dispose();
    context.packRuntime = null;
    runCleanupCallbacks(context.cleanupCallbacks);
    context.cleanupCallbacks = [];
    stopAnimations(context);
    context.mmdModel = null;
    resetSceneObjects(context);
    revokeUrls(context.cleanupUrls);
    context.cleanupUrls = [];
  }

  context.scene.add(object);
  context.mountedObject = object;
  context.sourceObject = object;
  context.boneOnlyPreview = false;
  context.animationRoot = null;
  context.cleanupUrls = cleanupUrls;
  context.cleanupCallbacks = cleanupCallbacks;
  applyPreviewLightingPreset(lighting, lightingTargets);
  await syncMmdPreviewSpecularDirection(mmdModel, keyLight);
  if (isDisposed()) {
    return abortMountedPreview();
  }

  const state = getMountState();
  const traversal = collectSceneTraversal(object);

  if (rendering) {
    applyPreviewRenderingPreset(context.renderer, rendering);
  }
  const normalization = skipScaleNormalization
    ? buildSkippedNormalization(object, traversal.maxDimension)
    : normalizeObjectScale(object, traversal);
  refs.scaleNormalizationRef.current =
    normalization.applied && normalization.originalScale
      ? {
          applied: true,
          originalScale: normalization.originalScale,
        }
      : null;
  update.onScaleNormalizationChange?.({
    applied: normalization.applied,
    factor: normalization.factor,
  });
  context.rawMaxDimension =
    normalization.originalMaxDimension > 0
      ? normalization.originalMaxDimension
      : normalization.normalizedMaxDimension;

  const gridConfig = applyDynamicGrid(
    context.scene,
    normalization.normalizedMaxDimension,
    state.showGrid,
  );
  update.onGridUnitChange(gridConfig.label);
  applyDynamicAxes(
    context.scene,
    normalization.normalizedMaxDimension,
    state.showAxes,
  );
  applyDisplayMode(object, state.displayMode, traversal);
  applyBackfaceCulling(object, state.backfaceCulling);
  applyTextureFilter(object, state.textureFilterMode);
  applySurfaceMaterialMode(
    object,
    state.showNormals
      ? "normals"
      : state.showUnlit
        ? "unlit"
        : state.showVertexColors
          ? "vertexColors"
          : "shaded",
  );
  applyMorphTargetValues(object, state.morphTargetValues);
  mmdModel?.syncMaterialMorphs?.(
    morphTargetValuesForObject(mmdModel.mesh, state.morphTargetValues),
  );
  applyShadows(context.scene, object, keyLight, state.showShadows);
  if (!preserveCameraView) {
    frameMountedObject(
      context,
      object,
      state.viewerSurfaceMode,
      state.showGrid,
      state.showAxes,
      state.cameraSpeedMultiplier,
      context.rawMaxDimension,
      state.texturePreview3D,
    );
  }
  if (isDisposed()) {
    return abortMountedPreview();
  }

  const packMetadata =
    loaderRegistry
      .getByExtension(currentFile.extension)
      ?.collectMetadata?.(object, currentFile) ?? null;
  const metadataCollection = collectAssetMetadata(
    object,
    currentFile,
    clips,
    formatVersion,
    packMetadata?.kind === "mmd" ? packMetadata.asset : undefined,
    traversal,
  );
  if (isDisposed()) {
    return abortMountedPreview();
  }
  metadataCollection.metadata.assetKind = assetKind;

  update.setActivePreviewPath(currentFile.path);
  update.setOverlayReady();

  const isBoneOnlyPreview =
    metadataCollection.metadata.meshCount === 0 &&
    metadataCollection.metadata.hasBones === true;
  const isMotionPreviewRig = object.userData.motionPreviewRig === true;
  context.boneOnlyPreview = isBoneOnlyPreview || isMotionPreviewRig;
  context.animationRoot = object;
  context.textureRegistry = metadataCollection.textureRegistry;
  const textureRegistry = metadataCollection.textureRegistry;
  refs.assetResourceMetricsRef.current = collectAssetResourceMetrics(
    metadataCollection.metadata,
  );
  update.onMetadataChange(metadataCollection.metadata);
  update.onPackMetadataChange(packMetadata);
  const thumbnailEnrichment = scheduleTextureThumbnailEnrichment({
    metadata: metadataCollection.metadata,
    onUpdate: update.onMetadataChange,
    shouldContinue: () =>
      !isDisposed() &&
      context.mountedObject === object &&
      context.textureRegistry === textureRegistry,
    textureRegistry,
  });
  context.cleanupCallbacks.push(thumbnailEnrichment.cancel);
  update.publishResourceDiagnostics(context);
  applySkeletonHelpers(
    context.scene,
    object,
    state.showSkeleton || isBoneOnlyPreview || isMotionPreviewRig,
    state.showLocalAxis,
    state.showJointNames,
  );
  applyBoundingBoxHelpers(context.scene, object, state.showBoundingBoxes);
  applyPurposeVisibility(object, state.selectedPurposeModes);

  context.clips = clips;
  context.mmdModel = mmdModel ?? null;
  context.mmdMotion = mmdMotion ? { ...mmdMotion, currentTime: 0 } : null;
  context.packRuntime?.dispose();
  context.packRuntime =
    loaderRegistry
      .getByExtension(currentFile.extension)
      ?.createRuntime?.(context) ?? null;
  if (mmdMotion && context.mmdModel?.runtime) {
    update.setAnimationState({
      clipNames: [mmdMotion.label],
      activeClipIndex: 0,
      currentTime: 0,
      duration: mmdMotion.duration,
      isPlaying: true,
    });
  } else if (clips.length > 0) {
    context.mixer = new AnimationMixer(context.animationRoot ?? object);
    const activated = activateClip(context, 0, true);
    update.setAnimationState({
      clipNames: clips.map(getClipLabel),
      activeClipIndex: activated?.clipIndex ?? 0,
      currentTime: activated?.currentTime ?? 0,
      duration: activated?.duration ?? clips[0]?.duration ?? 0,
      isPlaying: activated?.isPlaying ?? false,
    });
  } else {
    update.setAnimationState(emptyAnimationState);
  }

  const activeCameraId = refs.activeCameraIdRef.current;
  if (activeCameraId) {
    const reFound = findCameraBySelectionKey(context.scene, activeCameraId);
    if (reFound) {
      refs.activeCameraRef.current = reFound;
      context.controls.enabled = false;
      syncPerspectiveCameraAspect(reFound, host);
    } else {
      console.warn(
        `[viewer] USD camera id "${activeCameraId}" not found after reload - free camera restored`,
      );
      refs.activeCameraIdRef.current = null;
      clearActiveCameraId();
    }
  }

  const scaleWarning = getScaleWarning(object, normalization);
  const readyFeedbackBase = {
    message: `Preview ready: ${currentFile.fileName}`,
    warnings: [
      scaleWarning,
      isBoneOnlyPreview
        ? "Bone-only preview: no mesh geometry was found. Use the Skeleton overlay to show the rig."
        : null,
      ...warnings,
    ],
  };
  update.onFeedbackChange(
    buildReadyPreviewFeedback(readyFeedbackBase, runtimeWarnings),
  );
  return readyFeedbackBase;
}

function buildSkippedNormalization(
  object: LoadedPreviewObject["object"],
  maxDimension?: number,
) {
  maxDimension ??= getObjectMaxDimension(object);
  return {
    applied: false,
    factor: 1,
    originalMaxDimension: maxDimension,
    normalizedMaxDimension: maxDimension,
    originalScale: null,
  };
}
