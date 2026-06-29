import { useEffect, useRef, useState } from "react";
import {
  AmbientLight,
  AnimationMixer,
  Camera,
  DirectionalLight,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Texture,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { formatUsdErrorForDisplay } from "../lib/usd";
import {
  type DeferredTextureSnapshot,
  type LoadingStageId,
  type LoadingStageSnapshot,
  type MissingReferenceError,
  type SceneContext,
  neutralFeedback,
  DEFAULT_SCENE_DIMENSION,
  revokeUrls,
  disposeObject,
  stopAnimations,
  resetSceneObjects,
  applyPresetView,
  applyControlsSensitivity,
  getObjectMaxDimension,
  normalizeObjectScale,
  cancelScaleNormalization,
  applyDynamicGrid,
  applyDynamicAxes,
  getScaleWarning,
  applyDisplayMode,
  applyBackfaceCulling,
  applyTextureFilter,
  applyVertexColors,
  applySkeletonHelpers,
  applyBoundingBoxHelpers,
  applyNormalHelpers,
  applyShadows,
  ensureShadowCatcher,
  loadPreviewObject,
  loadMmdMotion,
  collectAssetMetadata,
  buildMissingReferenceMetadata,
  getClipLabel,
  activateClip,
  applySelectionHighlightToObject,
  clearSelectionHighlightFromObject,
  applyUnlitMaterial,
  applyPreviewLightingPreset,
  applyPreviewRenderingPreset,
  DEFAULT_LIGHTING_PRESET,
  DEFAULT_PREVIEW_RENDERING_PRESET,
  getPreviewRenderingPresetForExtension,
} from "../viewer";
import type { ViewerMode } from "../viewer";
import { syncMmdPreviewSpecularDirection } from "../viewer/mmd/loader";
import { syncMmdMaterialRenderStates } from "../viewer/mmd/userData";
import { AssetViewportOverlay } from "./AssetViewportOverlay";
import { emptyAssetMetadata } from "./assetMetadata";
import { emptyAnimationState, type AnimationState } from "./animation";
import { applyMorphTargetValues } from "./morphTargets";

import type { EnvironmentPreset } from "../types/viewer";
import {
  applyControlSensitivity,
  configureAssetControls,
  findCameraBySelectionKey,
  frameMountedObject,
  frameObjectBounds,
  syncPerspectiveCameraAspect,
  syncAxesVisibility,
  syncGridVisibility,
} from "../viewport/camera";
import { createEnvironmentTarget } from "../viewport/environment";
import {
  applyViewportBackground,
  applyViewportRenderingSettings,
  runCleanupCallbacks,
  toneMappingModeMap,
} from "../viewport/renderSettings";
import {
  buildReadyPreviewFeedback,
  buildRuntimeWarningFeedback,
  type ReadyPreviewFeedbackBase,
} from "../viewport/loadFeedback";
import { createLoadingStageClock } from "../viewport/loadingStage";
import { createFlyCameraControls } from "../viewport/flyCamera";
import {
  applyManualVisibility,
  applyPurposeVisibility,
  createViewportPicker,
  findObjectBySelectionKey,
  isolateObject,
  setSubtreeManualHidden,
} from "../viewport/selection";
import {
  collectAssetResourceMetrics,
  RESOURCE_DIAGNOSTICS_SAMPLE_MS,
} from "../viewport/resourceDiagnostics";
import type { AssetViewportProps } from "../viewport/types";
import {
  buildUnsupportedPreviewFeedback,
  getRuntimePreviewSupportState,
  resolveEffectiveOverlayMode,
  updateRuntimePreview,
} from "../viewport/previewSupport";
import { useResourceDiagnosticsPublisher } from "../viewport/useResourceDiagnosticsPublisher";
import { useSyncRef } from "../viewport/useSyncRef";
import { useTexturePreview } from "../viewport/useTexturePreview";
import { useViewportAnimation } from "../viewport/useViewportAnimation";

export type {
  ViewerFeedback,
  DisplayMode,
  ViewerSurfaceMode,
  TextureViewMode,
  TextureFilterMode,
  CameraPreset,
  BackgroundPreset,
  CameraPresetRequest,
  EnvironmentPreset,
  ToneMappingMode,
} from "../types/viewer";

export function AssetViewport({
  currentFile,
  disabledOptionalLoaderPackIds = [],
  incompatibleOptionalLoaderPackIds = [],
  mmdMotionRequest,
  displayMode,
  backgroundPreset,
  onFeedbackChange,
  onOpenFile,
  onUsdError,
  onMetadataChange,
  onResourceDiagnosticsChange,
  selectedTextureId,
  viewerSurfaceMode,
  textureViewMode,
  textureExposure,
  textureBlackPoint,
  textureWhitePoint,
  textureTileCount,
  textureGamma,
  resetVersion,
  viewportShortcutCommand,
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
  cameraPresetRequest,
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
  cancelScaleNormalizationVersion = 0,
}: AssetViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const statsRef = useRef<HTMLDivElement | null>(null);
  const ambientLightRef = useRef<AmbientLight | null>(null);
  const keyLightRef = useRef<DirectionalLight | null>(null);
  const fillLightRef = useRef<DirectionalLight | null>(null);
  const showShadowsRef = useRef(showShadows);
  // EffectComposer lives behind a lazy import; only materialized the
  // first time the user enables FXAA so the base renderer path has
  // no post-processing cost when the toggle is off. The structural
  // shape here matches what we use on the value later so we can keep
  // the import statements lazy without leaking three/examples types
  // to module scope.
  type FxaaComposerState = {
    composer: {
      render: () => void;
      setSize: (w: number, h: number) => void;
      dispose: () => void;
    };
    fxaaPass: {
      material: {
        uniforms: Record<string, { value: Vector2 }>;
      };
    };
    /** The RenderPass stored so its `.camera` can be swapped when a
     * USD camera is selected (#34). EffectComposer exposes `passes[]`
     * but the typed shape is opaque here; we hold it separately. */
    renderPass: { camera: import("three").Camera };
  };
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
  const showVertexColorsRef = useRef(showVertexColors);
  const viewerSurfaceModeRef = useRef(viewerSurfaceMode);
  const showGridRef = useRef(showGrid);
  const showAxesRef = useRef(showAxes);
  const showEnvironmentBackgroundRef = useRef(showEnvironmentBackground);
  const backgroundPresetRef = useRef(backgroundPreset);
  const toneMappingModeRef = useRef(toneMappingMode);
  const exposureRef = useRef(exposure);
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
  const [overlayMode, setOverlayMode] = useState<ViewerMode>("empty");
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

  useSyncRef(onActiveCameraResetRef, onActiveCameraReset);
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
  useSyncRef(showVertexColorsRef, showVertexColors);
  useSyncRef(viewerSurfaceModeRef, viewerSurfaceMode);
  useSyncRef(showGridRef, showGrid);
  useSyncRef(showAxesRef, showAxes);
  useSyncRef(showEnvironmentBackgroundRef, showEnvironmentBackground);
  useSyncRef(backgroundPresetRef, backgroundPreset);
  useSyncRef(toneMappingModeRef, toneMappingMode);
  useSyncRef(exposureRef, exposure);
  useSyncRef(texturePreview3DRef, texturePreview3D);
  useSyncRef(onSelectMeshRef, onSelectMesh);
  useSyncRef(morphTargetValuesRef, morphTargetValues);

  const shouldInitializeScene = currentFile !== null;
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
    const source = sceneContextRef.current?.sourceObject;
    if (!source) return;
    applyMorphTargetValues(source, morphTargetValues);
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

  // #34: USD camera switching.
  // When activeCameraId changes we traverse the mounted scene graph looking
  // for the camera with that uuid. Found → set as the active render camera
  // and disable OrbitControls (transform is USD-driven). null → revert to
  // the free-orbit camera and re-enable controls.
  //
  // We accept both PerspectiveCamera and OrthographicCamera here — the
  // renderer only needs a `Camera`. Aspect updates are PerspectiveCamera-only.
  useEffect(() => {
    activeCameraIdRef.current = activeCameraId;
    const context = sceneContextRef.current;
    if (!context) return;

    if (!activeCameraId) {
      // Restore free-orbit camera
      activeCameraRef.current = null;
      const hasMounted = Boolean(context.mountedObject);
      context.controls.enabled = hasMounted;
      return;
    }

    // Traverse the full scene (not just mountedObject) so cameras that sit
    // in the scene root (e.g. glTF cameras added directly by GLTFLoader) are
    // also found. Match by `cameraSelectionKey` — a (display-name,
    // index-among-same-name) composite that survives variant / load-policy
    // reloads (uuids would not) and still distinguishes duplicate-named
    // cameras. The traversal order must mirror `collectAssetMetadata`'s so
    // the index counters line up.
    const found = findCameraBySelectionKey(context.scene, activeCameraId);

    if (found) {
      activeCameraRef.current = found;
      context.controls.enabled = false;
      // Sync aspect to the current viewport size so the USD camera renders
      // without distortion. Only meaningful for PerspectiveCamera; the
      // OrthographicCamera frustum is authored, not aspect-driven, so we
      // leave its left/right/top/bottom alone.
      syncPerspectiveCameraAspect(found, hostRef.current);
    } else {
      console.warn(
        `[viewer] USD camera "${activeCameraId}" not found in scene graph — falling back to free camera`,
      );
      activeCameraRef.current = null;
      const hasMounted = Boolean(context.mountedObject);
      context.controls.enabled = hasMounted;
    }
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

  useEffect(() => {
    if (!shouldInitializeScene) {
      return;
    }

    const host = hostRef.current;

    if (!host) {
      return;
    }

    const initialRenderingPreset = getPreviewRenderingPresetForExtension(
      currentFile?.extension,
    );
    const renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      logarithmicDepthBuffer: initialRenderingPreset.logarithmicDepthBuffer,
    });
    renderer.setPixelRatio(window.devicePixelRatio * renderScale);
    renderer.setSize(host.clientWidth, host.clientHeight);
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(host.clientWidth, host.clientHeight);
    labelRenderer.domElement.className = "viewport-label-layer";
    applyViewportRenderingSettings(
      renderer,
      currentFile?.extension,
      toneMappingMode,
      exposure,
    );
    // Enable the shadow pipeline up-front so toggling shadows later
    // is just a light.castShadow flip — flipping shadowMap.enabled
    // at runtime forces every material to recompile shaders.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;

    const scene = new Scene();
    // Defer applyViewportBackground until after the environment target has
    // been created so we can honor showEnvironmentBackground on first frame.

    const camera = new PerspectiveCamera(
      cameraFov,
      host.clientWidth / host.clientHeight,
      0.01,
      2000,
    );
    camera.up.set(0, 1, 0);

    const pmremGenerator = new PMREMGenerator(renderer);
    environmentTargetsRef.current = new Map();
    environmentTargetRef.current = createEnvironmentTarget(
      pmremGenerator,
      environmentPreset,
    );
    if (environmentTargetRef.current) {
      environmentTargetsRef.current.set(
        environmentPreset,
        environmentTargetRef.current,
      );
    }
    activeEnvironmentPresetRef.current = environmentPreset;
    scene.environment = environmentTargetRef.current.texture;
    scene.environmentRotation.set(0, environmentRotation, 0);
    scene.backgroundRotation.set(0, environmentRotation, 0);

    applyViewportBackground(
      renderer,
      scene,
      backgroundPreset,
      showEnvironmentBackgroundRef.current
        ? environmentTargetRef.current.texture
        : null,
    );

    const ambient = new AmbientLight(
      "#ffffff",
      DEFAULT_LIGHTING_PRESET.ambientIntensity,
    );
    const key = new DirectionalLight(
      "#ffffff",
      DEFAULT_LIGHTING_PRESET.keyIntensity,
    );
    key.position.set(...DEFAULT_LIGHTING_PRESET.keyPosition);
    // Shadow camera sized for the default scene; re-framed per asset
    // when the user enables shadows (applyShadows → updateShadowCatcher).
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 200;
    key.shadow.camera.left = -20;
    key.shadow.camera.right = 20;
    key.shadow.camera.top = 20;
    key.shadow.camera.bottom = -20;
    key.shadow.bias = -0.0005;
    ambientLightRef.current = ambient;
    keyLightRef.current = key;
    const fill = new DirectionalLight(
      "#cfd9ea",
      DEFAULT_LIGHTING_PRESET.fillIntensity,
    );
    fill.position.set(-5, 3, -4);
    fillLightRef.current = fill;
    scene.add(ambient, key, fill);
    ensureShadowCatcher(scene);

    const controls = new OrbitControls(camera, renderer.domElement);
    configureAssetControls(controls);
    controls.enableDamping = false;
    applyControlSensitivity(controls, controlSensitivity);

    // ── Initial grid ──
    const initialGrid = applyDynamicGrid(
      scene,
      DEFAULT_SCENE_DIMENSION,
      showGridRef.current,
    );
    onGridUnitChange(initialGrid.label);
    applyDynamicAxes(scene, DEFAULT_SCENE_DIMENSION, showAxesRef.current);
    camera.position.set(5, 4, 5);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.enabled = true;

    const flyCameraControls = createFlyCameraControls({
      camera,
      controls,
      domElement: renderer.domElement,
      hasActiveCamera: () => Boolean(activeCameraIdRef.current),
      hasMountedObject: () => Boolean(sceneContextRef.current?.mountedObject),
    });

    // #33: viewport picking. We track the LMB-down position on the canvas
    // and treat pointerup as a click only if the pointer barely moved.
    const CLICK_DRAG_PX = 4;
    const viewportPicker = createViewportPicker(camera, renderer.domElement);
    let clickStart: { x: number; y: number; button: number } | null = null;

    const performPick = (event: PointerEvent): void => {
      const callback = onSelectMeshRef.current;
      if (!callback) return;
      const mounted = sceneContextRef.current?.mountedObject;
      if (!mounted) {
        callback(null);
        return;
      }
      callback(viewportPicker.pickSelectionKey(mounted, event));
    };

    const pointerDownHandler = (event: PointerEvent) => {
      if (event.button === 0) {
        clickStart = {
          x: event.clientX,
          y: event.clientY,
          button: event.button,
        };
      } else {
        clickStart = null;
      }

      if (!sceneContextRef.current?.mountedObject) {
        controls.enabled = false;
        return;
      }

      if (viewerSurfaceModeRef.current === "texture") {
        controls.enabled = true;
        return;
      }

      // Asset mode + RMB → fly mode (overrides OrbitControls dolly).
      if (event.button === 2) {
        flyCameraControls.enter();
        return;
      }

      controls.enabled = event.button === 0 || event.button === 1;
    };

    const pointerUpHandler = (event: PointerEvent) => {
      if (event.button === 2 && flyCameraControls.isActive()) {
        flyCameraControls.exit();
        return;
      }
      // #33: classify as a click if LMB-up matches the LMB-down position
      // and the user is in asset mode. Texture mode keeps its 2D pan
      // gestures and has no concept of a picked mesh.
      if (
        clickStart &&
        event.button === 0 &&
        clickStart.button === 0 &&
        Math.hypot(event.clientX - clickStart.x, event.clientY - clickStart.y) <
          CLICK_DRAG_PX &&
        viewerSurfaceModeRef.current !== "texture"
      ) {
        performPick(event);
      }
      clickStart = null;
      controls.enabled = Boolean(sceneContextRef.current?.mountedObject);
    };

    // Suppress the browser context menu over the viewport so a quick
    // RMB tap doesn't pop a menu mid-fly. The mode toggle would still
    // work without this, but the visual flicker is unwelcome.
    const contextMenuHandler = (event: MouseEvent) => {
      event.preventDefault();
    };

    renderer.domElement.addEventListener("pointerdown", pointerDownHandler);
    window.addEventListener("pointerup", pointerUpHandler);
    renderer.domElement.addEventListener("contextmenu", contextMenuHandler);
    document.addEventListener(
      "pointerlockchange",
      flyCameraControls.handlePointerLockChange,
    );
    host.appendChild(renderer.domElement);
    host.appendChild(labelRenderer.domElement);

    const resizeObserver = new ResizeObserver(() => {
      const nextSize = new Vector2(host.clientWidth, host.clientHeight);
      renderer.setSize(nextSize.x, nextSize.y);
      labelRenderer.setSize(nextSize.x, nextSize.y);
      camera.aspect = nextSize.x / nextSize.y;
      camera.updateProjectionMatrix();
      // #34: keep the active USD camera's aspect in sync on resize.
      // OrthographicCamera frustums are authored and don't follow window
      // aspect, so we only re-apply this for PerspectiveCamera.
      const usdCam = activeCameraRef.current;
      if (usdCam instanceof PerspectiveCamera && nextSize.y > 0) {
        usdCam.aspect = nextSize.x / nextSize.y;
        usdCam.updateProjectionMatrix();
      }

      const fxaaState = fxaaStateRef.current;
      if (fxaaState) {
        fxaaState.composer.setSize(nextSize.x, nextSize.y);
        const pixelRatio = renderer.getPixelRatio();
        fxaaState.fxaaPass.material.uniforms.resolution.value.set(
          1 / (nextSize.x * pixelRatio),
          1 / (nextSize.y * pixelRatio),
        );
      }

      const resizeContext = sceneContextRef.current;
      const mountedObject = resizeContext?.mountedObject;
      if (
        resizeContext &&
        mountedObject &&
        viewerSurfaceModeRef.current === "texture"
      ) {
        frameMountedObject(
          resizeContext,
          mountedObject,
          viewerSurfaceModeRef.current,
          showGridRef.current,
          showAxesRef.current,
          cameraSpeedMultiplierRef.current,
          undefined,
          texturePreview3DRef.current,
        );
      }

      // Render immediately after setSize to prevent a black flash.
      // setSize clears the WebGL drawing buffer; without an immediate
      // redraw the browser composites the cleared frame before the next
      // requestAnimationFrame, causing visible flicker during sidebar resize.
      const renderCamera = activeCameraRef.current ?? camera;
      if (fxaaEnabledRef.current && fxaaStateRef.current) {
        fxaaStateRef.current.renderPass.camera = renderCamera;
        fxaaStateRef.current.composer.render();
      } else {
        renderer.render(scene, renderCamera);
      }
      labelRenderer.render(scene, renderCamera);
    });

    resizeObserver.observe(host);

    // Renderer stats HUD (FPS / draw calls / triangles / memory).
    // The stats node is populated via textContent directly so toggling
    // the overlay never costs a React re-render inside the render loop.
    let statsLastSampled = performance.now();
    let statsFrameCount = 0;
    let statsLastFps = 0;
    let resourceDiagnosticsLastSampled = 0;

    let animationFrame = 0;
    let previousRenderTimestamp = performance.now();
    const renderLoop = () => {
      animationFrame = window.requestAnimationFrame(renderLoop);
      const frameNow = performance.now();
      const deltaSeconds = Math.min(
        0.1,
        (frameNow - previousRenderTimestamp) / 1000,
      );
      previousRenderTimestamp = frameNow;

      // Fly mode integrates WASD/QE input each frame. We skip the
      // OrbitControls update entirely while flying because
      // `controls.update()` is **not** gated by `controls.enabled` —
      // it always recomputes the camera transform and calls
      // `lookAt(controls.target)`, which would clobber the mouse-look
      // orientation we set in the fly handlers. On fly exit we
      // re-sync `controls.target` to the new viewpoint so the next
      // orbit interaction pivots around what the user just framed.
      if (!flyCameraControls.update(frameNow)) {
        controls.update();
      }

      if (viewerSurfaceModeRef.current === "asset") {
        updateRuntimePreview(sceneContextRef.current, deltaSeconds);
      }

      // #34: use the active USD camera if one is selected; fall back to the
      // free-orbit camera otherwise.
      const renderCamera = activeCameraRef.current ?? camera;
      if (fxaaEnabledRef.current && fxaaStateRef.current) {
        // Swap the RenderPass camera so FXAA also honours the active USD camera.
        fxaaStateRef.current.renderPass.camera = renderCamera;
        fxaaStateRef.current.composer.render();
      } else {
        renderer.render(scene, renderCamera);
      }
      labelRenderer.render(scene, renderCamera);

      statsFrameCount += 1;
      const elapsed = frameNow - statsLastSampled;
      if (elapsed >= 250) {
        statsLastFps = (statsFrameCount * 1000) / elapsed;
        statsFrameCount = 0;
        statsLastSampled = frameNow;
        const statsNode = statsRef.current;
        if (statsNode) {
          const info = renderer.info;
          statsNode.textContent = [
            `${statsLastFps.toFixed(0)} fps`,
            `${info.render.calls} calls`,
            `${info.render.triangles.toLocaleString()} tri`,
            `${info.memory.geometries} geo / ${info.memory.textures} tex`,
          ].join("  •  ");
        }
        if (
          frameNow - resourceDiagnosticsLastSampled >=
          RESOURCE_DIAGNOSTICS_SAMPLE_MS
        ) {
          resourceDiagnosticsLastSampled = frameNow;
          publishResourceDiagnostics(sceneContextRef.current);
        }
      }
    };
    renderLoop();

    sceneContextRef.current = {
      renderer,
      scene,
      camera,
      controls,
      pmremGenerator,
      mountedObject: null,
      sourceObject: null,
      previewObject: null,
      boneOnlyPreview: false,
      cleanupUrls: [],
      cleanupCallbacks: [],
      animationRoot: null,
      mixer: null,
      clips: [],
      activeAction: null,
      mmdModel: null,
      mmdMotion: null,
      textureRegistry: new Map<string, Texture>(),
      rawMaxDimension: 1,
    };

    onFeedbackChange(neutralFeedback);
    onMetadataChange(emptyAssetMetadata);
    publishResourceDiagnostics(sceneContextRef.current);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      // Drop fly-mode listeners *before* removing the pointer
      // handlers so a teardown mid-fly doesn't leave dangling
      // mousemove/keyboard listeners on `window`.
      flyCameraControls.exit();
      renderer.domElement.removeEventListener(
        "pointerdown",
        pointerDownHandler,
      );
      window.removeEventListener("pointerup", pointerUpHandler);
      renderer.domElement.removeEventListener(
        "contextmenu",
        contextMenuHandler,
      );
      document.removeEventListener(
        "pointerlockchange",
        flyCameraControls.handlePointerLockChange,
      );
      if (sceneContextRef.current) {
        runCleanupCallbacks(sceneContextRef.current.cleanupCallbacks);
        sceneContextRef.current.cleanupCallbacks = [];
        stopAnimations(sceneContextRef.current);
        resetSceneObjects(sceneContextRef.current);
      }
      revokeUrls(sceneContextRef.current?.cleanupUrls ?? []);
      controls.dispose();
      environmentTargetsRef.current?.forEach((target) => target.dispose());
      environmentTargetsRef.current?.clear();
      environmentTargetsRef.current = null;
      environmentTargetRef.current = null;
      fxaaStateRef.current?.composer.dispose();
      fxaaStateRef.current = null;
      ambientLightRef.current = null;
      keyLightRef.current = null;
      fillLightRef.current = null;
      pmremGenerator.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      host.removeChild(labelRenderer.domElement);
      sceneContextRef.current = null;
      resetCameraRef.current = null;
      clearResourceDiagnostics();
    };
  }, [
    clearResourceDiagnostics,
    currentFile?.extension,
    onFeedbackChange,
    onGridUnitChange,
    onMetadataChange,
    publishResourceDiagnostics,
    shouldInitializeScene,
  ]);

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

    fxaaState.composer.setSize(width, height);
    fxaaState.fxaaPass.material.uniforms.resolution.value.set(
      1 / (width * pixelRatio),
      1 / (height * pixelRatio),
    );
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

    frameMountedObject(
      context,
      context.mountedObject,
      viewerSurfaceModeRef.current,
      showGridRef.current,
      showAxesRef.current,
      cameraSpeedMultiplierRef.current,
      context.rawMaxDimension,
      texturePreview3DRef.current,
    );
    resetCameraRef.current = () => {
      const targetContext = sceneContextRef.current;
      const targetObject = targetContext?.mountedObject;

      if (!targetContext || !targetObject) {
        return;
      }

      frameMountedObject(
        targetContext,
        targetObject,
        viewerSurfaceModeRef.current,
        showGridRef.current,
        showAxesRef.current,
        cameraSpeedMultiplierRef.current,
        targetContext.rawMaxDimension,
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
      onMetadataChange(emptyAssetMetadata);
      assetResourceMetricsRef.current = null;
      publishResourceDiagnostics(context);

      queueMicrotask(() => {
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
      onMetadataChange(emptyAssetMetadata);
      assetResourceMetricsRef.current = null;
      publishResourceDiagnostics(context);
      onFeedbackChange(
        buildUnsupportedPreviewFeedback(currentFile.extension, supportState),
      );
      queueMicrotask(() => {
        setLoadingStage(null);
        setDeferredTexture(null);
      });
      return;
    }

    let disposed = false;
    const loadingStartedAt = performance.now();
    const loadingClock = createLoadingStageClock("scan", loadingStartedAt);
    const reportLoadingStage = (stage: LoadingStageId) => {
      if (disposed) return;

      setLoadingStage(loadingClock.report(stage));
    };

    onFeedbackChange({
      mode: "loading",
      message: `Loading ${currentFile.fileName}`,
      warning: null,
      canResetCamera: false,
    });
    onMetadataChange(emptyAssetMetadata);
    assetResourceMetricsRef.current = null;
    publishResourceDiagnostics(context);
    queueMicrotask(() => {
      setDeferredTexture(null);
    });
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
      variantSelections,
      glbOverride: glbOverride ?? null,
      disabledOptionalLoaderPackIds,
      incompatibleOptionalLoaderPackIds,
      onStage: reportLoadingStage,
      onDeferredTexture: (snapshot) => {
        if (disposed) return;
        setDeferredTexture(snapshot.pending > 0 ? snapshot : null);
      },
      onWarning: pushRuntimeWarning,
    })
      .then(
        async ({
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
        }) => {
          if (disposed) {
            runCleanupCallbacks(cleanupCallbacks);
            disposeObject(object);
            revokeUrls(cleanupUrls);
            return;
          }

          reportLoadingStage("scene");
          context.scene.add(object);
          context.mountedObject = object;
          context.sourceObject = object;
          context.boneOnlyPreview = false;
          context.animationRoot = null;
          context.cleanupUrls = cleanupUrls;
          context.cleanupCallbacks = cleanupCallbacks;
          applyPreviewLightingPreset(lighting, {
            ambient: ambientLightRef.current,
            key: keyLightRef.current,
            fill: fillLightRef.current,
          });
          await syncMmdPreviewSpecularDirection(mmdModel, keyLightRef.current);
          if (disposed) {
            context.scene.remove(object);
            context.mountedObject = null;
            context.sourceObject = null;
            runCleanupCallbacks(cleanupCallbacks);
            context.cleanupCallbacks = [];
            disposeObject(object);
            revokeUrls(cleanupUrls);
            context.cleanupUrls = [];
            return;
          }
          if (rendering) {
            applyPreviewRenderingPreset(context.renderer, rendering);
          }
          const normalization = skipScaleNormalization
            ? (() => {
                const maxDimension = getObjectMaxDimension(object);
                return {
                  applied: false,
                  factor: 1,
                  originalMaxDimension: maxDimension,
                  normalizedMaxDimension: maxDimension,
                  originalScale: null,
                };
              })()
            : normalizeObjectScale(object);
          if (normalization.applied && normalization.originalScale) {
            scaleNormalizationRef.current = {
              applied: true,
              originalScale: normalization.originalScale,
            };
          } else {
            scaleNormalizationRef.current = null;
          }
          onScaleNormalizationChange?.({
            applied: normalization.applied,
            factor: normalization.factor,
          });
          // Store the original (pre-normalization) dimension so camera sensitivity
          // can reflect the asset's real world scale rather than the clamped size.
          context.rawMaxDimension =
            normalization.originalMaxDimension > 0
              ? normalization.originalMaxDimension
              : normalization.normalizedMaxDimension;
          const gridConfig = applyDynamicGrid(
            context.scene,
            normalization.normalizedMaxDimension,
            showGrid,
          );
          onGridUnitChange(gridConfig.label);
          applyDynamicAxes(
            context.scene,
            normalization.normalizedMaxDimension,
            showAxesRef.current,
          );
          applyDisplayMode(object, displayModeRef.current);
          applyBackfaceCulling(object, backfaceCullingRef.current);
          applyTextureFilter(object, textureFilterModeRef.current);
          applyVertexColors(object, showVertexColorsRef.current);
          applyMorphTargetValues(object, morphTargetValuesRef.current);
          applyShadows(
            context.scene,
            object,
            keyLightRef.current,
            showShadowsRef.current,
          );
          frameMountedObject(
            context,
            object,
            viewerSurfaceModeRef.current,
            showGridRef.current,
            showAxesRef.current,
            cameraSpeedMultiplierRef.current,
            context.rawMaxDimension,
            texturePreview3DRef.current,
          );
          setActivePreviewPath(currentFile.path);
          setOverlayMode("ready");
          reportLoadingStage("ui");
          // Collect metadata before adding SkeletonHelper children so the
          // bone helper meshes don't get counted as model meshes/nodes.
          const metadataCollection = collectAssetMetadata(
            object,
            currentFile,
            clips,
            formatVersion,
            mmdMetadata,
          );
          // Issue #98: surface the viewer-side classification (mesh /
          // pointCloud / gaussianSplat) so the Detail panel can label the
          // asset and switch renderer-appropriate UI.
          metadataCollection.metadata.assetKind = assetKind;
          const isBoneOnlyPreview =
            metadataCollection.metadata.meshCount === 0 &&
            metadataCollection.metadata.hasBones === true;
          context.boneOnlyPreview = isBoneOnlyPreview;
          context.animationRoot = object;
          context.textureRegistry = metadataCollection.textureRegistry;
          assetResourceMetricsRef.current = collectAssetResourceMetrics(
            metadataCollection.metadata,
          );
          onMetadataChange(metadataCollection.metadata);
          publishResourceDiagnostics(context);
          applySkeletonHelpers(
            context.scene,
            object,
            showSkeletonRef.current,
            showLocalAxisRef.current,
            showJointNamesRef.current,
          );
          applyBoundingBoxHelpers(
            context.scene,
            object,
            showBoundingBoxesRef.current,
          );
          applyNormalHelpers(context.scene, object, showNormalsRef.current);
          // #32: Apply purpose visibility immediately after mount so that
          // proxy/guide meshes are hidden by default without waiting for the
          // purposeModes prop to change (the useEffect won't re-fire because
          // ref mutations are transparent to React's dependency tracking).
          applyPurposeVisibility(object, purposeModesRef.current);

          context.clips = clips;
          context.mmdModel = mmdModel ?? null;
          context.mmdMotion = null;
          if (clips.length > 0) {
            context.mixer = new AnimationMixer(context.animationRoot ?? object);
            const activated = activateClip(context, 0, true);
            setAnimationState({
              clipNames: clips.map(getClipLabel),
              activeClipIndex: activated?.clipIndex ?? 0,
              currentTime: activated?.currentTime ?? 0,
              duration: activated?.duration ?? clips[0]?.duration ?? 0,
              isPlaying: activated?.isPlaying ?? false,
            });
          } else {
            setAnimationState(emptyAnimationState);
          }

          resetCameraRef.current = () => {
            const targetContext = sceneContextRef.current;
            const targetObject = targetContext?.mountedObject;

            if (!targetContext || !targetObject) {
              return;
            }

            frameMountedObject(
              targetContext,
              targetObject,
              viewerSurfaceModeRef.current,
              showGridRef.current,
              showAxesRef.current,
              cameraSpeedMultiplierRef.current,
              targetContext.rawMaxDimension,
              texturePreview3DRef.current,
            );
          };

          // #34: if a USD camera was already active (e.g. the scene was
          // reloaded due to a variant / load-policy change), re-run the
          // camera lookup now that the new object is in the scene.
          // activeCameraRef was cleared by the file-change guard above, so
          // the render loop is already back on the free camera; traversing
          // here restores the override without waiting for another prop
          // change (which would never come because activeCameraId did not
          // change).
          //
          // After a real re-extraction Three.js mints fresh uuids, so we
          // match by `cameraSelectionKey` (display-name + dup-index) — that
          // key is computed from authored data and remains stable across
          // reloads as long as the camera order in the scene graph does
          // not change.
          const desiredCameraId = activeCameraIdRef.current;
          if (desiredCameraId) {
            const reFound = findCameraBySelectionKey(
              context.scene,
              desiredCameraId,
            );
            if (reFound) {
              activeCameraRef.current = reFound;
              context.controls.enabled = false;
              syncPerspectiveCameraAspect(reFound, hostRef.current);
            } else {
              // Camera not present in the reloaded asset (typical after a
              // variant / load-policy change because Three.js mints fresh
              // uuids on every load). Clear the stale id locally so fly
              // mode (which checks `activeCameraIdRef`) becomes available
              // again, and bubble the reset to App.tsx so the React state +
              // UI ("Free Orbit"/"Active" badges) match the renderer.
              console.warn(
                `[viewer] USD camera id "${desiredCameraId}" not found after reload — free camera restored`,
              );
              activeCameraIdRef.current = null;
              onActiveCameraResetRef.current?.();
            }
          }

          const scaleWarning = getScaleWarning(object, normalization);
          readyFeedbackBase = {
            message: `Preview ready: ${currentFile.fileName}`,
            warnings: [
              scaleWarning,
              isBoneOnlyPreview
                ? "Bone-only preview: no mesh geometry was found. Use the Skeleton overlay to show the rig."
                : null,
              ...warnings,
            ],
          };
          onFeedbackChange(
            buildReadyPreviewFeedback(readyFeedbackBase, runtimeWarnings),
          );
          setLoadingStage(null);
        },
      )
      .catch((error: unknown) => {
        if (disposed) {
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
        onMetadataChange(
          mode === "missingReference" && currentFile
            ? buildMissingReferenceMetadata(
                currentFile,
                missingReferenceError.formatVersion ?? null,
                missingReferenceError.missingPaths ?? [],
                missingReferenceError.unresolvedImages ?? [],
              )
            : emptyAssetMetadata,
        );
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
      setLoadingStage(null);
      setDeferredTexture(null);
      runCleanupCallbacks(context.cleanupCallbacks);
      context.cleanupCallbacks = [];
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
    onScaleNormalizationChange,
    showGrid,
    usdLoadPolicy,
    variantSelections,
    glbOverride,
    disabledOptionalLoaderPackIds,
    incompatibleOptionalLoaderPackIds,
    publishResourceDiagnostics,
  ]);

  useEffect(() => {
    if (!mmdMotionRequest) {
      return;
    }

    const context = sceneContextRef.current;
    const model = context?.mmdModel;
    const runtime = model?.runtime;

    if (!context || !model || !runtime) {
      onFeedbackChange({
        mode: "loadFailed",
        message: "VMD motion was not loaded.",
        warning:
          "VMD motion can only be loaded after an MMD model with runtime support is ready.",
        canResetCamera: false,
      });
      return;
    }

    let disposed = false;
    const motionFile = mmdMotionRequest.file;
    onFeedbackChange({
      mode: "ready",
      message: `Loading MMD motion: ${motionFile.fileName}`,
      warning: null,
      canResetCamera: true,
    });

    loadMmdMotion(motionFile)
      .then((motion) => {
        if (disposed) {
          return;
        }

        runtime.setAnimation(motion.animation, model.mesh);
        runtime.tick(0, {
          mesh: model.mesh,
          ik: true,
          physics: false,
        });
        syncMmdMaterialRenderStates(model.root ?? model.mesh);

        const duration = Math.max(motion.duration, 1 / 30);
        context.mmdMotion = {
          animation: motion.animation,
          duration,
          currentTime: 0,
          label: motion.label,
        };
        setAnimationState({
          clipNames: [motion.label],
          activeClipIndex: 0,
          currentTime: 0,
          duration,
          isPlaying: true,
        });
        onFeedbackChange({
          mode: "ready",
          message: `Preview ready: ${currentFile?.fileName ?? "MMD model"}`,
          warning: null,
          canResetCamera: true,
        });
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Failed to load VMD motion.";
        onFeedbackChange({
          mode: "ready",
          message: `Preview ready: ${currentFile?.fileName ?? "MMD model"}`,
          warning: message,
          canResetCamera: true,
        });
      });

    return () => {
      disposed = true;
    };
  }, [currentFile?.fileName, mmdMotionRequest, onFeedbackChange]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.sourceObject) {
      return;
    }

    applyDisplayMode(context.sourceObject, displayMode);
  }, [displayMode]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.sourceObject) {
      return;
    }

    applyUnlitMaterial(context.sourceObject, showUnlit);
  }, [showUnlit]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.sourceObject) {
      return;
    }

    applyBackfaceCulling(context.sourceObject, backfaceCulling);
  }, [backfaceCulling]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.sourceObject) {
      return;
    }

    applyTextureFilter(context.sourceObject, textureFilterMode);
  }, [textureFilterMode]);

  useEffect(() => {
    const context = sceneContextRef.current;
    if (!context) {
      return;
    }
    applyShadows(
      context.scene,
      context.sourceObject,
      keyLightRef.current,
      showShadows,
    );
  }, [showShadows]);

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
      const [
        { EffectComposer },
        { RenderPass },
        { ShaderPass },
        { FXAAShader },
      ] = await Promise.all([
        import("three/examples/jsm/postprocessing/EffectComposer.js"),
        import("three/examples/jsm/postprocessing/RenderPass.js"),
        import("three/examples/jsm/postprocessing/ShaderPass.js"),
        import("three/examples/jsm/shaders/FXAAShader.js"),
      ]);
      if (cancelled) return;
      const host = hostRef.current;
      if (!host) return;
      const composer = new EffectComposer(context.renderer);
      const renderPass = new RenderPass(context.scene, context.camera);
      composer.addPass(renderPass);
      const fxaaPass = new ShaderPass(FXAAShader);
      const pixelRatio = context.renderer.getPixelRatio();
      (fxaaPass.material.uniforms.resolution.value as Vector2).set(
        1 / (host.clientWidth * pixelRatio),
        1 / (host.clientHeight * pixelRatio),
      );
      composer.addPass(fxaaPass);
      composer.setSize(host.clientWidth, host.clientHeight);
      fxaaStateRef.current = {
        composer,
        fxaaPass: fxaaPass as unknown as FxaaComposerState["fxaaPass"],
        renderPass,
      };
    })();
    return () => {
      cancelled = true;
    };
  }, [fxaaEnabled]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.sourceObject) {
      return;
    }

    applySkeletonHelpers(
      context.scene,
      context.sourceObject,
      showSkeleton,
      showLocalAxis,
      showJointNames,
    );
  }, [showSkeleton, showLocalAxis, showJointNames]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.sourceObject) {
      return;
    }

    applyBoundingBoxHelpers(
      context.scene,
      context.sourceObject,
      showBoundingBoxes,
    );
  }, [showBoundingBoxes]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.sourceObject) {
      return;
    }

    applyNormalHelpers(context.scene, context.sourceObject, showNormals);
  }, [showNormals]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.sourceObject) {
      return;
    }

    applyVertexColors(context.sourceObject, showVertexColors);
  }, [showVertexColors]);

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
    resetCameraRef.current?.();
  }, [resetVersion]);

  useEffect(() => {
    if (cancelScaleNormalizationVersion === 0) return;
    const context = sceneContextRef.current;
    const object = context?.mountedObject ?? null;
    const info = scaleNormalizationRef.current;
    if (!object || !info?.applied) return;
    cancelScaleNormalization(object, info.originalScale);
    scaleNormalizationRef.current = null;
    onScaleNormalizationChange?.({ applied: false, factor: 1 });
    onFeedbackChange({
      mode: "ready",
      message: `Scale normalization canceled.`,
      warning: null,
      canResetCamera: true,
    });
  }, [
    cancelScaleNormalizationVersion,
    onScaleNormalizationChange,
    onFeedbackChange,
  ]);

  useEffect(() => {
    if (!viewportShortcutCommand) {
      return;
    }

    const context = sceneContextRef.current;
    if (!context) {
      return;
    }

    const mountedObject = context.mountedObject;
    const sourceObject = context.sourceObject;

    switch (viewportShortcutCommand.kind) {
      case "focusSelected": {
        if (!sourceObject || viewerSurfaceModeRef.current !== "asset") {
          return;
        }
        const target = findObjectBySelectionKey(
          sourceObject,
          viewportShortcutCommand.selectionKey,
        );
        if (target) {
          configureAssetControls(context.controls);
          frameObjectBounds(context, target, cameraSpeedMultiplierRef.current);
        }
        return;
      }
      case "frameAll":
      case "resetView":
        if (!mountedObject) {
          return;
        }
        frameMountedObject(
          context,
          mountedObject,
          viewerSurfaceModeRef.current,
          showGridRef.current,
          showAxesRef.current,
          cameraSpeedMultiplierRef.current,
          context.rawMaxDimension,
          texturePreview3DRef.current,
        );
        return;
      case "hideSelected": {
        if (!sourceObject || viewerSurfaceModeRef.current !== "asset") {
          return;
        }
        const target = findObjectBySelectionKey(
          sourceObject,
          viewportShortcutCommand.selectionKey,
        );
        if (target) {
          setSubtreeManualHidden(target, true);
          applyManualVisibility(sourceObject);
        }
        return;
      }
      case "isolateSelected": {
        if (!sourceObject || viewerSurfaceModeRef.current !== "asset") {
          return;
        }
        const target = findObjectBySelectionKey(
          sourceObject,
          viewportShortcutCommand.selectionKey,
        );
        if (target) {
          isolateObject(sourceObject, target);
          applyPurposeVisibility(sourceObject, purposeModesRef.current);
        }
        return;
      }
      case "unhideAll":
        if (!sourceObject || viewerSurfaceModeRef.current !== "asset") {
          return;
        }
        setSubtreeManualHidden(sourceObject, false);
        applyPurposeVisibility(sourceObject, purposeModesRef.current);
        return;
    }
  }, [viewportShortcutCommand]);

  useEffect(() => {
    if (!cameraPresetRequest) {
      return;
    }

    const context = sceneContextRef.current;
    const object = context?.mountedObject;
    if (!context || !object || viewerSurfaceModeRef.current !== "asset") {
      return;
    }

    configureAssetControls(context.controls);
    applyPresetView(
      context.camera,
      context.controls,
      object,
      cameraPresetRequest.preset,
    );
    context.controls.enabled = true;
  }, [cameraPresetRequest]);

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
