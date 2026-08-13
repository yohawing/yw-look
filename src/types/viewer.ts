import type {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Group,
  Mesh,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Texture,
  WebGLRenderer,
  ColorSpace,
  ToneMapping,
} from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PackRuntime } from "./format-pack";

// ── Viewer mode & feedback ───────────────────────────────────────

export type ViewerMode =
  | "empty"
  | "loading"
  | "ready"
  | "unsupported"
  | "missingOptionalLoader"
  | "disabledOptionalLoader"
  | "incompatibleOptionalLoader"
  | "loadFailed"
  | "missingReference";

export type ViewerFeedback = {
  mode: ViewerMode;
  message: string;
  warning: string | null;
  canResetCamera: boolean;
};

// ── Display & surface ────────────────────────────────────────────

export type DisplayMode =
  | "textured"
  | "untextured"
  | "wireframe"
  | "texturedWireframe";

export type ViewportDisplayFlags = {
  showTexture: boolean;
  showWireframe: boolean;
  showUnlit: boolean;
  showNormals?: boolean;
  showVertexColors?: boolean;
};

/** Mutually exclusive surface display choices in the viewport Display popover. */
export type ViewportSurfaceDisplay =
  | "shaded"
  | "unlit"
  | "normals"
  | "vertexColor";

/** Tri-state wireframe overlay mode in the viewport Display popover. */
export type ViewportWireframeMode = "off" | "overlay" | "only";

export type ViewportDisplayState = {
  surface: ViewportSurfaceDisplay;
  wireframe: ViewportWireframeMode;
  displayMode: DisplayMode;
};

export function deriveDisplayMode(
  flags: Pick<ViewportDisplayFlags, "showTexture" | "showWireframe">,
): DisplayMode {
  if (flags.showTexture && flags.showWireframe) return "texturedWireframe";
  if (flags.showTexture) return "textured";
  if (flags.showWireframe) return "wireframe";
  return "untextured";
}

export function deriveDisplayFlags(displayMode: DisplayMode) {
  return {
    showTexture:
      displayMode === "textured" || displayMode === "texturedWireframe",
    showWireframe:
      displayMode === "wireframe" || displayMode === "texturedWireframe",
  };
}

export function deriveViewportSurfaceDisplay(flags: {
  showUnlit: boolean;
  showNormals?: boolean;
  showVertexColors?: boolean;
}): ViewportSurfaceDisplay {
  if (flags.showVertexColors && !flags.showUnlit && !flags.showNormals) {
    return "vertexColor";
  }
  if (flags.showNormals && !flags.showUnlit && !flags.showVertexColors) {
    return "normals";
  }
  if (flags.showUnlit && !flags.showNormals && !flags.showVertexColors) {
    return "unlit";
  }
  return "shaded";
}

export function deriveViewportWireframeMode(flags: {
  showWireframe: boolean;
  showTexture: boolean;
}): ViewportWireframeMode {
  if (!flags.showWireframe) return "off";
  if (flags.showTexture) return "overlay";
  return "only";
}

export function deriveViewportDisplayState(
  flags: ViewportDisplayFlags,
): ViewportDisplayState {
  return {
    surface: deriveViewportSurfaceDisplay(flags),
    wireframe: deriveViewportWireframeMode(flags),
    displayMode: deriveDisplayMode(flags),
  };
}

export type ViewerSurfaceMode = "asset" | "texture";

export type TextureViewMode = "rgb" | "rgba" | "r" | "g" | "b" | "alpha";

// ── Scene context (Three.js handles) ─────────────────────────────

export type SceneContext = {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  pmremGenerator: PMREMGenerator;
  mountedObject: Group | Mesh | null;
  sourceObject: Group | Mesh | null;
  previewObject: Group | Mesh | null;
  boneOnlyPreview: boolean;
  cleanupUrls: string[];
  cleanupCallbacks: Array<() => void>;
  animationRoot: Object3D | null;
  mixer: AnimationMixer | null;
  clips: AnimationClip[];
  activeAction: AnimationAction | null;
  packRuntime: PackRuntime | null;
  mmdModel: MmdRuntimeModelHandle | null;
  mmdMotion: MmdMotionPlayback | null;
  /** Stable MMD light/specular synchronizer captured when a model mounts. */
  mmdLightSync: MmdPreviewLightSync | null;
  textureRegistry: Map<string, Texture>;
  rawMaxDimension: number;
};

