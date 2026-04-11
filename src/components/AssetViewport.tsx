import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationMixer,
  BackSide,
  BoxGeometry,
  Color,
  DirectionalLight,
  LinearToneMapping,
  Mesh,
  MeshBasicMaterial,
  MOUSE,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  ReinhardToneMapping,
  Scene,
  SphereGeometry,
  Texture,
  type ToneMapping,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SelectedFile } from "../lib/files";
import {
  type CameraPreset,
  type DisplayMode,
  type MissingReferenceError,
  type SceneContext,
  type TextureFilterMode,
  type TextureViewMode,
  type ViewerFeedback,
  type ViewerSurfaceMode,
  implementedPreviewExtensions,
  neutralFeedback,
  DEFAULT_SCENE_DIMENSION,
  revokeUrls,
  disposeObject,
  stopAnimations,
  resetSceneObjects,
  applyInitialView,
  applyPresetView,
  applyControlsSensitivity,
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
  applyBoundingBoxHelpers,
  applyNormalHelpers,
  applyShadows,
  ensureShadowCatcher,
  loadPreviewObject,
  collectAssetMetadata,
  buildMissingReferenceMetadata,
  createTextureViewerObject,
  getClipLabel,
  activateClip,
  setActionPlayback,
  seekAction,
  stepAction,
  disposePreviewObject,
} from "../viewer";
import type { ViewerMode } from "../viewer";
import { AnimationBar } from "./AnimationBar";
import { emptyAssetMetadata, type AssetMetadata } from "./assetMetadata";
import { emptyAnimationState, type AnimationState } from "./animation";
import { ViewerStatePanel } from "./ViewerStatePanel";

export type {
  ViewerFeedback,
  DisplayMode,
  ViewerSurfaceMode,
  TextureViewMode,
  TextureFilterMode,
  CameraPreset,
};
export type BackgroundPreset = "gray" | "charcoal" | "light";

export type CameraPresetRequest = {
  preset: CameraPreset;
  version: number;
};

const backgroundPresetColors: Record<BackgroundPreset, string> = {
  gray: "#717781",
  charcoal: "#0f1011",
  light: "#d9dee7",
};

