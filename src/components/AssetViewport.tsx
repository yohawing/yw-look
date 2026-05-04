import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationMixer,
  BackSide,
  Box3,
  BoxGeometry,
  Camera,
  Color,
  DirectionalLight,
  Euler,
  LinearToneMapping,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MOUSE,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Raycaster,
  ReinhardToneMapping,
  Scene,
  SphereGeometry,
  Texture,
  type ToneMapping,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SelectedFile } from "../lib/files";
import { formatUsdErrorForDisplay } from "../lib/usd";
import type { ViewportShortcutCommand } from "../lib/viewerShortcuts";
import {
  type CameraPreset,
  type DisplayMode,
  type LoadingStageId,
  type LoadingStageSnapshot,
  type MissingReferenceError,
  type SceneContext,
  type TextureFilterMode,
  type TextureViewMode,
  type ViewerFeedback,
  type ViewerSurfaceMode,
  formatMissingOptionalLoaderMessage,
  formatUnsupportedFormatMessage,
  getPreviewSupportState,
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
  cameraSelectionKey,
  createTextureViewerObject,
  getClipLabel,
  activateClip,
  setActionPlayback,
  seekAction,
  stepAction,
  disposePreviewObject,
  applySelectionHighlight,
  clearSelectionHighlight,
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

function applyControlSensitivity(controls: OrbitControls, sensitivity: number) {
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
  texturePreview3D = false,
) {
  syncGridVisibility(context, showGrid, viewerSurfaceMode);
  syncAxesVisibility(context, showAxes, viewerSurfaceMode);

  if (viewerSurfaceMode === "texture" && !texturePreview3D) {
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

function selectionKeyForObject(object: Object3D) {
  const primPath =
    typeof object.userData?.primPath === "string"
      ? object.userData.primPath
      : undefined;
  const raw = typeof object.name === "string" ? object.name.trim() : "";
  return primPath ?? (raw.length > 0 ? raw : null);
}

function findObjectBySelectionKey(
  root: Object3D,
  selectionKey: string,
): Object3D | null {
  let match: Object3D | null = null;

  root.traverse((child) => {
    if (match) return;
    if (selectionKeyForObject(child) === selectionKey) {
      match = child;
    }
  });

  return match;
}

function frameObjectBounds(
  context: SceneContext,
  object: Object3D,
  sensitivityMultiplier = 1,
) {
  const bounds = new Box3().setFromObject(object);
  if (bounds.isEmpty()) {
    return;
  }

  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
  const fitHeightDistance =
    maxDimension / (2 * Math.tan(MathUtils.degToRad(context.camera.fov * 0.5)));
  const fitDistance = fitHeightDistance * 1.5;
  const direction = context.camera.position
    .clone()
    .sub(context.controls.target)
    .normalize();
  if (direction.lengthSq() === 0) {
    direction.set(1.15, 0.8, 1.15).normalize();
  }

  context.camera.position.copy(
    center.clone().add(direction.multiplyScalar(fitDistance)),
  );
  context.camera.near = Math.max(maxDimension / 500, 0.01);
  context.camera.far = Math.max(maxDimension * 20, 200);
  context.camera.lookAt(center);
  context.camera.updateProjectionMatrix();

  context.controls.target.copy(center);
  context.controls.minDistance = Math.max(maxDimension / 50, 0.05);
  context.controls.maxDistance = Math.max(maxDimension * 40, 50);
  applyControlsSensitivity(
    context.controls,
    maxDimension,
    sensitivityMultiplier,
  );
  context.controls.update();
  context.controls.enabled = true;
}

const MANUAL_HIDDEN_KEY = "__ywManualHidden";

function isManuallyHidden(object: Object3D) {
  return object.userData?.[MANUAL_HIDDEN_KEY] === true;
}

function setSubtreeManualHidden(root: Object3D, hidden: boolean) {
  root.traverse((child) => {
    if (child.name === "__yw_shadow_catcher") {
      return;
    }
    if (hidden) {
      child.userData[MANUAL_HIDDEN_KEY] = true;
    } else {
      delete child.userData[MANUAL_HIDDEN_KEY];
    }
  });
}

function applyManualVisibility(root: Object3D) {
  root.traverse((child) => {
    if (child.name === "__yw_shadow_catcher") {
      return;
    }
    if (isManuallyHidden(child)) {
      child.visible = false;
    }
  });
}

function isolateObject(root: Object3D, selected: Object3D) {
  setSubtreeManualHidden(root, true);
  setSubtreeManualHidden(selected, false);

  let ancestor = selected.parent;
  while (ancestor && ancestor !== root.parent) {
    delete ancestor.userData[MANUAL_HIDDEN_KEY];
    if (ancestor === root) break;
    ancestor = ancestor.parent;
  }
}

type AssetViewportProps = {
  currentFile: SelectedFile | null;
  displayMode: DisplayMode;
  backgroundPreset: BackgroundPreset;
  onFeedbackChange: (feedback: ViewerFeedback) => void;
  onOpenFile?: () => void;
  onUsdError?: (error: unknown) => void;
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
  viewportShortcutCommand?: ViewportShortcutCommand | null;
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
  /**
   * Phase 4 USD load policy. Default `"loadAll"` preserves Phase 3
   * behavior. When this changes the viewport reloads the preview with
   * the new policy so deferred payloads take effect.
   */
  usdLoadPolicy?: import("../lib/usd").StageLoadPolicy;
  /**
   * When `true`, the texture preview plane is framed with the same
   * orbit-style controls as a 3D asset so the user can rotate/zoom
   * around it. Defaults to `false` (flat 2D pan/zoom view) which is
   * the canonical image-viewer behavior and matches what users expect
   * for a quick texture inspection.
   */
  texturePreview3D: boolean;
  /**
   * Fired when the user single-clicks the viewport (#33). Receives the
   * `Object3D.name` of the picked mesh, or `null` when the click misses
   * any geometry. Drags are not treated as clicks (a small movement
   * threshold filters orbit/pan gestures out). The string is the live
   * Three.js object name — for the GLB-routed USD path this is the
   * authored prim path the Rust backend stamps on each mesh node, and
   * for the Three.js USDLoader path it is whatever the loader assigned.
   * App.tsx feeds the value into the hierarchy panel so the tree can
   * scroll to and highlight the picked prim.
   */
  onSelectMesh?: (meshName: string | null) => void;
  /**
   * Currently selected mesh name driven by the hierarchy tree (#33 reverse
   * direction: tree → viewport).  When this changes the viewport applies a
   * selection tint to the matching mesh; `null` clears any active tint.
   */
  selectedMeshName?: string | null;
  /**
   * #32: USD purpose visibility filter. `default` purpose is always shown.
   * Each of render / proxy / guide is independently toggled. When undefined
   * the viewport behaves as if render=true, proxy=false, guide=false which
   * matches the pre-#32 behavior.
   */
  purposeModes?: import("../lib/usd").PurposeModes;
  /**
   * #31: USD variant selections applied before geometry extraction.
   * When this array changes the GLB pipeline is re-run with the new
   * selections so the variant switch is reflected in the viewport.
   * Ignored for non-USD files and the USDA single-buffer path.
   */
  variantSelections?: import("../lib/usd").VariantSelection[];
  /**
   * #34: Name of the USD camera to use as the active viewport camera.
   * `null` (default) keeps the free-orbit PerspectiveCamera.
   * When a value is set the viewport traverses the scene graph, finds the
   * matching PerspectiveCamera node (by stripped name), uses it for
   * rendering, and disables OrbitControls so the transform is USD-driven.
   * The fly-cam (RMB+WASD) is also blocked while a USD camera is active.
   *
   * Uses the camera's stable Three.js uuid rather than its authored name
   * so duplicate or unnamed cameras stay independently selectable.
   */
  activeCameraId?: string | null;
  /** Called when the previously-selected USD camera disappears after a
   * reload (variant / load-policy change → new Three.js scene with fresh
   * uuids). The viewport falls back to the free camera but the React
   * state in App.tsx still points at a uuid that no longer exists; this
   * callback lets App reset that state so the UI is consistent and fly
   * mode becomes available again. */
  onActiveCameraReset?: () => void;
  /**
   * #44: when non-null the viewport loads this pre-extracted GLB buffer
   * directly instead of re-extracting from the file path. Used by the
   * per-prim payload session so the viewport reflects the current payload
   * load state without a full round-trip through the extraction pipeline.
   * Setting to `null` or omitting reverts to the normal file-based path.
   */
  glbOverride?: ArrayBuffer | null;
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
  onOpenFile,
  onUsdError,
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
  viewportShortcutCommand,
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
  usdLoadPolicy,
  texturePreview3D,
  onSelectMesh,
  selectedMeshName,
  purposeModes,
  variantSelections,
  activeCameraId = null,
  onActiveCameraReset,
  glbOverride = null,
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
    /** The RenderPass stored so its `.camera` can be swapped when a
     * USD camera is selected (#34). EffectComposer exposes `passes[]`
     * but the typed shape is opaque here; we hold it separately. */
    renderPass: { camera: import("three").Camera };
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
  const texturePreview3DRef = useRef(texturePreview3D);
  const onSelectMeshRef = useRef(onSelectMesh);
  const purposeModesRef = useRef(purposeModes);
  // #34: active USD camera. null = free orbit.
  // activeCameraIdRef is read inside the render loop / pointer handlers to
  // guard fly mode without causing the big scene-init effect to re-run.
  const activeCameraIdRef = useRef(activeCameraId);
  // #34 codex P2: callback used when a stale camera id survives a reload —
  // the post-load callback runs inside a Three.js Promise chain that does
  // not see prop changes, so we hold the latest setter in a ref.
  const onActiveCameraResetRef = useRef(onActiveCameraReset);
  onActiveCameraResetRef.current = onActiveCameraReset;
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
  const [animationState, setAnimationState] =
    useState<AnimationState>(emptyAnimationState);
  const shouldInitializeScene = currentFile !== null;
  const previewSupportState = currentFile
    ? getPreviewSupportState(currentFile.extension)
    : "implemented";
  const effectiveOverlayMode =
    currentFile === null
      ? "empty"
      : previewSupportState === "missingOptionalLoader"
        ? "missingOptionalLoader"
        : previewSupportState === "unsupported"
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
    texturePreview3DRef.current = texturePreview3D;
  }, [texturePreview3D]);

  useEffect(() => {
    onSelectMeshRef.current = onSelectMesh;
  }, [onSelectMesh]);

  // #33 reverse direction: tree → viewport highlight.
  // When selectedMeshName changes we apply (or clear) a selection tint on the
  // matching mesh in the live Three.js scene.
  useEffect(() => {
    const mounted = sceneContextRef.current?.mountedObject;
    if (!mounted) return;

    // Always clear any previous tint first.
    clearSelectionHighlight(mounted);

    if (selectedMeshName) {
      applySelectionHighlight(mounted, selectedMeshName);
    }
  }, [selectedMeshName]);

  // #32: USD purpose visibility. Traverse an object and set child.visible
  // based on userData.purpose (written to GLB node extras by the Rust
  // backend). `default` is always shown. render/proxy/guide are controlled
  // by purposeModes. This is extracted as a plain function so it can be
  // called both from the useEffect below (prop change) and from the load
  // callback (initial scene mount, where the ref mutation won't re-trigger
  // the effect).
  function applyPurposeVisibility(
    root: import("three").Object3D,
    modes: import("../lib/usd").PurposeModes | undefined,
  ) {
    const render = modes?.render ?? true;
    const proxy = modes?.proxy ?? false;
    const guide = modes?.guide ?? false;

    root.traverse((child) => {
      const purpose: unknown = child.userData?.purpose;
      if (typeof purpose !== "string") return;

      let visible: boolean;
      switch (purpose) {
        case "default":
          visible = true;
          break;
        case "render":
          visible = render;
          break;
        case "proxy":
          visible = proxy;
          break;
        case "guide":
          visible = guide;
          break;
        default:
          visible = true;
      }
      child.visible = visible && !isManuallyHidden(child);
    });
  }

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
    let found: Camera | null = null;
    const seenCounts = new Map<string, number>();
    context.scene.traverse((child) => {
      if (found) return;
      if (!(child instanceof Camera)) return;
      const key = cameraSelectionKey(child, seenCounts);
      if (key === activeCameraId) {
        found = child;
      }
    });

    if (found) {
      const foundCamera: Camera = found;
      activeCameraRef.current = foundCamera;
      context.controls.enabled = false;
      // Sync aspect to the current viewport size so the USD camera renders
      // without distortion. Only meaningful for PerspectiveCamera; the
      // OrthographicCamera frustum is authored, not aspect-driven, so we
      // leave its left/right/top/bottom alone.
      const host = hostRef.current;
      if (
        host &&
        host.clientWidth > 0 &&
        host.clientHeight > 0 &&
        foundCamera instanceof PerspectiveCamera
      ) {
        foundCamera.aspect = host.clientWidth / host.clientHeight;
        foundCamera.updateProjectionMatrix();
      }
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

    // ── UE-style fly camera (#25) ────────────────────────────────
    // Right-click held = fly mode: mouse-look while RMB is down, WASD
    // for translation, Q/E for down/up, mouse wheel adjusts speed.
    // This replaces OrbitControls' DOLLY-on-right-button behavior
    // because the activation gesture is identical (RMB hold), and a
    // mode toggle is the simpler UX than trying to time-out into one
    // or the other.
    //
    // The camera's Euler is read into a YXZ Euler so the yaw stays
    // aligned with world-up (Y) and the pitch never introduces
    // unintended roll. We clamp pitch to ±89° so the camera never
    // flips through the pole the way an unconstrained Euler would.
    const flyState = {
      active: false,
      lastFrameTime: 0,
      // Local-axis translation. Each component is -1, 0, or 1 based
      // on which keys are held. The render loop integrates this
      // against `speed * dt` to produce the per-frame delta.
      input: new Vector3(0, 0, 0),
      // Authored speed in scene units per second. Wheel events
      // multiply this by ~10% per detent, clamped to a sane range
      // so the user can't end up at a stuck-on-zero or warp-speed
      // setting and have to reload to escape.
      speed: 5,
      euler: new Euler(0, 0, 0, "YXZ"),
      // Orbit pivot distance captured at fly entry. Used on exit to
      // place `controls.target` a sensible distance ahead of the
      // camera. We can't reuse the live `target.distanceTo(position)`
      // at exit because the user may have flown far past the
      // original orbit target, which would land the new pivot at an
      // arbitrary distant point instead of near the framed asset.
      orbitRadius: 5,
    };
    const FLY_MIN_SPEED = 0.1;
    const FLY_MAX_SPEED = 200;
    const FLY_PITCH_LIMIT = MathUtils.degToRad(89);
    // Reused vector to avoid per-frame allocations in the render loop.
    const flyForward = new Vector3();
    const flyRight = new Vector3();

    /** Snap OrbitControls' target back onto the camera's forward
     * vector at a sensible distance so re-engaging Orbit after a fly
     * traversal pivots around what the user just framed up. Without
     * this the target stays at the world origin and orbiting feels
     * disconnected from the new viewpoint. We use the orbit radius
     * captured when fly mode was entered (rather than the live
     * camera-to-target distance) so a long fly traversal doesn't
     * place the new pivot far past the visible subject. */
    const restoreOrbitTargetFromCamera = () => {
      flyForward.set(0, 0, -1).applyEuler(flyState.euler);
      const distance = MathUtils.clamp(flyState.orbitRadius, 1, 50);
      controls.target
        .copy(camera.position)
        .addScaledVector(flyForward, distance);
    };

    const handleFlyMouseMove = (event: MouseEvent) => {
      if (!flyState.active) return;
      // movementX/Y are pointer-lock deltas in CSS pixels; the
      // 0.002 multiplier keeps the look sensitivity in the same
      // ballpark as OrbitControls' `rotateSpeed = 1.0` while still
      // letting `controlSensitivity` tune the orbit speed
      // independently — fly look feels different from orbit drag,
      // and yoking them together produces the wrong response when
      // the user dials orbit way down for fine framing work.
      const sensitivity = 0.002;
      flyState.euler.y -= event.movementX * sensitivity;
      flyState.euler.x -= event.movementY * sensitivity;
      flyState.euler.x = MathUtils.clamp(
        flyState.euler.x,
        -FLY_PITCH_LIMIT,
        FLY_PITCH_LIMIT,
      );
      camera.quaternion.setFromEuler(flyState.euler);
    };

    /** Tracks every fly-relevant key currently held down. Recomputing
     * `flyState.input` from this set on every keydown/keyup avoids
     * the classic "press W, press S, release S → motion stops"
     * bug that plain ±1 axis assignment produces with overlapping
     * keys. */
    const flyHeldKeys = new Set<string>();
    const FLY_KEYS = new Set(["KeyW", "KeyS", "KeyA", "KeyD", "KeyQ", "KeyE"]);

    const recomputeFlyInput = () => {
      let x = 0;
      let y = 0;
      let z = 0;
      if (flyHeldKeys.has("KeyW")) z -= 1;
      if (flyHeldKeys.has("KeyS")) z += 1;
      if (flyHeldKeys.has("KeyA")) x -= 1;
      if (flyHeldKeys.has("KeyD")) x += 1;
      if (flyHeldKeys.has("KeyE")) y += 1;
      if (flyHeldKeys.has("KeyQ")) y -= 1;
      flyState.input.set(x, y, z);
    };

    const handleFlyKeyDown = (event: KeyboardEvent) => {
      if (!flyState.active) return;
      if (!FLY_KEYS.has(event.code)) return;
      flyHeldKeys.add(event.code);
      recomputeFlyInput();
      // Stop the keystroke from triggering any global keyboard
      // shortcut while fly is active (the Settings panel binds
      // single-letter accelerators that would otherwise fire as
      // the user navigates the scene).
      event.preventDefault();
    };

    const handleFlyKeyUp = (event: KeyboardEvent) => {
      if (!FLY_KEYS.has(event.code)) return;
      flyHeldKeys.delete(event.code);
      recomputeFlyInput();
    };

    const handleFlyWheel = (event: WheelEvent) => {
      if (!flyState.active) return;
      // Each wheel detent multiplies/divides speed by ~1.1× so the
      // user can sweep across the whole range with a few flicks
      // without overshooting. Negative deltaY = wheel-up = faster.
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      flyState.speed = MathUtils.clamp(
        flyState.speed * factor,
        FLY_MIN_SPEED,
        FLY_MAX_SPEED,
      );
      // Prevent the page from scrolling while fly is engaged. This
      // is the same prevention logic the OrbitControls wheel handler
      // applies internally; we mirror it because we've taken over
      // the wheel during fly mode.
      event.preventDefault();
    };

    /** Bidirectional guard for the asynchronous Pointer Lock API.
     *
     * Two cases this needs to handle:
     *
     * 1. Late-acquisition cleanup. `requestPointerLock()` resolves
     *    asynchronously, so a quick RMB tap can run
     *    `enterFlyMode` → `exitFlyMode` synchronously before pointer
     *    lock has actually been granted. Without intervention the
     *    late acquisition would leave the cursor stuck until the
     *    user pressed Esc. → release the lock when it lands and fly
     *    mode is already inactive.
     *
     * 2. External lock loss while flying. The user can press Esc
     *    (or the OS can yank the lock for tab-switch / focus-loss /
     *    device disconnect reasons), in which case
     *    `pointerLockElement` becomes null while RMB is still
     *    physically held. Without intervention `flyState.active`
     *    would stay true, `controls.enabled` would stay false, and
     *    the viewport would be stuck in fly mode until the user
     *    happened to release RMB. → end fly mode the same way a
     *    pointerup would.
     */
    const handlePointerLockChange = () => {
      const locked = document.pointerLockElement === renderer.domElement;
      if (locked && !flyState.active) {
        document.exitPointerLock?.();
      } else if (!locked && flyState.active) {
        exitFlyMode();
      }
    };

    const enterFlyMode = () => {
      // #34: fly mode is only available for the free-orbit camera.
      if (activeCameraIdRef.current) return;
      if (flyState.active) return;
      flyState.active = true;
      flyHeldKeys.clear();
      flyState.input.set(0, 0, 0);
      flyState.euler.setFromQuaternion(camera.quaternion, "YXZ");
      flyState.lastFrameTime = performance.now();
      // Capture the orbit pivot distance now (before flying away
      // from it) so `restoreOrbitTargetFromCamera` can place the new
      // pivot at a sensible distance on exit.
      flyState.orbitRadius = controls.target.distanceTo(camera.position);
      controls.enabled = false;
      // Capture the cursor so the user can keep dragging across the
      // screen edge without the OS clamping the pointer. Some
      // browsers (older Safari / WebView2 builds) don't expose
      // pointer lock; in that case we just operate on raw movement
      // events and the cursor stays visible — usable, if not ideal.
      const target = renderer.domElement;
      target.requestPointerLock?.();
      window.addEventListener("mousemove", handleFlyMouseMove);
      window.addEventListener("keydown", handleFlyKeyDown);
      window.addEventListener("keyup", handleFlyKeyUp);
      target.addEventListener("wheel", handleFlyWheel, { passive: false });
    };

    const exitFlyMode = () => {
      if (!flyState.active) return;
      flyState.active = false;
      flyHeldKeys.clear();
      flyState.input.set(0, 0, 0);
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock?.();
      }
      window.removeEventListener("mousemove", handleFlyMouseMove);
      window.removeEventListener("keydown", handleFlyKeyDown);
      window.removeEventListener("keyup", handleFlyKeyUp);
      renderer.domElement.removeEventListener("wheel", handleFlyWheel);
      restoreOrbitTargetFromCamera();
      controls.enabled = Boolean(sceneContextRef.current?.mountedObject);
    };

    // #33: viewport picking. We track the LMB-down position on the
    // canvas and treat the pointerup as a "click" only if the pointer
    // moved < CLICK_DRAG_PX between the two events. That keeps orbit /
    // pan gestures from firing a selection update on every release.
    // The raycaster lives at handler scope so we don't allocate one
    // per click — Three.js encourages reuse for GC pressure reasons.
    const CLICK_DRAG_PX = 4;
    const pickRaycaster = new Raycaster();
    const pickNdc = new Vector2();
    let clickStart: { x: number; y: number; button: number } | null = null;

    const performPick = (event: PointerEvent): void => {
      const callback = onSelectMeshRef.current;
      if (!callback) return;
      const mounted = sceneContextRef.current?.mountedObject;
      if (!mounted) {
        callback(null);
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      // Map clientX/Y → normalized device coords. The canvas may be
      // letterboxed inside its host so we use getBoundingClientRect
      // rather than offsetWidth/Height, which would miss the offset.
      pickNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pickNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      pickRaycaster.setFromCamera(pickNdc, camera);
      const hits = pickRaycaster.intersectObject(mounted, true);
      if (hits.length === 0) {
        callback(null);
        return;
      }
      // Walk up from the hit object to the first Mesh ancestor,
      // INCLUDING the mounted root itself — PLY and STL load as a
      // single `Mesh` rather than a `Group`, so `hits[0].object` and
      // `mounted` are the same object and an early `node !== mounted`
      // check would skip the only mesh in the scene. Internal helpers
      // (SkeletonHelper line segments, BoundingBox helpers) are
      // LineSegments / Lines, so the `instanceof Mesh` gate filters
      // them out. The shadow catcher is a Mesh but is dropped here by
      // name so a click on the ground plane reads as "missed".
      //
      // For an unnamed mesh we report null (no selection) rather than
      // the historical "(unnamed)" placeholder. The placeholder leaks
      // into USD prim path construction in HierarchyCard (#28) and
      // also collapses every unnamed mesh onto the same selection,
      // which highlights every anonymous node at once.
      let node: Object3D | null = hits[0].object;
      while (node) {
        if (node instanceof Mesh && node.name !== "__yw_shadow_catcher") {
          // #46: prefer userData.primPath as the stable selection key so
          // that viewport picks and HierarchyCard selections match even
          // after the hierarchy-aware GLB pipeline changed node names from
          // "/World/Cube" to just "Cube".
          const primPath =
            typeof node.userData?.primPath === "string"
              ? node.userData.primPath
              : undefined;
          const raw = typeof node.name === "string" ? node.name.trim() : "";
          const selectionKey = primPath ?? (raw.length > 0 ? raw : null);
          callback(selectionKey);
          return;
        }
        if (node === mounted) break;
        node = node.parent;
      }
      callback(null);
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
        enterFlyMode();
        return;
      }

      controls.enabled = event.button === 0 || event.button === 1;
    };

    const pointerUpHandler = (event: PointerEvent) => {
      if (event.button === 2 && flyState.active) {
        exitFlyMode();
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
    document.addEventListener("pointerlockchange", handlePointerLockChange);
    host.appendChild(renderer.domElement);

    const resizeObserver = new ResizeObserver(() => {
      const nextSize = new Vector2(host.clientWidth, host.clientHeight);
      renderer.setSize(nextSize.x, nextSize.y);
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
        undefined,
        texturePreview3DRef.current,
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

      // Fly mode integrates WASD/QE input each frame. We skip the
      // OrbitControls update entirely while flying because
      // `controls.update()` is **not** gated by `controls.enabled` —
      // it always recomputes the camera transform and calls
      // `lookAt(controls.target)`, which would clobber the mouse-look
      // orientation we set in the fly handlers. On fly exit we
      // re-sync `controls.target` to the new viewpoint so the next
      // orbit interaction pivots around what the user just framed.
      if (flyState.active) {
        const now = performance.now();
        const dt = Math.min(0.1, (now - flyState.lastFrameTime) / 1000);
        flyState.lastFrameTime = now;
        const input = flyState.input;
        if (dt > 0 && (input.x !== 0 || input.y !== 0 || input.z !== 0)) {
          // Build forward / right vectors from the current Euler.
          // World-up Y is used for vertical translation so Q/E always
          // moves perpendicular to the ground plane regardless of
          // pitch — this matches UE/Unity fly-cam conventions.
          flyForward.set(0, 0, -1).applyEuler(flyState.euler);
          flyRight.set(1, 0, 0).applyEuler(flyState.euler);
          const distance = flyState.speed * dt;
          camera.position
            .addScaledVector(flyForward, -input.z * distance)
            .addScaledVector(flyRight, input.x * distance);
          camera.position.y += input.y * distance;
        }
      } else {
        controls.update();
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
      // Drop fly-mode listeners *before* removing the pointer
      // handlers so a teardown mid-fly doesn't leave dangling
      // mousemove/keyboard listeners on `window`.
      exitFlyMode();
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
        handlePointerLockChange,
      );
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

    stopAnimations(context);
    resetSceneObjects(context);
    revokeUrls(context.cleanupUrls);
    context.cleanupUrls = [];
    context.controls.enabled = false;
    resetCameraRef.current = null;
    // #34: clear USD camera override on every file change so we always start
    // with the free-orbit camera for a fresh asset.
    activeCameraRef.current = null;

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
      setLoadingStage(null);
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

    const supportState = getPreviewSupportState(currentFile.extension);
    if (supportState !== "implemented") {
      const message =
        supportState === "missingOptionalLoader"
          ? formatMissingOptionalLoaderMessage(currentFile.extension)
          : formatUnsupportedFormatMessage(currentFile.extension);
      onMetadataChange(emptyAssetMetadata);
      onFeedbackChange({
        mode: supportState,
        message:
          message !== null
            ? `${message.title} ${message.body}`
            : `Preview is not implemented yet for .${currentFile.extension}.`,
        warning: null,
        canResetCamera: false,
      });
      setLoadingStage(null);
      return;
    }

    let disposed = false;
    const loadingStartedAt = performance.now();
    const loadingClock: {
      activeStage: LoadingStageId;
      activeStartedAt: number;
      elapsedByStage: Partial<Record<LoadingStageId, number>>;
    } = {
      activeStage: "scan",
      activeStartedAt: loadingStartedAt,
      elapsedByStage: {},
    };
    const reportLoadingStage = (stage: LoadingStageId) => {
      if (disposed) return;

      const now = performance.now();
      if (stage !== loadingClock.activeStage) {
        loadingClock.elapsedByStage[loadingClock.activeStage] =
          (loadingClock.elapsedByStage[loadingClock.activeStage] ?? 0) +
          (now - loadingClock.activeStartedAt);
        loadingClock.activeStage = stage;
        loadingClock.activeStartedAt = now;
      }

      setLoadingStage({
        activeStage: stage,
        activeStageStartedAt: loadingClock.activeStartedAt,
        elapsedByStage: { ...loadingClock.elapsedByStage },
        totalElapsedMs: now - loadingStartedAt,
      });
    };

    onFeedbackChange({
      mode: "loading",
      message: `Loading ${currentFile.fileName}`,
      warning: null,
      canResetCamera: false,
    });
    onMetadataChange(emptyAssetMetadata);
    reportLoadingStage("scan");

    loadPreviewObject(currentFile, context.renderer, {
      usdLoadPolicy,
      variantSelections,
      glbOverride: glbOverride ?? null,
      onStage: reportLoadingStage,
    })
      .then(({ object, cleanupUrls, clips, formatVersion }) => {
        if (disposed) {
          disposeObject(object);
          revokeUrls(cleanupUrls);
          return;
        }

        reportLoadingStage("scene");
        context.scene.add(object);
        context.mountedObject = object;
        context.sourceObject = object;
        context.cleanupUrls = cleanupUrls;
        const normalization = normalizeObjectScale(object);
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
        );
        context.textureRegistry = metadataCollection.textureRegistry;
        onMetadataChange(metadataCollection.metadata);
        applySkeletonHelpers(context.scene, object, showSkeletonRef.current);
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
          let reFound: Camera | null = null;
          const reSeenCounts = new Map<string, number>();
          context.scene.traverse((child) => {
            if (reFound) return;
            if (!(child instanceof Camera)) return;
            const key = cameraSelectionKey(child, reSeenCounts);
            if (key === desiredCameraId) {
              reFound = child;
            }
          });
          if (reFound) {
            const reFoundCamera: Camera = reFound;
            activeCameraRef.current = reFoundCamera;
            context.controls.enabled = false;
            const host2 = hostRef.current;
            if (
              host2 &&
              host2.clientWidth > 0 &&
              host2.clientHeight > 0 &&
              reFoundCamera instanceof PerspectiveCamera
            ) {
              reFoundCamera.aspect = host2.clientWidth / host2.clientHeight;
              reFoundCamera.updateProjectionMatrix();
            }
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

        onFeedbackChange({
          mode: "ready",
          message: `Preview ready: ${currentFile.fileName}`,
          warning: getScaleWarning(object, normalization),
          canResetCamera: true,
        });
        setLoadingStage(null);
      })
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

        onFeedbackChange({
          mode,
          message,
          warning: null,
          canResetCamera: false,
        });
        setLoadingStage(null);
      });

    return () => {
      disposed = true;
      setLoadingStage(null);
      stopAnimations(context);
      resetSceneObjects(context);
      revokeUrls(context.cleanupUrls);
      context.cleanupUrls = [];
    };
  }, [
    currentFile,
    onFeedbackChange,
    onUsdError,
    onGridUnitChange,
    onMetadataChange,
    showGrid,
    usdLoadPolicy,
    variantSelections,
    glbOverride,
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
        texturePreview3DRef.current,
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
      undefined,
      texturePreview3DRef.current,
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

  // Toggling between flat 2D image-viewer framing and orbitable 3D
  // plane preview only takes effect when a texture is currently
  // mounted; otherwise the viewport is showing the asset and the
  // flag is irrelevant until the user enters texture mode.
  useEffect(() => {
    const context = sceneContextRef.current;
    if (!context?.mountedObject || viewerSurfaceModeRef.current !== "texture") {
      return;
    }
    frameMountedObject(
      context,
      context.mountedObject,
      viewerSurfaceModeRef.current,
      showGridRef.current,
      showAxesRef.current,
      cameraSpeedMultiplierRef.current,
      undefined,
      texturePreview3D,
    );
  }, [texturePreview3D]);

  useEffect(() => {
    resetCameraRef.current?.();
  }, [resetVersion]);

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
          <ViewerStatePanel
            fileExtension={currentFile?.extension}
            fileName={currentFile?.fileName}
            loadingStage={loadingStage}
            mode={effectiveOverlayMode}
            onOpenFile={onOpenFile}
          />
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