// ── MMD runtime types ────────────────────────────────────────────

export type MmdAnimationHandle = {
  metadata: {
    maxFrame?: number;
  };
};

/** Runtime-sampled VMD light state, in the parser's MMD direction convention. */
export type MmdLightState = {
  color: readonly [number, number, number];
  direction: readonly [number, number, number];
};

/** Applies the current runtime light state to the mounted viewport light. */
export type MmdPreviewLightSync = () => void;

export type MmdRuntimeModelHandle = {
  root?: Object3D;
  mesh: Object3D;
  outlineMeshes?: Object3D[];
  renderOrderMeshes?: Object3D[];
  syncMaterialMorphs?: (
    directWeights?: Readonly<Record<number, number>>,
  ) => void;
  runtime?: {
    reset(time: number): void;
    setAnimation(animation: MmdAnimationHandle, mesh: Object3D): void;
    tick(
      time: number,
      options: {
        mesh: Object3D;
        ik?: boolean;
        physics?: boolean;
      },
    ): void;
    lightState?(): MmdLightState | undefined;
  };
};

export type MmdMotionPlayback = {
  animation: MmdAnimationHandle;
  duration: number;
  currentTime: number;
  label: string;
};

// ── Loaded preview ───────────────────────────────────────────────

/**
 * Viewer-side asset classification (Issue #98). Distinct from the
 * extension-based file `AssetKind` in `src/types/file.ts`: this reflects what
 * the loaded content actually is so the viewport / Detail panel can switch
 * renderer-appropriate UI. `.ply` is classified by header content into one of
 * these; other formats default to `mesh`.
 */
export type ViewerAssetKind =
  | "mesh"
  | "pointCloud"
  | "gaussianSplat"
  | "motion";

export type LoadedPreview = {
  object: Group | Mesh;
  cleanupUrls: string[];
  cleanupCallbacks?: Array<() => void>;
  clips: AnimationClip[];
  formatVersion: string | null;
  warnings?: string[];
  lighting?: PreviewLightingPreset;
  rendering?: PreviewRenderingPreset;
  skipScaleNormalization?: boolean;
  mmdModel?: MmdRuntimeModelHandle;
  /** Motion already bound to `mmdModel`, used by standalone motion previews. */
  mmdMotion?: LoadedMmdMotion;
  /**
   * Viewer-side classification of the loaded content. Omitted ⇒ treated as
   * `mesh`. Point clouds and Gaussian splats wrap their specialized object
   * (`THREE.Points` / Spark `SplatMesh`) in a `Group` so this stays the
   * existing `Group | Mesh` shape.
   */
  assetKind?: ViewerAssetKind;
};

export type LoadedMmdMotion = {
  animation: MmdAnimationHandle;
  duration: number;
  label: string;
};

// ── Loading stage ────────────────────────────────────────────────

export type DeferredTextureSnapshot = {
  kind?: "texture" | "payload";
  total: number;
  loaded: number;
  failed: number;
  pending: number;
  activeLabel: string | null;
  bytes?: number;
  readMs?: number;
  parseMs?: number;
};

export type LoadingStageId =
  | "scan"
  | "resolve"
  | "decode"
  | "gpu"
  | "scene"
  | "ui";

export type LoadingStageReporter = (stage: LoadingStageId) => void;

export type LoadingStageSnapshot = {
  activeStage: LoadingStageId;
  activeStageStartedAt: number;
  elapsedByStage: Partial<Record<LoadingStageId, number>>;
  totalElapsedMs: number;
};

// ── Texture bundle ───────────────────────────────────────────────

export type TextureBundle = {
  albedo: Texture | null;
  normal: Texture | null;
  metalness: Texture | null;
  roughness: Texture | null;
  cleanupUrls: string[];
};

export type TextureSlotKey =
  | "map"
  | "normalMap"
  | "metalnessMap"
  | "roughnessMap"
  | "emissiveMap"
  | "alphaMap";

