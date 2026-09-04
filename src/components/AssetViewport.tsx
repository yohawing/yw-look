import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AmbientLight,
  Camera,
  DirectionalLight,
  Object3D,
  WebGLRenderTarget,
} from "three";
import { formatUsdErrorForDisplay, type StageInspection } from "../lib/usd";
import {
  type DeferredTextureSnapshot,
  type LoadingStageId,
  type LoadingStageSnapshot,
  type MissingReferenceError,
  type SceneContext,
  neutralFeedback,
  DEFAULT_SCENE_DIMENSION,
  revokeUrls,
  stopAnimations,
  resetSceneObjects,
  applyControlsSensitivity,
  cancelScaleNormalization,
  applyDynamicGrid,
  applyDynamicAxes,
  loadPreviewObject,
  buildMissingReferenceMetadata,
  applySelectionHighlightToObject,
  clearSelectionHighlightFromObject,
  applyPreviewLightingPreset,
  DEFAULT_LIGHTING_PRESET,
  DEFAULT_PREVIEW_RENDERING_PRESET,
  getPreviewRenderingPresetForExtension,
} from "../viewer";
import { usePackFileRequest } from "../packs";
import type { ViewerMode } from "../viewer";
import { AssetViewportOverlay } from "./AssetViewportOverlay";
import { emptyAnimationState, type AnimationState } from "./animation";
import {
  applyMorphTargetValues,
  morphTargetValuesForObject,
} from "./morphTargets";

import type { EnvironmentPreset } from "../types/viewer";
import {
  applyControlSensitivity,
  applyCameraPresetToMountedObject,
  configureAssetControls,
  frameCurrentMountedObject,
  syncActiveCameraSelection,
  syncAxesVisibility,
  syncGridVisibility,
} from "../viewport/camera";
import { createEnvironmentTarget } from "../viewport/environment";
import {
  createFxaaComposerState,
  syncFxaaComposerSize,
  type FxaaComposerState,
} from "../viewport/fxaa";
import {
  applyViewportBackground,
  applyViewportRenderingSettings,
  runCleanupCallbacks,
  toneMappingModeMap,
} from "../viewport/renderSettings";
import {
  buildRuntimeWarningFeedback,
  type ReadyPreviewFeedbackBase,
} from "../viewport/loadFeedback";
import { createLoadingStageClock } from "../viewport/loadingStage";
import {
  applyPurposeVisibility,
  findObjectBySelectionKey,
} from "../viewport/selection";
import { applyViewportShortcutCommand } from "../viewport/shortcutCommands";
import type { AssetViewportProps } from "../viewport/types";
import {
  buildUnsupportedPreviewFeedback,
  getRuntimePreviewSupportState,
  resolveEffectiveOverlayMode,
} from "../viewport/previewSupport";
import { useResourceDiagnosticsPublisher } from "../viewport/useResourceDiagnosticsPublisher";
import { useSceneObjectEffects } from "../viewport/useSceneObjectEffects";
import { useSyncRef } from "../viewport/useSyncRef";
import { useTexturePreview } from "../viewport/useTexturePreview";
import { useViewportAnimation } from "../viewport/useViewportAnimation";
import { useViewportSceneLifecycle } from "../viewport/useViewportSceneLifecycle";
import { mountLoadedPreview } from "../viewport/previewLoadMount";
import { registerViewportCommandHandlers } from "../viewport/viewportCommands";