function applyViewportBackground(
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

export type EnvironmentPreset = "studio" | "neutral" | "outdoor";

export type ToneMappingMode = "linear" | "aces" | "reinhard";

const toneMappingModeMap: Record<ToneMappingMode, ToneMapping> = {
  linear: LinearToneMapping,
  aces: ACESFilmicToneMapping,
  reinhard: ReinhardToneMapping,
};

const INITIAL_GRID_NAME = "__yw_initial_grid";
const AXES_HELPER_NAME = "__yw_axes_helper";

function configureAssetControls(controls: OrbitControls) {
  controls.enableRotate = true;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.mouseButtons.LEFT = MOUSE.ROTATE;
  controls.mouseButtons.MIDDLE = MOUSE.PAN;
  controls.mouseButtons.RIGHT = MOUSE.DOLLY;
}

function applyControlSensitivity(
  controls: OrbitControls,
  sensitivity: number,
) {
  // Clamp so users can't lock themselves out with a zero multiplier.
  const safe = Math.max(sensitivity, 0.05);
  controls.rotateSpeed = safe;
  controls.panSpeed = safe;
  controls.zoomSpeed = safe;
}

function configureTextureControls(controls: OrbitControls) {
  controls.enableRotate = false;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.mouseButtons.LEFT = MOUSE.PAN;
  controls.mouseButtons.MIDDLE = MOUSE.PAN;
  controls.mouseButtons.RIGHT = MOUSE.DOLLY;
}

function syncGridVisibility(
  context: SceneContext,
  showGrid: boolean,
  viewerSurfaceMode: ViewerSurfaceMode,
  forceAssetGrid = false,
) {
  const grid = context.scene.getObjectByName(INITIAL_GRID_NAME);

  if (grid) {
    grid.visible =
      showGrid && (forceAssetGrid || viewerSurfaceMode === "asset");
  }
}

function syncAxesVisibility(
  context: SceneContext,
  showAxes: boolean,
  viewerSurfaceMode: ViewerSurfaceMode,
  forceAssetAxes = false,
) {
  const axes = context.scene.getObjectByName(AXES_HELPER_NAME);

  if (axes) {
    axes.visible =
      showAxes && (forceAssetAxes || viewerSurfaceMode === "asset");
  }
}

function frameMountedObject(
  context: SceneContext,
  object: NonNullable<SceneContext["mountedObject"]>,
  viewerSurfaceMode: ViewerSurfaceMode,
  showGrid: boolean,
  showAxes: boolean,
  sensitivityMultiplier = 1,
  rawMaxDimension?: number,
) {
  syncGridVisibility(context, showGrid, viewerSurfaceMode);
  syncAxesVisibility(context, showAxes, viewerSurfaceMode);

  if (viewerSurfaceMode === "texture") {
    configureTextureControls(context.controls);
    applyTextureView(context.camera, context.controls, object);
    // Use neutral (dim=1) sensitivity for texture pan/zoom so the hidden
    // asset's original size does not bleed into texture controls, but still
    // honour the user's manual camera-speed multiplier.
    applyControlsSensitivity(context.controls, 1, sensitivityMultiplier);
    context.controls.enabled = true;
    return;
  }

  configureAssetControls(context.controls);
  applyInitialView(
    context.camera,
    context.controls,
    object,
    sensitivityMultiplier,
    rawMaxDimension,
  );
  context.controls.enabled = true;
}

type AssetViewportProps = {
  currentFile: SelectedFile | null;
  displayMode: DisplayMode;
  backgroundPreset: BackgroundPreset;
  onFeedbackChange: (feedback: ViewerFeedback) => void;
  onMetadataChange: (metadata: AssetMetadata | null) => void;
  selectedTextureId: string | null;
  viewerSurfaceMode: ViewerSurfaceMode;
  textureViewMode: TextureViewMode;
  textureExposure: number;
  textureBlackPoint: number;
  textureWhitePoint: number;
  textureTileCount: number;
  textureGamma: number;
  resetVersion: number;
  showGrid: boolean;
  showAxes: boolean;
  showSkeleton: boolean;
  showBoundingBoxes: boolean;
  showNormals: boolean;
  showVertexColors: boolean;
  showEnvironmentBackground: boolean;
  environmentRotation: number;
  backfaceCulling: boolean;
  textureFilterMode: TextureFilterMode;
  cameraPresetRequest: CameraPresetRequest | null;
  controlSensitivity: number;
  cameraFov: number;
  renderScale: number;
  showShadows: boolean;
  fxaaEnabled: boolean;
  showRendererStats: boolean;
  toneMappingMode: ToneMappingMode;
  exposure: number;
  onGridUnitChange: (label: string) => void;
  environmentPreset: EnvironmentPreset;
  /** Multiplier applied on top of the auto-computed sensitivity (0.25 – 4). */
  cameraSpeedMultiplier: number;
};

function disposeEnvironmentScene(scene: Scene) {
  scene.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    child.geometry.dispose();

    if (Array.isArray(child.material)) {
      for (const material of child.material) {
        material.dispose();
      }
      return;
    }

    child.material.dispose();
  });
}