export type TexturedMaterial = import("three").Material &
  Partial<Record<TextureSlotKey, Texture | null>>;

// ── Missing reference ────────────────────────────────────────────

export type MissingReferenceError = Error & {
  formatVersion: string | null;
  missingPaths: string[];
  unresolvedImages: string[];
};

// ── Preview support ──────────────────────────────────────────────

export type PreviewSupportState =
  | "implemented"
  | "missingOptionalLoader"
  | "disabledOptionalLoader"
  | "incompatibleOptionalLoader"
  | "unsupported";

// ── Scene config (grid, scale, camera, texture filter) ───────────

export type CameraPreset =
  | "front"
  | "back"
  | "left"
  | "right"
  | "top"
  | "bottom";

export type GridConfig = {
  cellSize: number;
  label: string;
  size: number;
  divisions: number;
};

export type ScaleNormalizationResult = {
  applied: boolean;
  factor: number;
  originalMaxDimension: number;
  normalizedMaxDimension: number;
  originalScale: import("three").Vector3 | null;
};

export type TextureFilterMode = "nearest" | "linear" | "trilinear";

// ── Rendering & lighting presets ─────────────────────────────────

export type PreviewRenderingPreset = {
  logarithmicDepthBuffer: boolean;
  outputColorSpace: ColorSpace;
  toneMapping: ToneMapping;
  toneMappingExposure: number;
};

export type PreviewLightingPreset = {
  ambientIntensity: number;
  keyIntensity: number;
  keyPosition: readonly [number, number, number];
  fillIntensity: number;
};

// ── Screenshot ───────────────────────────────────────────────────

export type CanvasScreenshotOptions = {
  mimeType?: "image/png" | "image/jpeg" | "image/webp";
  quality?: number;
  beforeCapture?: () => void;
};

export type CanvasScreenshot = {
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
};

export type AssetViewportApi = {
  captureScreenshot: (
    options?: CanvasScreenshotOptions,
  ) => Promise<CanvasScreenshot>;
};

// ── Loader registry ──────────────────────────────────────────────

export type LoaderContext = {
  renderer?: WebGLRenderer;
  usdLoadPolicy?: import("./ipc").StageLoadPolicy;
  getUsdInspection?: () => import("./ipc").StageInspection | null;
  variantSelections?: import("./ipc").VariantSelection[];
  glbOverride?: ArrayBuffer | null;
  disabledOptionalLoaderPackIds?: readonly string[] | ReadonlySet<string>;
  incompatibleOptionalLoaderPackIds?: readonly string[] | ReadonlySet<string>;
  onStage?: LoadingStageReporter;
  onDeferredTexture?: (snapshot: DeferredTextureSnapshot) => void;
  onWarning?: (warning: string) => void;
  signal?: AbortSignal;
  parseTimeoutMs?: number;
};

export type LoaderPlugin = {
  id: string;
  name: string;
  extensions: readonly string[];
  optional?: boolean;
  installed?: boolean;
  loadPreviewObject: (
    file: import("./file").SelectedFile,
    context: LoaderContext,
  ) => Promise<LoadedPreview>;
};

export type RegisteredLoaderInfo = {
  id: string;
  name: string;
  extension: string;
  optional: boolean;
  installed: boolean;
};

export type OptionalLoaderPackStatus = {
  id: string;
  name: string;
  extensions: readonly string[];
  installed: boolean;
  enabled: boolean;
  manifestInstalled: boolean;
  runtimeAvailable: boolean;
  version?: string;
  compatibility: {
    state:
      | "compatible"
      | "bundled"
      | "disabled"
      | "manifestMissing"
      | "requiresNewerApp"
      | "requiresOlderApp"
      | "runtimeMissing"
      | "unknown";
    label: string;
    detail?: string;
  };
};

// ── Metadata collection ──────────────────────────────────────────

export type MetadataCollection = {
  metadata: AssetMetadata;
  textureRegistry: Map<string, Texture>;
};

// ── Hierarchy ────────────────────────────────────────────────────

export type HierarchyNode = {
  name: string;
  displayName?: string;
  kind: string;
  children: HierarchyNode[];
  primPath?: string;
};

