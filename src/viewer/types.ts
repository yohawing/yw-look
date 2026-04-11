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
  mixer: AnimationMixer | null;
  clips: AnimationClip[];
  activeAction: AnimationAction | null;
  textureRegistry: Map<string, Texture>;
};

export type LoadedPreview = {
  object: Group | Mesh;
  cleanupUrls: string[];
  clips: AnimationClip[];
  formatVersion: string | null;
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

export const implementedPreviewExtensions = new Set([
  "glb",
  "gltf",
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
]);

export const neutralFeedback: ViewerFeedback = {
  mode: "empty",
  message: "Open a supported asset to initialize the preview scene.",
  warning: null,
  canResetCamera: false,
};
