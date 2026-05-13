import type {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Group,
  Mesh,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  Texture,
  WebGLRenderer,
} from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { ViewerMode } from "../components/ViewerStatePanel";

export type { ViewerMode };

export type ViewerFeedback = {
  mode: ViewerMode;
  message: string;
  warning: string | null;
  canResetCamera: boolean;
};

export type DisplayMode =
  | "textured"
  | "untextured"
  | "wireframe"
  | "texturedWireframe";

export type ViewerSurfaceMode = "asset" | "texture";

export type TextureViewMode = "rgb" | "rgba" | "r" | "g" | "b" | "alpha";

export type SceneContext = {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  pmremGenerator: PMREMGenerator;
  mountedObject: Group | Mesh | null;
  sourceObject: Group | Mesh | null;
  previewObject: Group | Mesh | null;
  cleanupUrls: string[];
  cleanupCallbacks: Array<() => void>;
  mixer: AnimationMixer | null;
  clips: AnimationClip[];
  activeAction: AnimationAction | null;
  textureRegistry: Map<string, Texture>;
  /**
   * Original (pre-normalization) max dimension of the last loaded asset in
   * scene units. Used to compute camera sensitivity so that assets that are
   * scale-normalized still get speed values appropriate for their real size.
   */
  rawMaxDimension: number;
};

export type LoadedPreview = {
  object: Group | Mesh;
  cleanupUrls: string[];
  cleanupCallbacks?: Array<() => void>;
  clips: AnimationClip[];
  formatVersion: string | null;
  warnings?: string[];
};

export type DeferredTextureSnapshot = {
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

export type MissingReferenceError = Error & {
  formatVersion: string | null;
  missingPaths: string[];
  unresolvedImages: string[];
};

export type PreviewSupportState =
  | "implemented"
  | "missingOptionalLoader"
  | "unsupported";

export const implementedPreviewExtensions = new Set([
  "glb",
  "gltf",
  "vrm",
  "pmd",
  "pmx",
  "fbx",
  "obj",
  "ply",
  "stl",
  "dae",
  "usd",
  "usda",
  "usdc",
  "usdz",
  "png",
  "jpg",
  "jpeg",
  "tga",
  "dds",
  "hdr",
  "exr",
  "ktx2",
]);

export const optionalPreviewLoaders = {
  vrm: {
    formatLabel: "VRM",
    loaderPackName: "VRM Loader Pack",
  },
  vrma: {
    formatLabel: "VRMA",
    loaderPackName: "VRM Loader Pack",
  },
  pmd: {
    formatLabel: "PMD",
    loaderPackName: "MMD Loader Pack",
  },
  pmx: {
    formatLabel: "PMX",
    loaderPackName: "MMD Loader Pack",
  },
  vmd: {
    formatLabel: "VMD",
    loaderPackName: "MMD Loader Pack",
  },
  abc: {
    formatLabel: "Alembic",
    loaderPackName: "Alembic Loader Pack",
  },
} as const satisfies Record<
  string,
  {
    formatLabel: string;
    loaderPackName: string;
  }
>;

export function getPreviewSupportState(extension: string): PreviewSupportState {
  if (implementedPreviewExtensions.has(extension)) {
    return "implemented";
  }

  if (extension in optionalPreviewLoaders) {
    return "missingOptionalLoader";
  }

  return "unsupported";
}

export function formatMissingOptionalLoaderMessage(extension: string) {
  const optionalLoader =
    optionalPreviewLoaders[extension as keyof typeof optionalPreviewLoaders];

  if (!optionalLoader) {
    return null;
  }

  return {
    title: `${optionalLoader.loaderPackName} is not installed.`,
    body: `Install ${optionalLoader.loaderPackName} to preview ${optionalLoader.formatLabel} files.`,
  };
}

export function formatUnsupportedFormatMessage(extension: string) {
  const normalizedExtension = extension ? `.${extension}` : "this extension";
  return {
    title: "This file format is not supported yet.",
    body: `No preview loader is available for ${normalizedExtension}. Supported core formats include GLB, glTF, FBX, OBJ, USD, STL, PLY, DAE, PNG, JPG, TGA, DDS, HDR, EXR, and KTX2.`,
  };
}

export const neutralFeedback: ViewerFeedback = {
  mode: "empty",
  message: "Open a supported asset to initialize the preview scene.",
  warning: null,
  canResetCamera: false,
};