// ── Textures ─────────────────────────────────────────────────────

export type TextureEntry = {
  id: string;
  label: string;
  channel: string;
  dimensions: string;
  thumbnailUrl: string | null;
  previewFlipY?: boolean;
  sourceKind: "embedded" | "external" | "standalone" | "unresolved" | "unknown";
};

// ── Material texture slot ────────────────────────────────────────

export type MaterialTextureSlot = {
  name: string;
};

// ── MMD material ─────────────────────────────────────────────────

export type MmdMaterialEntry = {
  materialIndex: number | null;
  name: string;
  englishName: string | null;
  diffuse: [number, number, number, number] | null;
  specular: [number, number, number] | null;
  ambient: [number, number, number] | null;
  specularPower: number | null;
  edgeColor: [number, number, number, number] | null;
  edgeSize: number | null;
  texturePath: string | null;
  sphereTexturePath: string | null;
  sphereMode: string | null;
  toonTexturePath: string | null;
  sharedToonIndex: number | null;
  transparencyMode: string | null;
  renderOrderBucket: string | null;
  faceCount: number | null;
  flags: Record<string, boolean> | null;
  unsupportedDrawFlags: string[];
};

// ── Material entry ───────────────────────────────────────────────

export type MaterialEntry = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  opacity: number;
  transparent: boolean;
  textureCount: number;
  boundMeshes: string[];
  baseColorFactor: [number, number, number, number] | null;
  metallicFactor: number | null;
  roughnessFactor: number | null;
  emissiveFactor: [number, number, number] | null;
  baseColorTexture: MaterialTextureSlot | null;
  metallicRoughnessTexture: MaterialTextureSlot | null;
  normalTexture: MaterialTextureSlot | null;
  emissiveTexture: MaterialTextureSlot | null;
  alphaMode: "OPAQUE" | "MASK" | "BLEND" | "unknown";
  usdPrimPath: string | null;
  mmd: MmdMaterialEntry | null;
};

// ── Animation metadata ───────────────────────────────────────────

export type AnimationTrackMetadata = {
  name: string;
  target: string;
  propertyPath: string;
  keyframeCount: number;
  timeRange: [number, number];
  interpolation: "linear" | "discrete" | "smooth" | "unknown";
};

export type AnimationClipMetadata = {
  name: string;
  duration: number;
  trackCount: number;
  keyframeCount: number;
  estimatedFrameRate: number | null;
  tracks: AnimationTrackMetadata[];
};

// ── Light entry ──────────────────────────────────────────────────

export type LightEntry = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  intensity: number;
};

// ── Camera entry ─────────────────────────────────────────────────

export type CameraEntry = {
  id: string;
  name: string;
  projection: "perspective" | "orthographic";
  fov: number | null;
  aspect: number | null;
  near: number;
  far: number;
};

// ── MMD asset metadata ───────────────────────────────────────────

export type MmdSectionEntry = {
  name: string;
  count: number;
  offset: number;
  byteLength: number;
};

export type MmdAssetMetadata = {
  format: "pmx" | "pmd" | "vmd";
  version: number | null;
  encoding: string | null;
  name: string;
  englishName: string;
  comment: string;
  englishComment: string;
  counts: Record<string, number>;
  additionalUvCount: number | null;
  indexSizes: Record<string, number> | null;
  trailingBytes: number;
  sections: MmdSectionEntry[];
  diagnostics: Array<{
    level: "warning" | "error";
    code: string;
    message: string;
  }>;
};

export type MmdBoneEntry = {
  boneIndex: number | null;
  parentIndex: number | null;
  parentName: string | null;
  name: string | null;
  englishName: string | null;
  restPosition: [number, number, number] | null;
  layer: number | null;
  appendTransform: {
    parentIndex: number;
    parentName: string | null;
    weight: number;
  } | null;
  flags: Record<string, boolean> | null;
  ik: {
    roles: string[];
    goalBoneIndex: number | null;
    effectorBoneIndex: number | null;
    iterationCount: number | null;
    maxAnglePerIteration: number | null;
    linkCount: number | null;
    limitKinds: string[];
  } | null;
};

