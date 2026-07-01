import { useEffect, type MutableRefObject, type RefObject } from "react";
import {
  AmbientLight,
  DirectionalLight,
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
import {
  DEFAULT_LIGHTING_PRESET,
  DEFAULT_SCENE_DIMENSION,
  applyDynamicAxes,
  applyDynamicGrid,
  ensureShadowCatcher,
  getPreviewRenderingPresetForExtension,
  neutralFeedback,
  resetSceneObjects,
  revokeUrls,
  stopAnimations,
  type SceneContext,
} from "../viewer";
import type { AssetMetadata } from "../components/assetMetadata";
import { emptyAssetMetadata } from "../components/assetMetadata";
import type { EnvironmentPreset } from "../types/viewer";
import { syncPerspectiveCameraAspect } from "./camera";
import {
  applyControlSensitivity,
  configureAssetControls,
  frameMountedObject,
} from "./camera";
import { createEnvironmentTarget } from "./environment";
import type { FxaaComposerState } from "./fxaa";
import { createFlyCameraControls } from "./flyCamera";
import { RESOURCE_DIAGNOSTICS_SAMPLE_MS } from "./resourceDiagnostics";
import { createViewportPicker } from "./selection";
import {
  applyViewportBackground,
  applyViewportRenderingSettings,
  runCleanupCallbacks,
} from "./renderSettings";
import { updateRuntimePreview } from "./previewSupport";
import type {
  BackgroundPreset,
  ToneMappingMode,
  ViewerFeedback,
  ViewerSurfaceMode,
} from "../types/viewer";

type ViewportSceneLifecycleOptions = {
  activeCameraIdRef: MutableRefObject<string | null | undefined>;
  activeCameraRef: MutableRefObject<import("three").Camera | null>;
  ambientLightRef: MutableRefObject<AmbientLight | null>;
  backgroundPresetRef: MutableRefObject<BackgroundPreset>;
  cameraFovRef: MutableRefObject<number>;
  cameraSpeedMultiplierRef: MutableRefObject<number>;
  clearResourceDiagnostics: () => void;
  controlSensitivityRef: MutableRefObject<number>;
  currentFileExtension?: string;
  environmentPresetRef: MutableRefObject<EnvironmentPreset>;
  environmentRotationRef: MutableRefObject<number>;
  environmentTargetRef: MutableRefObject<WebGLRenderTarget | null>;
  environmentTargetsRef: MutableRefObject<Map<
    EnvironmentPreset,
    WebGLRenderTarget
  > | null>;
  activeEnvironmentPresetRef: MutableRefObject<EnvironmentPreset>;
  exposureRef: MutableRefObject<number>;
  fillLightRef: MutableRefObject<DirectionalLight | null>;
  fxaaEnabledRef: MutableRefObject<boolean>;
  fxaaStateRef: MutableRefObject<FxaaComposerState | null>;
  hostRef: RefObject<HTMLDivElement | null>;
  keyLightRef: MutableRefObject<DirectionalLight | null>;
  onFeedbackChange: (feedback: ViewerFeedback) => void;
  onGridUnitChange: (label: string) => void;
  onMetadataChange: (metadata: AssetMetadata | null) => void;
  onSelectMeshRef: MutableRefObject<
    ((meshName: string | null) => void) | undefined
  >;
  publishResourceDiagnostics: (context: SceneContext | null) => void;
  renderScaleRef: MutableRefObject<number>;
  resetCameraRef: MutableRefObject<(() => void) | null>;
  sceneContextRef: MutableRefObject<SceneContext | null>;
  shouldInitializeScene: boolean;
  showAxesRef: MutableRefObject<boolean>;
  showEnvironmentBackgroundRef: MutableRefObject<boolean>;
  showGridRef: MutableRefObject<boolean>;
  statsRef: RefObject<HTMLDivElement | null>;
  texturePreview3DRef: MutableRefObject<boolean>;
  toneMappingModeRef: MutableRefObject<ToneMappingMode>;
  viewerSurfaceModeRef: MutableRefObject<ViewerSurfaceMode>;
};

export function useViewportSceneLifecycle({
  activeCameraIdRef,
  activeCameraRef,
  activeEnvironmentPresetRef,
  ambientLightRef,
  backgroundPresetRef,
  cameraFovRef,
  cameraSpeedMultiplierRef,
  clearResourceDiagnostics,
  controlSensitivityRef,
  currentFileExtension,
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
  onFeedbackChange,
  onGridUnitChange,
  onMetadataChange,
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
}: ViewportSceneLifecycleOptions): void {
  useEffect(() => {
    if (!shouldInitializeScene) {
      return;
    }

    const host = hostRef.current;

    if (!host) {
      return;
    }

    const initialRenderingPreset =
      getPreviewRenderingPresetForExtension(currentFileExtension);
    const renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      logarithmicDepthBuffer: initialRenderingPreset.logarithmicDepthBuffer,
    });
    renderer.setPixelRatio(window.devicePixelRatio * renderScaleRef.current);
    renderer.setSize(host.clientWidth, host.clientHeight);
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(host.clientWidth, host.clientHeight);
    labelRenderer.domElement.className = "viewport-label-layer";
    applyViewportRenderingSettings(
      renderer,
      currentFileExtension,
      toneMappingModeRef.current,
      exposureRef.current,
    );
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;

    const scene = new Scene();
    const camera = new PerspectiveCamera(
      cameraFovRef.current,
      host.clientWidth / host.clientHeight,
      0.01,
      2000,
    );
    camera.up.set(0, 1, 0);

    const pmremGenerator = new PMREMGenerator(renderer);
    environmentTargetsRef.current = new Map();
    const initialEnvironmentPreset = environmentPresetRef.current;
    environmentTargetRef.current = createEnvironmentTarget(
      pmremGenerator,
      initialEnvironmentPreset,
    );
    if (environmentTargetRef.current) {
      environmentTargetsRef.current.set(
        initialEnvironmentPreset,
        environmentTargetRef.current,
      );
      scene.environment = environmentTargetRef.current.texture;
    }
    activeEnvironmentPresetRef.current = initialEnvironmentPreset;
    scene.environmentRotation.set(0, environmentRotationRef.current, 0);
    scene.backgroundRotation.set(0, environmentRotationRef.current, 0);

    applyViewportBackground(
      renderer,
      scene,
      backgroundPresetRef.current,
      showEnvironmentBackgroundRef.current
        ? (environmentTargetRef.current?.texture ?? null)
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
    applyControlSensitivity(controls, controlSensitivityRef.current);

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
      const usdCam = activeCameraRef.current;
      if (usdCam instanceof PerspectiveCamera && nextSize.y > 0) {
        syncPerspectiveCameraAspect(usdCam, host);
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

      if (!flyCameraControls.update(frameNow)) {
        controls.update();
      }

      if (viewerSurfaceModeRef.current === "asset") {
        updateRuntimePreview(sceneContextRef.current, deltaSeconds);
      }

      const renderCamera = activeCameraRef.current ?? camera;
      if (fxaaEnabledRef.current && fxaaStateRef.current) {
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
    // The scene lifecycle mirrors the former AssetViewport effect: props that
    // must update live are read through refs, while this effect only follows
    // the renderer lifetime boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    clearResourceDiagnostics,
    currentFileExtension,
    onFeedbackChange,
    onGridUnitChange,
    onMetadataChange,
    publishResourceDiagnostics,
    shouldInitializeScene,
  ]);
}