export type {
  ViewerFeedback,
  DisplayMode,
  ViewerSurfaceMode,
  TextureViewMode,
  TextureFilterMode,
  CameraPreset,
  BackgroundPreset,
  EnvironmentPreset,
  ToneMappingMode,
} from "../types/viewer";

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function AssetViewport({
  currentFile,
  disabledOptionalLoaderPackIds = [],
  incompatibleOptionalLoaderPackIds = [],
  packFileRequest,
  displayMode,
  backgroundPreset,
  onFeedbackChange,
  onOpenFile,
  onUsdError,
  onMetadataChange,
  onPackMetadataChange,
  onResourceDiagnosticsChange,
  selectedTextureId,
  viewerSurfaceMode,
  textureViewMode,
  textureExposure,
  textureBlackPoint,
  textureWhitePoint,
  textureTileCount,
  textureGamma,
  showGrid,
  showAxes,
  showSkeleton,
  showLocalAxis,
  showJointNames,
  showBoundingBoxes,
  showNormals,
  showVertexColors,
  showEnvironmentBackground,
  environmentRotation,
  backfaceCulling,
  textureFilterMode,
  controlSensitivity,
  cameraFov,
  renderScale,
  showShadows,
  showUnlit,
  fxaaEnabled,
  showRendererStats,
  toneMappingMode,
  exposure,
  onGridUnitChange,
  environmentPreset,
  cameraSpeedMultiplier,
  usdLoadPolicy,
  usdInspection = null,
  texturePreview3D,
  onSelectMesh,
  selectedMeshName,
  morphTargetValues,
  purposeModes,
  variantSelections,
  activeCameraId = null,
  onActiveCameraReset,
  glbOverride = null,
  deferredProgress = null,
  onScaleNormalizationChange,
}: AssetViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const statsRef = useRef<HTMLDivElement | null>(null);
  const ambientLightRef = useRef<AmbientLight | null>(null);
  const keyLightRef = useRef<DirectionalLight | null>(null);
  const fillLightRef = useRef<DirectionalLight | null>(null);
  const usdInspectionRef = useRef<StageInspection | null>(usdInspection);
  const showShadowsRef = useRef(showShadows);
  const fxaaStateRef = useRef<FxaaComposerState | null>(null);
  const fxaaEnabledRef = useRef(fxaaEnabled);
  const sceneContextRef = useRef<SceneContext | null>(null);
  const resetCameraRef = useRef<(() => void) | null>(null);
  const scaleNormalizationRef = useRef<{
    applied: boolean;
    originalScale: import("three").Vector3;
  } | null>(null);
  const environmentTargetRef = useRef<WebGLRenderTarget | null>(null);
  const environmentTargetsRef = useRef<Map<
    EnvironmentPreset,
    WebGLRenderTarget
  > | null>(null);
  const activeEnvironmentPresetRef =
    useRef<EnvironmentPreset>(environmentPreset);
  const displayModeRef = useRef(displayMode);
  const backfaceCullingRef = useRef(backfaceCulling);
  const textureFilterModeRef = useRef(textureFilterMode);
  const showSkeletonRef = useRef(showSkeleton);
  const showLocalAxisRef = useRef(showLocalAxis);
  const showJointNamesRef = useRef(showJointNames);
  const showBoundingBoxesRef = useRef(showBoundingBoxes);
  const showNormalsRef = useRef(showNormals);
  const showUnlitRef = useRef(showUnlit);
  const showVertexColorsRef = useRef(showVertexColors);
  const viewerSurfaceModeRef = useRef(viewerSurfaceMode);
  const showGridRef = useRef(showGrid);
  const showAxesRef = useRef(showAxes);
  const showEnvironmentBackgroundRef = useRef(showEnvironmentBackground);
  const backgroundPresetRef = useRef(backgroundPreset);
  const toneMappingModeRef = useRef(toneMappingMode);
  const exposureRef = useRef(exposure);
  const controlSensitivityRef = useRef(controlSensitivity);
  const cameraFovRef = useRef(cameraFov);
  const renderScaleRef = useRef(renderScale);
  const latestLoadInputsRef = useRef<{
    filePath: string | null;
    glbOverride: ArrayBuffer | null;
  }>({ filePath: currentFile?.path ?? null, glbOverride });

  useEffect(() => {
    usdInspectionRef.current = usdInspection;
  }, [usdInspection]);
  useLayoutEffect(() => {
    latestLoadInputsRef.current = {
      filePath: currentFile?.path ?? null,
      glbOverride,
    };
  });
  const environmentPresetRef = useRef(environmentPreset);
  const environmentRotationRef = useRef(environmentRotation);
  const cameraSpeedMultiplierRef = useRef(cameraSpeedMultiplier);
  const texturePreview3DRef = useRef(texturePreview3D);
  const onSelectMeshRef = useRef(onSelectMesh);
  const highlightedSelectionRef = useRef<Object3D | null>(null);
  const morphTargetValuesRef = useRef(morphTargetValues);
  const purposeModesRef = useRef(purposeModes);
  // #34: active USD camera. null = free orbit.
  // activeCameraIdRef is read inside the render loop / pointer handlers to
  // guard fly mode without causing the big scene-init effect to re-run.
  const activeCameraIdRef = useRef(activeCameraId);
  const onFeedbackChangeRef = useRef(onFeedbackChange);
  const onScaleNormalizationChangeRef = useRef(onScaleNormalizationChange);
  // #34 codex P2: callback used when a stale camera id survives a reload —
  // the post-load callback runs inside a Three.js Promise chain that does
  // not see prop changes, so we hold the latest setter in a ref.
  const onActiveCameraResetRef = useRef(onActiveCameraReset);

  // The actual Three.js camera found by traversal. null = use the scene's
  // own free camera (context.camera). Stored as `Camera` (not the narrower
  // PerspectiveCamera) so OrthographicCamera USD cameras are also usable —
  // both subtypes satisfy the WebGLRenderer.render(scene, camera) contract.
  const activeCameraRef = useRef<Camera | null>(null);
  const [activePreviewPath, setActivePreviewPath] = useState<string | null>(
    null,
  );
  const activePreviewPathRef = useRef<string | null>(activePreviewPath);
  const [overlayMode, setOverlayMode] = useState<ViewerMode>("empty");
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [loadingStage, setLoadingStage] = useState<LoadingStageSnapshot | null>(
    null,
  );
  const [deferredTexture, setDeferredTexture] =
    useState<DeferredTextureSnapshot | null>(null);
  const effectiveDeferredProgress = deferredTexture ?? deferredProgress;
  const [animationState, setAnimationState] =
    useState<AnimationState>(emptyAnimationState);
  const {
    assetResourceMetricsRef,
    clearResourceDiagnostics,
    publishResourceDiagnostics,
  } = useResourceDiagnosticsPublisher(onResourceDiagnosticsChange);

  useEffect(() => {
    activePreviewPathRef.current = activePreviewPath;
  }, [activePreviewPath]);

  useSyncRef(onActiveCameraResetRef, onActiveCameraReset);
  useSyncRef(onFeedbackChangeRef, onFeedbackChange);
  useSyncRef(onScaleNormalizationChangeRef, onScaleNormalizationChange);
  useSyncRef(displayModeRef, displayMode);
  useSyncRef(backfaceCullingRef, backfaceCulling);
  useSyncRef(textureFilterModeRef, textureFilterMode);
  useSyncRef(showShadowsRef, showShadows);
  useSyncRef(fxaaEnabledRef, fxaaEnabled);
  useSyncRef(showSkeletonRef, showSkeleton);
  useSyncRef(showLocalAxisRef, showLocalAxis);
  useSyncRef(showJointNamesRef, showJointNames);
  useSyncRef(showBoundingBoxesRef, showBoundingBoxes);
  useSyncRef(showNormalsRef, showNormals);
  useSyncRef(showUnlitRef, showUnlit);
  useSyncRef(showVertexColorsRef, showVertexColors);
  useSyncRef(viewerSurfaceModeRef, viewerSurfaceMode);
  useSyncRef(showGridRef, showGrid);
  useSyncRef(showAxesRef, showAxes);
  useSyncRef(showEnvironmentBackgroundRef, showEnvironmentBackground);
  useSyncRef(backgroundPresetRef, backgroundPreset);
  useSyncRef(toneMappingModeRef, toneMappingMode);
  useSyncRef(exposureRef, exposure);
  useSyncRef(controlSensitivityRef, controlSensitivity);
  useSyncRef(cameraFovRef, cameraFov);
  useSyncRef(renderScaleRef, renderScale);
  useSyncRef(environmentPresetRef, environmentPreset);
  useSyncRef(environmentRotationRef, environmentRotation);
  useSyncRef(texturePreview3DRef, texturePreview3D);
  useSyncRef(onSelectMeshRef, onSelectMesh);
  useSyncRef(morphTargetValuesRef, morphTargetValues);

  const shouldInitializeScene = currentFile !== null;
  const viewportLifecycleCallbacks = useMemo(
    () => ({
      onFeedbackChange,
      onGridUnitChange,
      onMetadataChange,
      onPackMetadataChange,
    }),
    [
      onFeedbackChange,
      onGridUnitChange,
      onMetadataChange,
      onPackMetadataChange,
    ],
  );
  const previewSupportState = currentFile
    ? getRuntimePreviewSupportState(
        currentFile.extension,
        disabledOptionalLoaderPackIds,
        incompatibleOptionalLoaderPackIds,
      )
    : "implemented";
  const effectiveOverlayMode = resolveEffectiveOverlayMode({
    currentFilePath: currentFile?.path ?? null,
    previewSupportState,
    activePreviewPath,
    overlayMode,
  });

  useEffect(() => {
    const context = sceneContextRef.current;
    const source = context?.sourceObject;
    if (!source) return;
    applyMorphTargetValues(source, morphTargetValues);
    const mmdModel = context.mmdModel;
    mmdModel?.syncMaterialMorphs?.(
      morphTargetValuesForObject(mmdModel.mesh, morphTargetValues),
    );
  }, [morphTargetValues]);

  // #33 reverse direction: tree → viewport highlight.
  // When selectedMeshName changes we apply (or clear) a selection tint on the
  // matching mesh in the live Three.js scene.
  useEffect(() => {
    const mounted = sceneContextRef.current?.mountedObject;
    if (!mounted) return;

    const previous = highlightedSelectionRef.current;
    if (previous) {
      clearSelectionHighlightFromObject(previous);
      highlightedSelectionRef.current = null;
    }

    if (selectedMeshName) {
      const target = findObjectBySelectionKey(mounted, selectedMeshName);
      if (target) {
        applySelectionHighlightToObject(target);
        highlightedSelectionRef.current = target;
      }
    }
  }, [selectedMeshName]);

  useEffect(() => {
    purposeModesRef.current = purposeModes;
    const mounted = sceneContextRef.current?.mountedObject;
    if (!mounted) return;
    applyPurposeVisibility(mounted, purposeModes);
  }, [purposeModes]);

  useEffect(() => {
    activeCameraIdRef.current = activeCameraId;
    const context = sceneContextRef.current;
    if (!context) return;

    activeCameraRef.current = syncActiveCameraSelection(
      context,
      activeCameraId,
      hostRef.current,
    );
  }, [activeCameraId]);

  useEffect(() => {
    cameraSpeedMultiplierRef.current = cameraSpeedMultiplier;

    // When multiplier changes while a model is loaded, immediately update
    // OrbitControls so the user feels the effect without a camera reset.
    const context = sceneContextRef.current;
    if (!context?.mountedObject) {
      return;
    }
    // In texture mode the hidden asset's dimension must NOT influence pan/zoom,
    // so use a neutral dim=1. Otherwise use the stored raw (pre-normalization)
    // dimension for accurate asset-scale sensitivity.
    const sensitivityDim =
      viewerSurfaceModeRef.current === "texture" ? 1 : context.rawMaxDimension;
    applyControlsSensitivity(
      context.controls,
      sensitivityDim,
      cameraSpeedMultiplier,
    );
  }, [cameraSpeedMultiplier]);

  useViewportSceneLifecycle({
    activeCameraIdRef,
    activeCameraRef,
    activeEnvironmentPresetRef,
    ambientLightRef,
    backgroundPresetRef,
    cameraFovRef,
    cameraSpeedMultiplierRef,
    clearResourceDiagnostics,
    callbacks: viewportLifecycleCallbacks,
    controlSensitivityRef,
    currentFileExtension: currentFile?.extension,
    environmentPresetRef,
    environmentRotationRef,
    environmentTargetRef,
    environmentTargetsRef,
    exposureRef,
    fillLightRef,
    fxaaEnabledRef,
    fxaaStateRef,
    hostRef,
    keyLightRef,
    onSelectMeshRef,
    publishResourceDiagnostics,
    renderScaleRef,
    resetCameraRef,
    sceneContextRef,
    shouldInitializeScene,
    showAxesRef,
    showEnvironmentBackgroundRef,
    showGridRef,
    statsRef,
    texturePreview3DRef,
    toneMappingModeRef,
    viewerSurfaceModeRef,
  });

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context) {
      return;
    }

    applyViewportBackground(
      context.renderer,
      context.scene,
      backgroundPreset,
      showEnvironmentBackground
        ? (environmentTargetRef.current?.texture ?? null)
        : null,
    );
  }, [backgroundPreset, showEnvironmentBackground]);

  useEffect(() => {
    const context = sceneContextRef.current;
    if (!context) {
      return;
    }
    if (
      getPreviewRenderingPresetForExtension(currentFile?.extension) !==
      DEFAULT_PREVIEW_RENDERING_PRESET
    ) {
      return;
    }
    context.renderer.toneMapping = toneMappingModeMap[toneMappingMode];
  }, [currentFile?.extension, toneMappingMode]);

  useEffect(() => {
    const context = sceneContextRef.current;
    if (!context) {
      return;
    }
    if (
      getPreviewRenderingPresetForExtension(currentFile?.extension) !==
      DEFAULT_PREVIEW_RENDERING_PRESET
    ) {
      return;
    }
    context.renderer.toneMappingExposure = exposure;
  }, [currentFile?.extension, exposure]);

  useEffect(() => {
    const context = sceneContextRef.current;
    if (!context) {
      return;
    }
    applyControlSensitivity(context.controls, controlSensitivity);
  }, [controlSensitivity]);

  useEffect(() => {
    const context = sceneContextRef.current;
    if (!context) {
      return;
    }
    context.camera.fov = cameraFov;
    context.camera.updateProjectionMatrix();
  }, [cameraFov]);

  useEffect(() => {
    const context = sceneContextRef.current;
    if (!context) {
      return;
    }
    // setPixelRatio triggers a drawing-buffer reallocation, which is
    // exactly what we want so the canvas re-samples at the new scale.
    const pixelRatio = window.devicePixelRatio * renderScale;
    context.renderer.setPixelRatio(pixelRatio);

    const fxaaState = fxaaStateRef.current;
    if (!fxaaState) {
      return;
    }

    const width = context.renderer.domElement.clientWidth;
    const height = context.renderer.domElement.clientHeight;

    syncFxaaComposerSize(fxaaState, width, height, pixelRatio);
  }, [renderScale]);

  useEffect(() => {
    const context = sceneContextRef.current;
    if (!context) {
      return;
    }
    // Rotate only around Y (up-axis) so the HDRI spins horizontally,
    // which is what "rotate environment" means for most studio rigs.
    context.scene.environmentRotation.set(0, environmentRotation, 0);
    context.scene.backgroundRotation.set(0, environmentRotation, 0);
  }, [environmentRotation]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context) {
      return;
    }

    if (activeEnvironmentPresetRef.current === environmentPreset) {
      return;
    }

    let nextTarget = environmentTargetsRef.current?.get(environmentPreset);

    if (!nextTarget) {
      nextTarget = createEnvironmentTarget(
        context.pmremGenerator,
        environmentPreset,
      );
      if (!nextTarget) {
        return;
      }
      if (environmentTargetsRef.current) {
        environmentTargetsRef.current.set(environmentPreset, nextTarget);
      }
    }

    environmentTargetRef.current = nextTarget;
    activeEnvironmentPresetRef.current = environmentPreset;
    context.scene.environment = nextTarget.texture;

    // If the environment is currently used as the background too, swap the
    // background texture in the same frame to avoid a flicker where
    // `scene.background` still points at the previous preset.
    if (showEnvironmentBackgroundRef.current) {
      applyViewportBackground(
        context.renderer,
        context.scene,
        backgroundPresetRef.current,
        nextTarget.texture,
      );
    }
  }, [environmentPreset]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context) {
      return;
    }

    if (!currentFile) {
      syncGridVisibility(
        context,
        showGridRef.current,
        viewerSurfaceModeRef.current,
        true,
      );
      syncAxesVisibility(
        context,
        showAxesRef.current,
        viewerSurfaceModeRef.current,
        true,
      );
      return;
    }

    if (!context.mountedObject) {
      syncGridVisibility(
        context,
        showGridRef.current,
        viewerSurfaceModeRef.current,
      );
      syncAxesVisibility(
        context,
        showAxesRef.current,
        viewerSurfaceModeRef.current,
      );
      return;
    }

    frameCurrentMountedObject(
      context,
      viewerSurfaceModeRef.current,
      showGridRef.current,
      showAxesRef.current,
      cameraSpeedMultiplierRef.current,
      texturePreview3DRef.current,
    );
    resetCameraRef.current = () => {
      frameCurrentMountedObject(
        sceneContextRef.current,
        viewerSurfaceModeRef.current,
        showGridRef.current,
        showAxesRef.current,
        cameraSpeedMultiplierRef.current,
        texturePreview3DRef.current,
      );
    };
  }, [currentFile, showGrid, showAxes, viewerSurfaceMode]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context) {
      return;
    }

    runCleanupCallbacks(context.cleanupCallbacks);
    context.cleanupCallbacks = [];
    context.packRuntime?.dispose();
    context.packRuntime = null;
    stopAnimations(context);
    context.mmdModel = null;
    resetSceneObjects(context);
    revokeUrls(context.cleanupUrls);
    context.cleanupUrls = [];
    assetResourceMetricsRef.current = null;
    publishResourceDiagnostics(context);
    context.controls.enabled = false;
    resetCameraRef.current = null;
    // #34: clear USD camera override on every file change so we always start
    // with the free-orbit camera for a fresh asset.
    activeCameraRef.current = null;
    applyPreviewLightingPreset(DEFAULT_LIGHTING_PRESET, {
      ambient: ambientLightRef.current,
      key: keyLightRef.current,
      fill: fillLightRef.current,
    });
    applyViewportRenderingSettings(
      context.renderer,
      currentFile?.extension,
      toneMappingModeRef.current,
      exposureRef.current,
    );

    // Show/hide initial grid based on file state
    if (!currentFile) {
      syncGridVisibility(
        context,
        showGridRef.current,
        viewerSurfaceModeRef.current,
        true,
      );
      syncAxesVisibility(
        context,
        showAxesRef.current,
        viewerSurfaceModeRef.current,
        true,
      );
      const fallbackGrid = applyDynamicGrid(
        context.scene,
        DEFAULT_SCENE_DIMENSION,
        showGridRef.current,
      );
      onGridUnitChange(fallbackGrid.label);
      applyDynamicAxes(
        context.scene,
        DEFAULT_SCENE_DIMENSION,
        showAxesRef.current,
      );
      context.camera.position.set(5, 4, 5);
      context.camera.lookAt(0, 0, 0);
      context.controls.target.set(0, 0, 0);
      configureAssetControls(context.controls);
      context.controls.enabled = true;
      onFeedbackChange(neutralFeedback);
      onMetadataChange(null);
      onPackMetadataChange(null);
      assetResourceMetricsRef.current = null;
      publishResourceDiagnostics(context);

      queueMicrotask(() => {
        setErrorDetail(null);
        setLoadingStage(null);
        setDeferredTexture(null);
      });
      return;
    }

    syncGridVisibility(
      context,
      showGridRef.current,
      viewerSurfaceModeRef.current,
    );
    syncAxesVisibility(
      context,
      showAxesRef.current,
      viewerSurfaceModeRef.current,
    );

    const supportState = getRuntimePreviewSupportState(
      currentFile.extension,
      disabledOptionalLoaderPackIds,
      incompatibleOptionalLoaderPackIds,
    );
    if (supportState !== "implemented") {
      onMetadataChange(null);
      onPackMetadataChange(null);
      assetResourceMetricsRef.current = null;
      publishResourceDiagnostics(context);
      onFeedbackChange(
        buildUnsupportedPreviewFeedback(currentFile.extension, supportState),
      );
      queueMicrotask(() => {
        setErrorDetail(null);
        setLoadingStage(null);
        setDeferredTexture(null);
      });
      return;
    }

    const isDeferredGlbReload =
      glbOverride !== null &&
      activePreviewPathRef.current === currentFile.path &&
      context.mountedObject !== null;
    let disposed = false;
    let latestDeferredTexture: DeferredTextureSnapshot | null = null;
    let refreshTextureMetadata: (() => void) | null = null;
    const abortController = new AbortController();
    const loadingStartedAt = performance.now();
    const loadingClock = createLoadingStageClock("scan", loadingStartedAt);
    const reportLoadingStage = (stage: LoadingStageId) => {
      if (disposed) return;
      if (isDeferredGlbReload) return;

      setLoadingStage(loadingClock.report(stage));
    };

    if (!isDeferredGlbReload) {
      onFeedbackChange({
        mode: "loading",
        message: `Loading ${currentFile.fileName}`,
        warning: null,
        canResetCamera: false,
      });
      onMetadataChange(null);
      onPackMetadataChange(null);
      assetResourceMetricsRef.current = null;
      publishResourceDiagnostics(context);
      queueMicrotask(() => {
        setErrorDetail(null);
        setDeferredTexture(null);
      });
    }
    reportLoadingStage("scan");
    const runtimeWarnings: string[] = [];
    let readyFeedbackBase: ReadyPreviewFeedbackBase | null = null;
    const pushRuntimeWarning = (warning: string) => {
      if (disposed || runtimeWarnings.includes(warning)) {
        return;
      }
      runtimeWarnings.push(warning);
      onFeedbackChange(
        buildRuntimeWarningFeedback(
          currentFile.fileName,
          runtimeWarnings,
          readyFeedbackBase,
        ),
      );
    };
    loadPreviewObject(currentFile, context.renderer, {
      usdLoadPolicy,
      getUsdInspection: () => usdInspectionRef.current,
      variantSelections,
      glbOverride: glbOverride ?? null,
      disabledOptionalLoaderPackIds,
      incompatibleOptionalLoaderPackIds,
      signal: abortController.signal,
      onStage: reportLoadingStage,
      onDeferredTexture: (snapshot) => {
        if (disposed) return;
        latestDeferredTexture = snapshot;
        setDeferredTexture(snapshot.pending > 0 ? snapshot : null);
        if (snapshot.total > 0 && snapshot.pending === 0) {
          refreshTextureMetadata?.();
        }
      },
      onWarning: pushRuntimeWarning,
    })
      .then(async (result) => {
        reportLoadingStage("scene");
        reportLoadingStage("ui");
        readyFeedbackBase = await mountLoadedPreview(result, {
          clearActiveCameraId: () => onActiveCameraResetRef.current?.(),
          context,
          currentFile,
          getMountState: () => ({
            backfaceCulling: backfaceCullingRef.current,
            cameraSpeedMultiplier: cameraSpeedMultiplierRef.current,
            displayMode: displayModeRef.current,
            morphTargetValues: morphTargetValuesRef.current,
            selectedPurposeModes: purposeModesRef.current,
            showAxes: showAxesRef.current,
            showBoundingBoxes: showBoundingBoxesRef.current,
            showGrid: showGridRef.current,
            showJointNames: showJointNamesRef.current,
            showLocalAxis: showLocalAxisRef.current,
            showNormals: showNormalsRef.current,
            showShadows: showShadowsRef.current,
            showSkeleton: showSkeletonRef.current,
            showUnlit: showUnlitRef.current,
            showVertexColors: showVertexColorsRef.current,
            textureFilterMode: textureFilterModeRef.current,
            texturePreview3D: texturePreview3DRef.current,
            viewerSurfaceMode: viewerSurfaceModeRef.current,
          }),
          host: hostRef.current,
          isDisposed: () => disposed,
          keyLight: keyLightRef.current,
          lightingTargets: {
            ambient: ambientLightRef.current,
            key: keyLightRef.current,
            fill: fillLightRef.current,
          },
          preserveCameraView: isDeferredGlbReload,
          replaceExistingPreview: isDeferredGlbReload,
          refs: {
            activeCameraIdRef,
            activeCameraRef,
            assetResourceMetricsRef,
            scaleNormalizationRef,
          },
          runtimeWarnings,
          update: {
            onFeedbackChange,
            onGridUnitChange,
            onMetadataChange,
            onPackMetadataChange,
            onScaleNormalizationChange,
            onTextureMetadataRefresh: (refresh) => {
              refreshTextureMetadata = refresh;
              if (!refresh) return;
              if (
                latestDeferredTexture &&
                latestDeferredTexture.total > 0 &&
                latestDeferredTexture.pending === 0
              ) {
                refresh();
              }
            },
            publishResourceDiagnostics,
            setActivePreviewPath,
            setAnimationState,
            setOverlayReady: () => setOverlayMode("ready"),
          },
        });
        if (!readyFeedbackBase || disposed) {
          return;
        }
        setErrorDetail(null);
        resetCameraRef.current = () => {
          frameCurrentMountedObject(
            sceneContextRef.current,
            viewerSurfaceModeRef.current,
            showGridRef.current,
            showAxesRef.current,
            cameraSpeedMultiplierRef.current,
            texturePreview3DRef.current,
          );
        };
        setLoadingStage(null);
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        if (isAbortError(error)) {
          if (isDeferredGlbReload) {
            setLoadingStage(null);
            setDeferredTexture(null);
            return;
          }
          setActivePreviewPath(currentFile.path);
          setOverlayMode("empty");
          setErrorDetail(null);
          onFeedbackChange(neutralFeedback);
          onMetadataChange(null);
          onPackMetadataChange(null);
          assetResourceMetricsRef.current = null;
          publishResourceDiagnostics(context);
          setLoadingStage(null);
          setDeferredTexture(null);
          return;
        }

        // Log the raw error to the webview console so it is visible in
        // devtools (Tauri: Ctrl+Shift+I) and not just in Diagnostics.
        console.error("[viewer] load failed:", error);
        onUsdError?.(error);

        const message = formatUsdErrorForDisplay(
          error,
          "Failed to load preview.",
        );
        if (isDeferredGlbReload) {
          onFeedbackChange({
            mode: "ready",
            message: `Preview ready: ${currentFile.fileName}`,
            warning: message,
            canResetCamera: true,
          });
          setLoadingStage(null);
          setDeferredTexture(null);
          return;
        }
        const missingReferenceError = error as Partial<MissingReferenceError>;
        const mode =
          message.includes("404") || missingReferenceError.missingPaths?.length
            ? "missingReference"
            : "loadFailed";
        // Mark this file as "done" (success or failure) so the effectiveOverlayMode
        // formula picks up the new overlayMode below. Setting null here would keep
        // effectiveOverlayMode stuck on "loading" because the formula falls through
        // to "loading" when activePreviewPath !== currentFile.path.
        setActivePreviewPath(currentFile.path);
        setOverlayMode(mode);
        setErrorDetail(message);
        onMetadataChange(
          mode === "missingReference" && currentFile
            ? buildMissingReferenceMetadata(
                currentFile,
                missingReferenceError.formatVersion ?? null,
                missingReferenceError.missingPaths ?? [],
                missingReferenceError.unresolvedImages ?? [],
              )
            : null,
        );
        onPackMetadataChange(null);
        assetResourceMetricsRef.current = null;
        publishResourceDiagnostics(context);

        onFeedbackChange({
          mode,
          message,
          warning: null,
          canResetCamera: false,
        });
        setLoadingStage(null);
        setDeferredTexture(null);
      });

    return () => {
      disposed = true;
      refreshTextureMetadata = null;
      abortController.abort();
      setLoadingStage(null);
      setDeferredTexture(null);
      const nextLoadInputs = latestLoadInputsRef.current;
      const keepMountedForDeferredReload =
        currentFile !== null &&
        nextLoadInputs.filePath === currentFile.path &&
        nextLoadInputs.glbOverride !== null &&
        nextLoadInputs.glbOverride !== glbOverride;
      if (keepMountedForDeferredReload) {
        return;
      }
      runCleanupCallbacks(context.cleanupCallbacks);
      context.cleanupCallbacks = [];
      context.packRuntime?.dispose();
      context.packRuntime = null;
      stopAnimations(context);
      context.mmdModel = null;
      resetSceneObjects(context);
      revokeUrls(context.cleanupUrls);
      context.cleanupUrls = [];
      assetResourceMetricsRef.current = null;
      publishResourceDiagnostics(context);
    };
  }, [
    assetResourceMetricsRef,
    currentFile,
    onFeedbackChange,
    onUsdError,
    onGridUnitChange,
    onMetadataChange,
    onPackMetadataChange,
    onScaleNormalizationChange,
    showGrid,
    usdLoadPolicy,
    variantSelections,
    glbOverride,
    disabledOptionalLoaderPackIds,
    incompatibleOptionalLoaderPackIds,
    publishResourceDiagnostics,
  ]);

  usePackFileRequest({
    currentFileName: currentFile?.fileName,
    onFeedbackChange,
    request: packFileRequest,
    sceneContextRef,
    setAnimationState,
  });

  useSceneObjectEffects({
    backfaceCulling,
    displayMode,
    keyLightRef,
    sceneContextRef,
    showBoundingBoxes,
    showJointNames,
    showLocalAxis,
    showNormals,
    showShadows,
    showSkeleton,
    showUnlit,
    showVertexColors,
    textureFilterMode,
    viewerSurfaceMode,
  });

  useEffect(() => {
    if (!fxaaEnabled) {
      // Leave the composer in place (so re-enabling is cheap) and
      // rely on fxaaEnabledRef to skip it in the render loop.
      return;
    }
    const context = sceneContextRef.current;
    if (!context || fxaaStateRef.current) {
      return;
    }
    let cancelled = false;
    (async () => {
      const host = hostRef.current;
      if (!host) return;
      const state = await createFxaaComposerState(context, host, {
        isCancelled: () => cancelled,
      });
      if (!state) {
        return;
      }
      if (cancelled) {
        state.composer.dispose();
        return;
      }
      fxaaStateRef.current = state;
    })();
    return () => {
      cancelled = true;
    };
  }, [fxaaEnabled]);

  useTexturePreview({
    currentFile,
    selectedTextureId,
    textureBlackPoint,
    textureExposure,
    textureGamma,
    textureTileCount,
    textureViewMode,
    textureWhitePoint,
    viewerSurfaceMode,
    texturePreview3D,
    sceneContextRef,
    viewerSurfaceModeRef,
    showGridRef,
    showAxesRef,
    cameraSpeedMultiplierRef,
    texturePreview3DRef,
  });

  useEffect(() => {
    return registerViewportCommandHandlers({
      applyCameraPreset: (preset) =>
        applyCameraPresetToMountedObject(
          sceneContextRef.current,
          viewerSurfaceModeRef.current,
          preset,
        ),
      applyShortcutCommand: (command) =>
        applyViewportShortcutCommand({
          cameraSpeedMultiplier: cameraSpeedMultiplierRef.current,
          command,
          context: sceneContextRef.current,
          purposeModes: purposeModesRef.current,
          showAxes: showAxesRef.current,
          showGrid: showGridRef.current,
          texturePreview3D: texturePreview3DRef.current,
          viewerSurfaceMode: viewerSurfaceModeRef.current,
        }),
      cancelScaleNormalization: () => {
        const context = sceneContextRef.current;
        const object = context?.mountedObject ?? null;
        const info = scaleNormalizationRef.current;
        if (!object || !info?.applied) {
          return false;
        }

        cancelScaleNormalization(object, info.originalScale);
        scaleNormalizationRef.current = null;
        onScaleNormalizationChangeRef.current?.({ applied: false, factor: 1 });
        onFeedbackChangeRef.current({
          mode: "ready",
          message: `Scale normalization canceled.`,
          warning: null,
          canResetCamera: true,
        });
        return true;
      },
      resetCamera: () => resetCameraRef.current?.(),
    });
  }, []);

  const {
    hasAnimation,
    handleSeek,
    handleSelectClip,
    handleStep,
    handleTogglePlayback,
  } = useViewportAnimation({
    animationState,
    setAnimationState,
    sceneContextRef,
    morphTargetValuesRef,
    viewerSurfaceMode,
  });

  return (
    <div className="viewport-shell">
      <div className="viewport-canvas" ref={hostRef} />
      <AssetViewportOverlay
        animationState={animationState}
        currentFile={currentFile}
        deferredTexture={deferredTexture}
        effectiveDeferredProgress={effectiveDeferredProgress}
        effectiveOverlayMode={effectiveOverlayMode}
        errorDetail={
          effectiveOverlayMode === "loadFailed" ||
          effectiveOverlayMode === "missingReference"
            ? errorDetail
            : null
        }
        hasAnimation={hasAnimation}
        loadingStage={loadingStage}
        onOpenFile={onOpenFile}
        onSeek={handleSeek}
        onSelectClip={handleSelectClip}
        onStep={handleStep}
        onTogglePlayback={handleTogglePlayback}
        showRendererStats={showRendererStats}
        statsRef={statsRef}
        viewerSurfaceMode={viewerSurfaceMode}
      />
    </div>
  );
}
