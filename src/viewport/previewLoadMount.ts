import { AnimationMixer } from "three";
import type { AssetResourceMetrics } from "../lib/diagnostics";
import type { SelectedFile } from "../lib/files";
import type { PurposeModes } from "../lib/usd";
import type {
  DisplayMode,
  TextureFilterMode,
  ViewerSurfaceMode,
} from "../types/viewer";
import {
  activateClip,
  applyBackfaceCulling,
  applyBoundingBoxHelpers,
  applyDisplayMode,
  applyDynamicAxes,
  applyDynamicGrid,
  applyNormalHelpers,
  applyPreviewLightingPreset,
  applyPreviewRenderingPreset,
  applyShadows,
  applySkeletonHelpers,
  applyTextureFilter,
  applyVertexColors,
  collectAssetMetadata,
  disposeObject,
  getClipLabel,
  getObjectMaxDimension,
  getScaleWarning,
  loadPreviewObject,
  normalizeObjectScale,
  revokeUrls,
  DEFAULT_LIGHTING_PRESET,
  type SceneContext,
} from "../viewer";
import type { AssetMetadata } from "../components/assetMetadata";
import {
  emptyAnimationState,
  type AnimationState,
} from "../components/animation";
import { applyMorphTargetValues } from "../components/morphTargets";
import { syncMmdPreviewSpecularDirection } from "../viewer/mmd/loader";
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
  runtimeWarnings: readonly string[];
  update: {
    onFeedbackChange: (
      feedback: ReturnType<typeof buildReadyPreviewFeedback>,
    ) => void;
    onGridUnitChange: (label: string) => void;
    onMetadataChange: (metadata: AssetMetadata) => void;
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
    mmdMetadata,
    mmdModel,
    warnings = [],
    assetKind = "mesh",
  } = result;

  if (isDisposed()) {
    runCleanupCallbacks(cleanupCallbacks);
    disposeObject(object);
    revokeUrls(cleanupUrls);
    return null;
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
    context.scene.remove(object);
    context.mountedObject = null;
    context.sourceObject = null;
    runCleanupCallbacks(cleanupCallbacks);
    context.cleanupCallbacks = [];
    disposeObject(object);
    revokeUrls(cleanupUrls);
    context.cleanupUrls = [];
    return null;
  }

  const state = getMountState();

  if (rendering) {
    applyPreviewRenderingPreset(context.renderer, rendering);
  }
  const normalization = skipScaleNormalization
    ? buildSkippedNormalization(object)
    : normalizeObjectScale(object);
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
  applyDisplayMode(object, state.displayMode);
  applyBackfaceCulling(object, state.backfaceCulling);
  applyTextureFilter(object, state.textureFilterMode);
  applyVertexColors(object, state.showVertexColors);
  applyMorphTargetValues(object, state.morphTargetValues);
  applyShadows(context.scene, object, keyLight, state.showShadows);
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
  update.setActivePreviewPath(currentFile.path);
  update.setOverlayReady();

  const metadataCollection = collectAssetMetadata(
    object,
    currentFile,
    clips,
    formatVersion,
    mmdMetadata,
  );
  metadataCollection.metadata.assetKind = assetKind;
  const isBoneOnlyPreview =
    metadataCollection.metadata.meshCount === 0 &&
    metadataCollection.metadata.hasBones === true;
  context.boneOnlyPreview = isBoneOnlyPreview;
  context.animationRoot = object;
  context.textureRegistry = metadataCollection.textureRegistry;
  refs.assetResourceMetricsRef.current = collectAssetResourceMetrics(
    metadataCollection.metadata,
  );
  update.onMetadataChange(metadataCollection.metadata);
  update.publishResourceDiagnostics(context);
  applySkeletonHelpers(
    context.scene,
    object,
    state.showSkeleton,
    state.showLocalAxis,
    state.showJointNames,
  );
  applyBoundingBoxHelpers(context.scene, object, state.showBoundingBoxes);
  applyNormalHelpers(context.scene, object, state.showNormals);
  applyPurposeVisibility(object, state.selectedPurposeModes);

  context.clips = clips;
  context.mmdModel = mmdModel ?? null;
  context.mmdMotion = null;
  if (clips.length > 0) {
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

function buildSkippedNormalization(object: LoadedPreviewObject["object"]) {
  const maxDimension = getObjectMaxDimension(object);
  return {
    applied: false,
    factor: 1,
    originalMaxDimension: maxDimension,
    normalizedMaxDimension: maxDimension,
    originalScale: null,
  };
}