export type MmdMorphEntry = {
  name: string | null;
  englishName: string | null;
  type: string | null;
  boneOffsetCount: number;
  groupOffsetCount: number;
  flipOffsetCount: number;
  impulseOffsetCount: number;
};

// ── Object info ──────────────────────────────────────────────────

export type ObjectInfo = {
  name: string;
  kind: string;
  visible: boolean;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  boundingBox: [number, number, number, number, number, number] | null;
  vertexCount: number | null;
  triangleCount: number | null;
  materialNames: string[];
  materialIds: string[];
  morphTargets: MorphTargetEntry[];
  childCount: number | null;
  animatesWithClips: string[];
  userData: Record<string, unknown> | null;
  mmdBone: MmdBoneEntry | null;
};

export type MorphTargetEntry = {
  index: number;
  name: string;
  value: number;
  mmd: MmdMorphEntry | null;
};

// ── Top-level asset metadata ─────────────────────────────────────

export type AssetMetadata = {
  formatLabel: string;
  formatVersion: string | null;
  /**
   * Viewer-side asset classification (Issue #98). Defaults to `mesh` for
   * formats that don't distinguish point clouds / Gaussian splats.
   */
  assetKind?: ViewerAssetKind;
  nodeCount: number;
  meshCount: number;
  boneCount?: number;
  hasBones?: boolean;
  materialCount: number;
  textureCount: number;
  hasAnimation: boolean;
  animationClips?: AnimationClipMetadata[];
  hierarchy: HierarchyNode[];
  textures: TextureEntry[];
  materials: MaterialEntry[];
  lights: LightEntry[];
  cameras: CameraEntry[];
  objectInfo: Record<string, ObjectInfo>;
  mmd?: MmdAssetMetadata;
};

// ── AssetViewport viewer settings ────────────────────────────────

export type BackgroundPreset = "gray" | "charcoal" | "light";

export type EnvironmentPreset = "studio" | "neutral" | "outdoor";

export type ToneMappingMode = "linear" | "aces" | "reinhard";

// ── Image toolbar ────────────────────────────────────────────────

export type TextureColorSpace = "srgb" | "linear" | "raw";

export type BuildImageToolbarOptions = {
  channelMode: string | null;
  channelOptions: Array<{ id: string; label: string }>;
  onSelectChannel?: (mode: string) => void;
  colorSpace: TextureColorSpace;
  onSelectColorSpace?: (mode: TextureColorSpace) => void;
  exposure: number;
  bgMode: string;
  onSelectBgMode?: (mode: string) => void;
  tilingMode: string;
  onSelectTilingMode?: (mode: string) => void;
  tileCount: number;
};

// ── 3D toolbar ───────────────────────────────────────────────────

export type Build3DToolbarOptions = {
  cameraPreset: string | null;
  cameraPresetOptions: Array<{ id: string; label: string }>;
  onSelectCameraPreset?: (preset: string) => void;
  showTexture: boolean;
  onToggleTexture: () => void;
  showUnlit: boolean;
  onToggleUnlit: () => void;
  showNormals?: boolean;
  onToggleNormals?: () => void;
  showVertexColors?: boolean;
  onToggleVertexColors?: () => void;
  showWireframe: boolean;
  onToggleWireframe: () => void;
  environmentPreset: string;
  environmentPresetOptions: Array<{ id: string; label: string }>;
  onSelectEnvironmentPreset?: (preset: string) => void;
  showShadows?: boolean;
  onToggleShadows?: () => void;
  showEnvironmentBackground?: boolean;
  onToggleEnvironmentBackground?: () => void;
  showBoundingBoxes?: boolean;
  onToggleBoundingBoxes?: () => void;
  showSkeleton?: boolean;
  onToggleSkeleton?: () => void;
  showLocalAxis?: boolean;
  onToggleLocalAxis?: () => void;
  showJointNames?: boolean;
  onToggleJointNames?: () => void;
};

// ── Animation state ──────────────────────────────────────────────

export type AnimationState = {
  clipNames: string[];
  activeClipIndex: number;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
};

export const emptyAnimationState: AnimationState = {
  clipNames: [],
  activeClipIndex: 0,
  currentTime: 0,
  duration: 0,
  isPlaying: false,
};