function buildEnvironmentScene(preset: EnvironmentPreset) {
  const scene = new Scene();
  const shell = new Mesh(
    new SphereGeometry(40, 40, 20),
    new MeshBasicMaterial({ color: "#121418", side: BackSide }),
  );
  scene.add(shell);

  const addPanel = ({
    color,
    position,
    size,
    rotation = [0, 0, 0],
  }: {
    color: string;
    position: [number, number, number];
    size: [number, number, number];
    rotation?: [number, number, number];
  }) => {
    const panel = new Mesh(
      new BoxGeometry(size[0], size[1], size[2]),
      new MeshBasicMaterial({ color }),
    );
    panel.position.set(position[0], position[1], position[2]);
    panel.rotation.set(rotation[0], rotation[1], rotation[2]);
    scene.add(panel);
  };

  const addGlowSphere = ({
    color,
    position,
    radius,
  }: {
    color: string;
    position: [number, number, number];
    radius: number;
  }) => {
    const glow = new Mesh(
      new SphereGeometry(radius, 24, 16),
      new MeshBasicMaterial({ color }),
    );
    glow.position.set(position[0], position[1], position[2]);
    scene.add(glow);
  };

  switch (preset) {
    case "neutral":
      shell.material.color.set("#191c21");
      addPanel({
        color: "#f3f4f8",
        position: [0, 9, -18],
        size: [14, 14, 0.45],
      });
      addPanel({
        color: "#dde3ee",
        position: [-15, 5, -8],
        size: [9, 12, 0.4],
        rotation: [0, 0.32, 0],
      });
      addPanel({
        color: "#d7dde7",
        position: [15, 4, -7],
        size: [9, 11, 0.4],
        rotation: [0, -0.34, 0],
      });
      addPanel({
        color: "#747c88",
        position: [0, -10, 0],
        size: [32, 0.5, 32],
      });
      break;
    case "outdoor":
      shell.material.color.set("#1a2432");
      addGlowSphere({
        color: "#ffe6b3",
        position: [0, 11, -16],
        radius: 3.6,
      });
      addPanel({
        color: "#7fb3ff",
        position: [-16, 5, -8],
        size: [12, 10, 0.4],
        rotation: [0, 0.42, 0],
      });
      addPanel({
        color: "#d7ecff",
        position: [14, 7, -9],
        size: [8, 12, 0.35],
        rotation: [0, -0.26, 0],
      });
      addPanel({
        color: "#4a5665",
        position: [0, -11, 0],
        size: [36, 0.5, 36],
      });
      break;
    case "studio":
    default:
      addPanel({
        color: "#ffffff",
        position: [0, 8, -16],
        size: [12, 12, 0.45],
      });
      addPanel({
        color: "#bfd0ff",
        position: [-15, 5, -9],
        size: [8, 14, 0.4],
        rotation: [0, 0.38, 0],
      });
      addPanel({
        color: "#ffe2c2",
        position: [15, 4, -8],
        size: [8, 10, 0.4],
        rotation: [0, -0.34, 0],
      });
      addPanel({
        color: "#626977",
        position: [0, -10, 0],
        size: [34, 0.5, 34],
      });
      break;
  }

  return scene;
}

function createEnvironmentTarget(
  pmremGenerator: PMREMGenerator,
  preset: EnvironmentPreset,
) {
  const environmentScene = buildEnvironmentScene(preset);
  const target = pmremGenerator.fromScene(environmentScene, 0.04);
  disposeEnvironmentScene(environmentScene);
  return target;
}

