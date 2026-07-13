import { useEffect, type MutableRefObject, type RefObject } from "react";
import {
  AmbientLight,
  DirectionalLight,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Texture,
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
  type SceneContext,
} from "../viewer";
import { applyControlSensitivity, configureAssetControls } from "./camera";
import { createEnvironmentTarget } from "./environment";
import type { FxaaComposerState } from "./fxaa";
import { createFlyCameraControls } from "./flyCamera";
import { createViewportPicker } from "./selection";
import {
  applyViewportBackground,
  applyViewportRenderingSettings,
} from "./renderSettings";
import {
  createViewportRuntimeStatsState,
  tickViewportFrame,
} from "./viewportFrame";
import { createViewportPointerInput } from "./viewportPointerInput";
import { applyViewportResize } from "./viewportResize";
import { disposeViewportScene } from "./viewportSceneDispose";
import type {
  BackgroundPreset,
  EnvironmentPreset,
  ToneMappingMode,
  ViewerSurfaceMode,
} from "../types/viewer";
import type { AssetViewportCallbackProps } from "./types";

type ViewportSceneLifecycleCallbacks = Pick<
  AssetViewportCallbackProps,
  | "onFeedbackChange"
  | "onGridUnitChange"
  | "onMetadataChange"
  | "onPackMetadataChange"
>;

type ViewportSceneLifecycleOptions = {
  activeCameraIdRef: MutableRefObject<string | null | undefined>;
  activeCameraRef: MutableRefObject<import("three").Camera | null>;
  ambientLightRef: MutableRefObject<AmbientLight | null>;
  backgroundPresetRef: MutableRefObject<BackgroundPreset>;
  cameraFovRef: MutableRefObject<number>;
  cameraSpeedMultiplierRef: MutableRefObject<number>;
  callbacks: ViewportSceneLifecycleCallbacks;
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

/** WebGLRenderer constructor-only setting that forces a full scene teardown. */
export function getRendererLifetimeBoundary(
  extension: string | undefined,
): boolean {
  return getPreviewRenderingPresetForExtension(extension)
    .logarithmicDepthBuffer;
}

export function useViewportSceneLifecycle({
  activeCameraIdRef,
  activeCameraRef,
  activeEnvironmentPresetRef,
  ambientLightRef,
  backgroundPresetRef,
  cameraFovRef,
  cameraSpeedMultiplierRef,
  callbacks,
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
  const {
    onFeedbackChange,
    onGridUnitChange,
    onMetadataChange,
    onPackMetadataChange,
  } = callbacks;
  const rendererLifetimeBoundary =
    getRendererLifetimeBoundary(currentFileExtension);

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

    const viewportPicker = createViewportPicker(camera, renderer.domElement);
    const { contextMenuHandler, pointerDownHandler, pointerUpHandler } =
      createViewportPointerInput({
        controls,
        flyCameraControls,
        getMountedObject: () => sceneContextRef.current?.mountedObject,
        getSelectMesh: () => onSelectMeshRef.current,
        getViewerSurfaceMode: () => viewerSurfaceModeRef.current,
        picker: viewportPicker,
      });

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
      applyViewportResize({
        activeCamera: activeCameraRef.current,
        cameraSpeedMultiplier: cameraSpeedMultiplierRef.current,
        defaultCamera: camera,
        fxaaEnabled: fxaaEnabledRef.current,
        fxaaState: fxaaStateRef.current,
        host,
        labelRenderer,
        renderer,
        scene,
        sceneContext: sceneContextRef.current,
        showAxes: showAxesRef.current,
        showGrid: showGridRef.current,
        texturePreview3D: texturePreview3DRef.current,
        viewerSurfaceMode: viewerSurfaceModeRef.current,
      });
    });

    resizeObserver.observe(host);

    const statsState = createViewportRuntimeStatsState();

    let animationFrame = 0;
    let previousRenderTimestamp = performance.now();
    const renderLoop = () => {
      animationFrame = window.requestAnimationFrame(renderLoop);
      const frameNow = performance.now();
      previousRenderTimestamp = tickViewportFrame({
        activeCamera: activeCameraRef.current,
        controls,
        defaultCamera: camera,
        flyCameraControls,
        frameNow,
        fxaaEnabled: fxaaEnabledRef.current,
        fxaaState: fxaaStateRef.current,
        labelRenderer,
        previousRenderTimestamp,
        publishResourceDiagnostics,
        renderer,
        scene,
        sceneContext: sceneContextRef.current,
        statsNode: statsRef.current,
        statsState,
        viewerSurfaceMode: viewerSurfaceModeRef.current,
      });
      // GenerateMeshBVHWorker transfers the geometry's CPU ArrayBuffers. Keep
      // this after rendering so a newly mounted geometry receives at least one
      // GPU upload before BVH preparation can temporarily neuter those arrays.
      viewportPicker.syncMountedObject(
        sceneContextRef.current?.mountedObject ?? null,
      );
      void viewportPicker.flushPendingGpuPick({
        camera: activeCameraRef.current ?? camera,
        renderer,
        scene,
      });
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
      packRuntime: null,
      mmdModel: null,
      mmdMotion: null,
      textureRegistry: new Map<string, Texture>(),
      rawMaxDimension: 1,
    };

    onFeedbackChange(neutralFeedback);
    onMetadataChange(null);
    onPackMetadataChange(null);
    publishResourceDiagnostics(sceneContextRef.current);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      flyCameraControls.exit();
      viewportPicker.dispose();
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
      disposeViewportScene({
        ambientLightRef,
        clearResourceDiagnostics,
        controls,
        environmentTargetRef,
        environmentTargetsRef,
        fillLightRef,
        fxaaStateRef,
        host,
        keyLightRef,
        labelRenderer,
        pmremGenerator,
        renderer,
        resetCameraRef,
        sceneContextRef,
      });
    };
    // The scene lifecycle mirrors the former AssetViewport effect: props that
    // must update live (tone mapping, exposure, grid, etc.) are read through
    // refs or handled by sibling effects in AssetViewport. This effect only
    // follows the WebGLRenderer constructor boundary — logarithmicDepthBuffer —
    // so switching among default formats (.glb/.fbx/.obj/…) reuses the same
    // renderer instead of tearing down PMREM and controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    callbacks,
    clearResourceDiagnostics,
    publishResourceDiagnostics,
    rendererLifetimeBoundary,
    shouldInitializeScene,
  ]);
}