export function AssetViewport({
  currentFile,
  displayMode,
  backgroundPreset,
  onFeedbackChange,
  onMetadataChange,
  selectedTextureId,
  viewerSurfaceMode,
  textureViewMode,
  textureExposure,
  textureBlackPoint,
  textureWhitePoint,
  textureTileCount,
  textureGamma,
  resetVersion,
  showGrid,
  showAxes,
  showSkeleton,
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
  fxaaEnabled,
  showRendererStats,
  toneMappingMode,
  exposure,
  onGridUnitChange,
  environmentPreset,
  cameraSpeedMultiplier,
}: AssetViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const statsRef = useRef<HTMLDivElement | null>(null);
  const keyLightRef = useRef<DirectionalLight | null>(null);
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
  };
  const fxaaStateRef = useRef<FxaaComposerState | null>(null);
  const fxaaEnabledRef = useRef(fxaaEnabled);
  const sceneContextRef = useRef<SceneContext | null>(null);
  const resetCameraRef = useRef<(() => void) | null>(null);
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
  const showBoundingBoxesRef = useRef(showBoundingBoxes);
  const showNormalsRef = useRef(showNormals);
  const showVertexColorsRef = useRef(showVertexColors);
  const viewerSurfaceModeRef = useRef(viewerSurfaceMode);
  const showGridRef = useRef(showGrid);
  const showAxesRef = useRef(showAxes);
  const showEnvironmentBackgroundRef = useRef(showEnvironmentBackground);
  const backgroundPresetRef = useRef(backgroundPreset);
  const cameraSpeedMultiplierRef = useRef(cameraSpeedMultiplier);
  const [activePreviewPath, setActivePreviewPath] = useState<string | null>(
    null,
  );
  const [overlayMode, setOverlayMode] = useState<ViewerMode>("empty");
  const [animationState, setAnimationState] =
    useState<AnimationState>(emptyAnimationState);
  const shouldInitializeScene = currentFile !== null;
  const effectiveOverlayMode =
    currentFile === null
      ? "empty"
      : !implementedPreviewExtensions.has(currentFile.extension)
        ? "unsupported"
        : activePreviewPath === currentFile.path
          ? overlayMode
          : "loading";

  useEffect(() => {
    displayModeRef.current = displayMode;
  }, [displayMode]);

  useEffect(() => {
    backfaceCullingRef.current = backfaceCulling;
  }, [backfaceCulling]);

  useEffect(() => {
    textureFilterModeRef.current = textureFilterMode;
  }, [textureFilterMode]);

  useEffect(() => {
    showShadowsRef.current = showShadows;
  }, [showShadows]);

  useEffect(() => {
    fxaaEnabledRef.current = fxaaEnabled;
  }, [fxaaEnabled]);

  useEffect(() => {
    showSkeletonRef.current = showSkeleton;
  }, [showSkeleton]);

  useEffect(() => {
    showBoundingBoxesRef.current = showBoundingBoxes;
  }, [showBoundingBoxes]);

  useEffect(() => {
    showNormalsRef.current = showNormals;
  }, [showNormals]);

  useEffect(() => {
    showVertexColorsRef.current = showVertexColors;
  }, [showVertexColors]);

  useEffect(() => {
    viewerSurfaceModeRef.current = viewerSurfaceMode;
  }, [viewerSurfaceMode]);

  useEffect(() => {
    showGridRef.current = showGrid;
  }, [showGrid]);

  useEffect(() => {
    showAxesRef.current = showAxes;
  }, [showAxes]);

  useEffect(() => {
    showEnvironmentBackgroundRef.current = showEnvironmentBackground;
  }, [showEnvironmentBackground]);

  useEffect(() => {
    backgroundPresetRef.current = backgroundPreset;
  }, [backgroundPreset]);

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
      viewerSurfaceModeRef.current === "texture"
        ? 1
        : context.rawMaxDimension;
    applyControlsSensitivity(context.controls, sensitivityDim, cameraSpeedMultiplier);
  }, [cameraSpeedMultiplier]);

  useEffect(() => {
    if (!shouldInitializeScene) {
      return;
    }

    const host = hostRef.current;

    if (!host) {
      return;
    }

    const renderer = new WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio * renderScale);
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.toneMapping = toneMappingModeMap[toneMappingMode];
    renderer.toneMappingExposure = exposure;
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

    const ambient = new AmbientLight("#ffffff", 1.8);
    const key = new DirectionalLight("#ffffff", 2.4);
    key.position.set(6, 8, 5);
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
    keyLightRef.current = key;
    const fill = new DirectionalLight("#cfd9ea", 1.2);
    fill.position.set(-5, 3, -4);
    scene.add(ambient, key, fill);
    ensureShadowCatcher(scene);

    const controls = new OrbitControls(camera, renderer.domElement);
    configureAssetControls(controls);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
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

    const pointerDownHandler = (event: PointerEvent) => {
      if (!sceneContextRef.current?.mountedObject) {
        controls.enabled = false;
        return;
      }

      if (viewerSurfaceModeRef.current === "texture") {
        controls.enabled = true;
        return;
      }

      controls.enabled =
        event.button === 0 || event.button === 1 || event.button === 2;
    };

    const pointerUpHandler = () => {
      controls.enabled = Boolean(sceneContextRef.current?.mountedObject);
    };

    renderer.domElement.addEventListener("pointerdown", pointerDownHandler);
    window.addEventListener("pointerup", pointerUpHandler);
    host.appendChild(renderer.domElement);

    const resizeObserver = new ResizeObserver(() => {
      const nextSize = new Vector2(host.clientWidth, host.clientHeight);
      renderer.setSize(nextSize.x, nextSize.y);
      camera.aspect = nextSize.x / nextSize.y;
      camera.updateProjectionMatrix();

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
        !resizeContext ||
        !mountedObject ||
        viewerSurfaceModeRef.current !== "texture"
      ) {
        return;
      }

      frameMountedObject(
        resizeContext,
        mountedObject,
        viewerSurfaceModeRef.current,
        showGridRef.current,
        showAxesRef.current,
        cameraSpeedMultiplierRef.current,
      );
    });

    resizeObserver.observe(host);

    // Renderer stats HUD (FPS / draw calls / triangles / memory).
    // The stats node is populated via textContent directly so toggling
    // the overlay never costs a React re-render inside the render loop.
    let statsLastSampled = performance.now();
    let statsFrameCount = 0;
    let statsLastFps = 0;

    let animationFrame = 0;
    const renderLoop = () => {
      animationFrame = window.requestAnimationFrame(renderLoop);
      controls.update();
      if (fxaaEnabledRef.current && fxaaStateRef.current) {
        fxaaStateRef.current.composer.render();
      } else {
        renderer.render(scene, camera);
      }

      statsFrameCount += 1;
      const now = performance.now();
      const elapsed = now - statsLastSampled;
      if (elapsed >= 250) {
        statsLastFps = (statsFrameCount * 1000) / elapsed;
        statsFrameCount = 0;
        statsLastSampled = now;
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
      cleanupUrls: [],
      mixer: null,
      clips: [],
      activeAction: null,
      textureRegistry: new Map<string, Texture>(),
      rawMaxDimension: 1,
    };

    onFeedbackChange(neutralFeedback);
    onMetadataChange(emptyAssetMetadata);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener(
        "pointerdown",
        pointerDownHandler,
      );
      window.removeEventListener("pointerup", pointerUpHandler);
      if (sceneContextRef.current) {
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
      keyLightRef.current = null;
      pmremGenerator.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      sceneContextRef.current = null;
      resetCameraRef.current = null;
    };
  }, [
    onFeedbackChange,
    onGridUnitChange,
    onMetadataChange,
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
    context.renderer.toneMapping = toneMappingModeMap[toneMappingMode];
  }, [toneMappingMode]);

  useEffect(() => {
    const context = sceneContextRef.current;
    if (!context) {
      return;
    }
    context.renderer.toneMappingExposure = exposure;
  }, [exposure]);

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
      );
    };
  }, [currentFile, showGrid, showAxes, viewerSurfaceMode]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context) {
      return;
    }

    stopAnimations(context);
    resetSceneObjects(context);
    revokeUrls(context.cleanupUrls);
    context.cleanupUrls = [];
    context.controls.enabled = false;
    resetCameraRef.current = null;

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

    if (!implementedPreviewExtensions.has(currentFile.extension)) {
      onMetadataChange(emptyAssetMetadata);
      onFeedbackChange({
        mode: "unsupported",
        message: `Preview is not implemented yet for .${currentFile.extension}.`,
        warning: null,
        canResetCamera: false,
      });
      return;
    }

    let disposed = false;

    onFeedbackChange({
      mode: "loading",
      message: `Loading ${currentFile.fileName}`,
      warning: null,
      canResetCamera: false,
    });
    onMetadataChange(emptyAssetMetadata);

    loadPreviewObject(currentFile, context.renderer)
      .then(({ object, cleanupUrls, clips, formatVersion }) => {
        if (disposed) {
          disposeObject(object);
          revokeUrls(cleanupUrls);
          return;
        }

        context.scene.add(object);
        context.mountedObject = object;
        context.sourceObject = object;
        context.cleanupUrls = cleanupUrls;
        const normalization = normalizeObjectScale(object);
        // Store the original (pre-normalization) dimension so camera sensitivity
        // can reflect the asset's real world scale rather than the clamped size.
        context.rawMaxDimension = normalization.originalMaxDimension > 0
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
        );
        setActivePreviewPath(currentFile.path);
        setOverlayMode("ready");
        // Collect metadata before adding SkeletonHelper children so the
        // bone helper meshes don't get counted as model meshes/nodes.
        const metadataCollection = collectAssetMetadata(
          object,
          currentFile,
          clips,
          formatVersion,
        );
        context.textureRegistry = metadataCollection.textureRegistry;
        onMetadataChange(metadataCollection.metadata);
        applySkeletonHelpers(context.scene, object, showSkeletonRef.current);
        applyBoundingBoxHelpers(
          context.scene,
          object,
          showBoundingBoxesRef.current,
        );
        applyNormalHelpers(
          context.scene,
          object,
          showNormalsRef.current,
        );

        context.clips = clips;
        if (clips.length > 0) {
          context.mixer = new AnimationMixer(object);
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
          );
        };

        onFeedbackChange({
          mode: "ready",
          message: `Preview ready: ${currentFile.fileName}`,
          warning: getScaleWarning(object, normalization),
          canResetCamera: true,
        });
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }

        // Log the raw error to the webview console so it is visible in
        // devtools (Tauri: Ctrl+Shift+I) and not just in Diagnostics.
        console.error("[viewer] load failed:", error);

        const message =
          error instanceof Error ? error.message : "Failed to load preview.";
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

        onFeedbackChange({
          mode,
          message,
          warning: null,
          canResetCamera: false,
        });
      });

    return () => {
      disposed = true;
      stopAnimations(context);
      resetSceneObjects(context);
      revokeUrls(context.cleanupUrls);
      context.cleanupUrls = [];
    };
  }, [
    currentFile,
    onFeedbackChange,
    onGridUnitChange,
    onMetadataChange,
    showGrid,
  ]);

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
      composer.addPass(new RenderPass(context.scene, context.camera));
      const fxaaPass = new ShaderPass(FXAAShader);
      const pixelRatio = context.renderer.getPixelRatio();
      (
        fxaaPass.material.uniforms.resolution.value as Vector2
      ).set(
        1 / (host.clientWidth * pixelRatio),
        1 / (host.clientHeight * pixelRatio),
      );
      composer.addPass(fxaaPass);
      composer.setSize(host.clientWidth, host.clientHeight);
      fxaaStateRef.current = {
        composer,
        fxaaPass: fxaaPass as unknown as FxaaComposerState["fxaaPass"],
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

    applySkeletonHelpers(context.scene, context.sourceObject, showSkeleton);
  }, [showSkeleton]);

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

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.sourceObject) {
      return;
    }

    if (context.previewObject) {
      context.scene.remove(context.previewObject);
      disposePreviewObject(context.previewObject);
      context.previewObject = null;
    }

    if (
      viewerSurfaceMode !== "texture" ||
      !selectedTextureId ||
      !context.textureRegistry.has(selectedTextureId)
    ) {
      context.sourceObject.visible = true;
      context.mountedObject = context.sourceObject;
      frameMountedObject(
        context,
        context.sourceObject,
        viewerSurfaceModeRef.current,
        showGridRef.current,
        showAxesRef.current,
        cameraSpeedMultiplierRef.current,
        context.rawMaxDimension,
      );
      return;
    }

    const selectedTexture = context.textureRegistry.get(selectedTextureId);
    if (!selectedTexture) {
      return;
    }

    const previewObject = createTextureViewerObject(
      selectedTexture,
      textureViewMode,
      textureExposure,
      textureBlackPoint,
      textureWhitePoint,
      textureTileCount,
      textureGamma,
    );
    context.sourceObject.visible = false;
    context.previewObject = previewObject;
    context.mountedObject = previewObject;
    context.scene.add(previewObject);
    frameMountedObject(
      context,
      previewObject,
      viewerSurfaceModeRef.current,
      showGridRef.current,
      showAxesRef.current,
      cameraSpeedMultiplierRef.current,
    );
  }, [
    selectedTextureId,
    textureBlackPoint,
    textureExposure,
    textureGamma,
    textureTileCount,
    textureViewMode,
    textureWhitePoint,
    viewerSurfaceMode,
  ]);

  useEffect(() => {
    resetCameraRef.current?.();
  }, [resetVersion]);

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

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.mixer || context.clips.length === 0) {
      return;
    }

    let animationFrame = 0;
    let previousTimestamp = performance.now();

    const update = (timestamp: number) => {
      animationFrame = window.requestAnimationFrame(update);
      const deltaSeconds = (timestamp - previousTimestamp) / 1000;
      previousTimestamp = timestamp;

      if (animationState.isPlaying && viewerSurfaceMode === "asset") {
        context.mixer?.update(deltaSeconds);
      }

      const clip = context.clips[animationState.activeClipIndex];
      const action = context.activeAction;
      const nextTime = action?.time ?? 0;
      const nextDuration = clip?.duration ?? animationState.duration;

      setAnimationState((previous) => {
        if (
          previous.activeClipIndex === animationState.activeClipIndex &&
          previous.isPlaying === animationState.isPlaying &&
          Math.abs(previous.currentTime - nextTime) < 1 / 30 &&
          Math.abs(previous.duration - nextDuration) < 1 / 1000
        ) {
          return previous;
        }

        return {
          ...previous,
          currentTime: nextTime,
          duration: nextDuration,
        };
      });
    };

    animationFrame = window.requestAnimationFrame(update);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [
    animationState.activeClipIndex,
    animationState.duration,
    animationState.isPlaying,
    viewerSurfaceMode,
  ]);

  const hasAnimation = animationState.clipNames.length > 0;

  const handleTogglePlayback = () => {
    const context = sceneContextRef.current;
    const action = context?.activeAction;

    if (!context || !action) {
      return;
    }

    setAnimationState((previous) => {
      const nextIsPlaying = !previous.isPlaying;
      setActionPlayback(action, nextIsPlaying);
      return {
        ...previous,
        isPlaying: nextIsPlaying,
      };
    });
  };

  const handleSelectClip = (index: number) => {
    const context = sceneContextRef.current;

    if (!context || index < 0 || index >= context.clips.length) {
      return;
    }

    const activated = activateClip(context, index, animationState.isPlaying);

    if (!activated) {
      return;
    }

    setAnimationState((previous) => ({
      ...previous,
      activeClipIndex: activated.clipIndex,
      currentTime: activated.currentTime,
      duration: activated.duration,
      isPlaying: activated.isPlaying,
    }));
  };

  const handleSeek = (time: number) => {
    const context = sceneContextRef.current;
    const action = context?.activeAction;

    if (!context || !action) {
      return;
    }

    const clip = context.clips[animationState.activeClipIndex];
    const duration = clip?.duration ?? animationState.duration;
    const nextTime = seekAction(context, action, time, duration);
    setAnimationState((previous) => ({
      ...previous,
      currentTime: nextTime,
      duration,
    }));
  };

  const handleStep = (direction: -1 | 1) => {
    const context = sceneContextRef.current;
    const action = context?.activeAction;

    if (!context || !action) {
      return;
    }

    const clip = context.clips[animationState.activeClipIndex];
    const duration = clip?.duration ?? animationState.duration;
    const nextTime = stepAction(context, action, direction, duration);
    setAnimationState((previous) => ({
      ...previous,
      currentTime: nextTime,
      duration,
      isPlaying: false,
    }));
  };

  return (
    <div className="viewport-shell">
      <div className="viewport-canvas" ref={hostRef} />

      <div
        className="viewport-stats"
        ref={statsRef}
        hidden={!showRendererStats}
        aria-hidden={!showRendererStats}
      />

      {effectiveOverlayMode !== "ready" ? (
        <div
          className={`viewport-overlay${effectiveOverlayMode === "empty" ? " is-empty" : ""}`}
        >
          <ViewerStatePanel mode={effectiveOverlayMode} />
        </div>
      ) : null}
      {hasAnimation &&
      effectiveOverlayMode === "ready" &&
      viewerSurfaceMode === "asset" ? (
        <div className="viewport-animation-overlay">
          <AnimationBar
            activeClipIndex={animationState.activeClipIndex}
            clipNames={animationState.clipNames}
            currentTime={animationState.currentTime}
            duration={animationState.duration}
            isPlaying={animationState.isPlaying}
            onSeek={handleSeek}
            onSelectClip={handleSelectClip}
            onStep={handleStep}
            onTogglePlayback={handleTogglePlayback}
          />
        </div>
      ) : null}
    </div>
  );
}
