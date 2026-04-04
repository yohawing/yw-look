import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Box3,
  BufferGeometry,
  Color,
  CompressedTexture,
  DataTexture,
  DirectionalLight,
  Group,
  Material,
  MathUtils,
  MOUSE,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { SelectedFile, readBinaryFile } from "../lib/files";
import { AnimationBar } from "./AnimationBar";
import {
  emptyAssetMetadata,
  type AssetMetadata,
  type HierarchyNode,
} from "./assetMetadata";
import { emptyAnimationState, type AnimationState } from "./animation";
import { ViewerMode, ViewerStatePanel } from "./ViewerStatePanel";

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

export type TextureViewMode = "rgb" | "rgba" | "alpha";

type AssetViewportProps = {
  currentFile: SelectedFile | null;
  displayMode: DisplayMode;
  onFeedbackChange: (feedback: ViewerFeedback) => void;
  onMetadataChange: (metadata: AssetMetadata | null) => void;
  selectedTextureId: string | null;
  textureViewMode: TextureViewMode;
  viewerSurfaceMode: ViewerSurfaceMode;
  textureExposure: number;
  textureBlackPoint: number;
  textureWhitePoint: number;
  resetVersion: number;
};

type SceneContext = {
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

type LoadedPreview = {
  object: Group | Mesh;
  cleanupUrls: string[];
  clips: AnimationClip[];
  formatVersion: string | null;
};

type TextureBundle = {
  albedo: Texture | null;
  normal: Texture | null;
  metalness: Texture | null;
  roughness: Texture | null;
  cleanupUrls: string[];
};

type TextureSlotKey =
  | "map"
  | "normalMap"
  | "metalnessMap"
  | "roughnessMap"
  | "emissiveMap"
  | "alphaMap";

type TexturedMaterial = Material & Partial<Record<TextureSlotKey, Texture | null>>;

type MetadataCollection = {
  metadata: AssetMetadata;
  textureRegistry: Map<string, Texture>;
};

type MissingReferenceError = Error & {
  formatVersion: string | null;
  missingPaths: string[];
  unresolvedImages: string[];
};

const implementedPreviewExtensions = new Set([
  "glb",
  "gltf",
  "fbx",
  "obj",
  "ply",
  "stl",
  "png",
  "jpg",
  "jpeg",
  "tga",
  "dds",
  "hdr",
  "exr",
]);

const neutralFeedback: ViewerFeedback = {
  mode: "empty",
  message: "Open a supported asset to initialize the preview scene.",
  warning: null,
  canResetCamera: false,
};

function getMaterials(material: Material | Material[]) {
  return Array.isArray(material) ? material : [material];
}

function disposeMaterialTextures(material: Material) {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) {
      value.dispose();
    }
  }
}

function revokeUrls(urls: string[]) {
  for (const url of urls) {
    URL.revokeObjectURL(url);
  }
}

function disposeObject(object: Group | Mesh | null) {
  if (!object) {
    return;
  }

  object.traverse((child: Object3D) => {
    if (child instanceof Mesh && child.geometry instanceof BufferGeometry) {
      child.geometry.dispose();
    }

    if (child instanceof Mesh) {
      for (const material of getMaterials(child.material)) {
        if (!material) {
          continue;
        }

        disposeMaterialTextures(material);
        material.dispose();
      }
    }
  });
}

function disposePreviewObject(object: Group | Mesh | null) {
  if (!object) {
    return;
  }

  object.traverse((child: Object3D) => {
    if (child instanceof Mesh && child.geometry instanceof BufferGeometry) {
      child.geometry.dispose();
    }

    if (child instanceof Mesh) {
      for (const material of getMaterials(child.material)) {
        material.dispose();
      }
    }
  });
}

function stopAnimations(context: SceneContext) {
  context.activeAction?.stop();
  context.mixer?.stopAllAction();
  context.activeAction = null;
  context.mixer = null;
  context.clips = [];
}

function resetSceneObjects(context: SceneContext) {
  if (context.previewObject) {
    context.scene.remove(context.previewObject);
    disposePreviewObject(context.previewObject);
    context.previewObject = null;
  }

  if (context.sourceObject) {
    context.scene.remove(context.sourceObject);
    disposeObject(context.sourceObject);
    context.sourceObject = null;
  }

  context.mountedObject = null;
  context.textureRegistry = new Map<string, Texture>();
}

async function readArrayBuffer(path: string) {
  const bytes = await readBinaryFile(path);
  return Uint8Array.from(bytes).buffer;
}

async function readTextFile(path: string) {
  const buffer = await readArrayBuffer(path);
  return new TextDecoder().decode(buffer);
}

function getMimeType(extension: string) {
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "tga":
      return "image/x-tga";
    case "dds":
      return "image/vnd-ms.dds";
    case "hdr":
      return "image/vnd.radiance";
    case "exr":
      return "image/x-exr";
    case "bin":
      return "application/octet-stream";
    default:
      return "application/octet-stream";
  }
}

function resolveSiblingPath(baseDirectory: string, relativePath: string) {
  const isWindowsPath = /^[a-zA-Z]:\\/.test(baseDirectory);
  const separator = isWindowsPath ? "\\" : "/";
  const normalizedBase = baseDirectory.replace(/[\\/]+/g, "/");
  const normalizedRelative = relativePath.replace(/[\\/]+/g, "/");
  const prefixMatch = normalizedBase.match(/^[a-zA-Z]:/);
  const prefix = prefixMatch
    ? `${prefixMatch[0]}${separator}`
    : normalizedBase.startsWith("/")
      ? separator
      : "";

  const baseSegments = normalizedBase
    .replace(/^[a-zA-Z]:/, "")
    .split("/")
    .filter(Boolean);
  const relativeSegments = normalizedRelative.split("/").filter(Boolean);
  const segments = [...baseSegments];

  for (const segment of relativeSegments) {
    if (segment === ".") {
      continue;
    }

    if (segment === "..") {
      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return `${prefix}${segments.join(separator)}`;
}

async function createBlobUrlFromPath(path: string, extension: string) {
  const buffer = await readArrayBuffer(path);
  const blob = new Blob([buffer], { type: getMimeType(extension) });
  return URL.createObjectURL(blob);
}

async function materializeGltf(file: SelectedFile) {
  const rawText = await readTextFile(file.path);
  const json = JSON.parse(rawText) as {
    asset?: { version?: string };
    buffers?: Array<{ uri?: string }>;
    images?: Array<{ uri?: string }>;
  };
  const cleanupUrls: string[] = [];
  const missingPaths: string[] = [];
  const unresolvedImages: string[] = [];

  const rewriteUri = async (uri: string) => {
    if (/^(data:|blob:|https?:)/i.test(uri)) {
      return uri;
    }

    const resourcePath = resolveSiblingPath(file.parentDirectory, uri);
    const extension = uri.includes(".")
      ? (uri.split(".").pop() ?? "bin")
      : "bin";
    let objectUrl: string;

    try {
      objectUrl = await createBlobUrlFromPath(resourcePath, extension.toLowerCase());
    } catch {
      missingPaths.push(uri);
      throw new Error(`Missing reference: ${uri}`);
    }

    cleanupUrls.push(objectUrl);
    return objectUrl;
  };

  if (json.buffers) {
    for (const buffer of json.buffers) {
      if (buffer.uri) {
        buffer.uri = await rewriteUri(buffer.uri);
      }
    }
  }

  if (json.images) {
    for (const image of json.images) {
      if (image.uri) {
        try {
          image.uri = await rewriteUri(image.uri);
        } catch {
          unresolvedImages.push(image.uri);
        }
      }
    }
  }

  if (missingPaths.length > 0) {
    revokeUrls(cleanupUrls);
    const error = new Error(
      `Missing reference: ${missingPaths.join(", ")}`,
    ) as MissingReferenceError;
    error.formatVersion = json.asset?.version ?? null;
    error.missingPaths = missingPaths;
    error.unresolvedImages = unresolvedImages;
    throw error;
  }

  const rootUrl = URL.createObjectURL(
    new Blob([JSON.stringify(json)], { type: "model/gltf+json" }),
  );
  cleanupUrls.push(rootUrl);

  return {
    rootUrl,
    cleanupUrls,
    formatVersion: json.asset?.version ?? null,
  };
}

function createTexturePreview(
  texture:
    | DataTexture
    | CompressedTexture
    | Awaited<ReturnType<TextureLoader["loadAsync"]>>,
) {
  const image = "image" in texture ? texture.image : null;
  const widthValue = image && typeof image.width === "number" ? image.width : 1;
  const heightValue =
    image && typeof image.height === "number" ? image.height : 1;
  const ratio = widthValue / heightValue || 1;
  const width = ratio >= 1 ? 2.2 : 2.2 * ratio;
  const height = ratio >= 1 ? 2.2 / ratio : 2.2;

  return new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({ map: texture, transparent: true }),
  );
}

function createTextureViewerObject(
  texture: Texture,
  textureViewMode: TextureViewMode,
  textureExposure: number,
  textureBlackPoint: number,
  textureWhitePoint: number,
) {
  const image = texture.image as { width?: number; height?: number } | undefined;
  const widthValue =
    image && typeof image.width === "number" ? image.width : 1;
  const heightValue =
    image && typeof image.height === "number" ? image.height : 1;
  const ratio = widthValue / heightValue || 1;
  const width = ratio >= 1 ? 2.6 : 2.6 * ratio;
  const height = ratio >= 1 ? 2.6 / ratio : 2.6;

  return new Mesh(
    new PlaneGeometry(width, height),
    new ShaderMaterial({
      transparent: false,
      uniforms: {
        uTexture: { value: texture },
        uMode: {
          value:
            textureViewMode === "rgb"
              ? 0
              : textureViewMode === "rgba"
                ? 1
                : 2,
        },
        uExposure: { value: textureExposure },
        uBlackPoint: { value: textureBlackPoint },
        uWhitePoint: { value: textureWhitePoint },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        uniform int uMode;
        uniform float uExposure;
        uniform float uBlackPoint;
        uniform float uWhitePoint;
        varying vec2 vUv;

        vec3 checker(vec2 uv) {
          float scale = 18.0;
          float cell = mod(floor(uv.x * scale) + floor(uv.y * scale), 2.0);
          return mix(vec3(0.18), vec3(0.32), cell);
        }

        vec3 remapRange(vec3 color) {
          float safeRange = max(uWhitePoint - uBlackPoint, 0.0001);
          vec3 shifted = max(color * exp2(uExposure) - vec3(uBlackPoint), vec3(0.0));
          return clamp(shifted / safeRange, 0.0, 1.0);
        }

        float remapScalar(float value) {
          float safeRange = max(uWhitePoint - uBlackPoint, 0.0001);
          float shifted = max(value * exp2(uExposure) - uBlackPoint, 0.0);
          return clamp(shifted / safeRange, 0.0, 1.0);
        }

        void main() {
          vec4 texel = texture2D(uTexture, vUv);
          vec3 color = remapRange(texel.rgb);
          float alphaValue = remapScalar(texel.a);

          if (uMode == 0) {
            gl_FragColor = vec4(color, 1.0);
            return;
          }

          if (uMode == 1) {
            vec3 composite = mix(checker(vUv), color, alphaValue);
            gl_FragColor = vec4(composite, 1.0);
            return;
          }

          gl_FragColor = vec4(vec3(alphaValue), 1.0);
        }
      `,
    }),
  );
}

async function tryLoadTextureFromPath(path: string) {
  try {
    const extension = path.split(".").pop()?.toLowerCase() ?? "bin";
    const objectUrl = await createBlobUrlFromPath(path, extension);
    const texture = await new TextureLoader().loadAsync(objectUrl);
    texture.colorSpace = SRGBColorSpace;
    texture.userData.textureSourceKind = "external";
    return { texture, objectUrl };
  } catch {
    return null;
  }
}

async function buildObjTextureBundle(file: SelectedFile): Promise<TextureBundle> {
  const baseName = file.fileName.replace(/\.[^.]+$/, "");
  const candidates = {
    albedo: [`${baseName}_A.jpg`, `${baseName}_A.png`],
    normal: [`${baseName}_N.jpg`, `${baseName}_N.png`],
    metalness: [`${baseName}_M.jpg`, `${baseName}_M.png`],
    roughness: [
      `${baseName}_R.jpg`,
      `${baseName}_R.png`,
      `${baseName}_RM.jpg`,
      `${baseName}_RM.png`,
    ],
  };

  const cleanupUrls: string[] = [];
  const result: TextureBundle = {
    albedo: null,
    normal: null,
    metalness: null,
    roughness: null,
    cleanupUrls,
  };

  for (const [key, fileNames] of Object.entries(candidates) as Array<
    [keyof Omit<TextureBundle, "cleanupUrls">, string[]]
  >) {
    for (const fileName of fileNames) {
      const resolvedPath = resolveSiblingPath(file.parentDirectory, fileName);
      const loaded = await tryLoadTextureFromPath(resolvedPath);

      if (loaded) {
        loaded.texture.name = fileName;
        result[key] = loaded.texture;
        cleanupUrls.push(loaded.objectUrl);
        break;
      }
    }
  }

  return result;
}

function applyObjTextureBundle(object: Group, bundle: TextureBundle) {
  if (!bundle.albedo && !bundle.normal && !bundle.metalness && !bundle.roughness) {
    return;
  }

  object.traverse((child: Object3D) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    child.material = new MeshStandardMaterial({
      color: "#ffffff",
      map: bundle.albedo,
      normalMap: bundle.normal,
      metalnessMap: bundle.metalness,
      roughnessMap: bundle.roughness,
      metalness: bundle.metalness ? 1 : 0.18,
      roughness: bundle.roughness ? 1 : 0.55,
    });
  });
}

async function loadPreviewObject(file: SelectedFile): Promise<LoadedPreview> {
  switch (file.extension) {
    case "glb": {
      const { GLTFLoader } =
        await import("three/examples/jsm/loaders/GLTFLoader.js");
      const buffer = await readArrayBuffer(file.path);
      const gltf = await new GLTFLoader().parseAsync(buffer, "");
      return {
        object: gltf.scene,
        cleanupUrls: [],
        clips: gltf.animations,
        formatVersion: null,
      };
    }
    case "gltf": {
      const { GLTFLoader } =
        await import("three/examples/jsm/loaders/GLTFLoader.js");
      const materialized = await materializeGltf(file);
      const gltf = await new GLTFLoader().loadAsync(materialized.rootUrl);
      return {
        object: gltf.scene,
        cleanupUrls: materialized.cleanupUrls,
        clips: gltf.animations,
        formatVersion: materialized.formatVersion,
      };
    }
    case "fbx": {
      const { FBXLoader } =
        await import("three/examples/jsm/loaders/FBXLoader.js");
      const buffer = await readArrayBuffer(file.path);
      const object = new FBXLoader().parse(buffer, "");
      return {
        object,
        cleanupUrls: [],
        clips: object.animations,
        formatVersion: null,
      };
    }
    case "obj": {
      const { OBJLoader } =
        await import("three/examples/jsm/loaders/OBJLoader.js");
      const text = await readTextFile(file.path);
      const object = new OBJLoader().parse(text);
      const bundle = await buildObjTextureBundle(file);
      applyObjTextureBundle(object, bundle);
      return {
        object,
        cleanupUrls: bundle.cleanupUrls,
        clips: [],
        formatVersion: null,
      };
    }
    case "ply": {
      const { PLYLoader } =
        await import("three/examples/jsm/loaders/PLYLoader.js");
      const buffer = await readArrayBuffer(file.path);
      const geometry = new PLYLoader().parse(buffer);
      geometry.computeVertexNormals();
      return {
        object: new Mesh(
          geometry,
          new MeshStandardMaterial({
            color: "#c7d2e3",
            metalness: 0.08,
            roughness: 0.72,
          }),
        ),
        cleanupUrls: [],
        clips: [],
        formatVersion: null,
      };
    }
    case "stl": {
      const { STLLoader } =
        await import("three/examples/jsm/loaders/STLLoader.js");
      const buffer = await readArrayBuffer(file.path);
      const geometry = new STLLoader().parse(buffer);
      geometry.computeVertexNormals();
      return {
        object: new Mesh(
          geometry,
          new MeshStandardMaterial({
            color: "#d7dde8",
            metalness: 0.1,
            roughness: 0.68,
          }),
        ),
        cleanupUrls: [],
        clips: [],
        formatVersion: null,
      };
    }
    case "png":
    case "jpg":
    case "jpeg": {
      const objectUrl = await createBlobUrlFromPath(file.path, file.extension);
      const texture = await new TextureLoader().loadAsync(objectUrl);
      texture.colorSpace = SRGBColorSpace;
      texture.name = file.fileName;
      texture.userData.textureSourceKind = "standalone";
      return {
        object: createTexturePreview(texture),
        cleanupUrls: [objectUrl],
        clips: [],
        formatVersion: null,
      };
    }
    case "tga": {
      const { TGALoader } =
        await import("three/examples/jsm/loaders/TGALoader.js");
      const objectUrl = await createBlobUrlFromPath(file.path, file.extension);
      const texture = await new TGALoader().loadAsync(objectUrl);
      texture.colorSpace = SRGBColorSpace;
      texture.name = file.fileName;
      texture.userData.textureSourceKind = "standalone";
      return {
        object: createTexturePreview(texture),
        cleanupUrls: [objectUrl],
        clips: [],
        formatVersion: null,
      };
    }
    case "dds": {
      const { DDSLoader } =
        await import("three/examples/jsm/loaders/DDSLoader.js");
      const objectUrl = await createBlobUrlFromPath(file.path, file.extension);
      const texture = await new DDSLoader().loadAsync(objectUrl);
      texture.colorSpace = SRGBColorSpace;
      texture.name = file.fileName;
      texture.userData.textureSourceKind = "standalone";
      return {
        object: createTexturePreview(texture),
        cleanupUrls: [objectUrl],
        clips: [],
        formatVersion: null,
      };
    }
    case "hdr": {
      const { RGBELoader } =
        await import("three/examples/jsm/loaders/RGBELoader.js");
      const objectUrl = await createBlobUrlFromPath(file.path, file.extension);
      const texture = await new RGBELoader().loadAsync(objectUrl);
      texture.name = file.fileName;
      texture.userData.textureSourceKind = "standalone";
      return {
        object: createTexturePreview(texture),
        cleanupUrls: [objectUrl],
        clips: [],
        formatVersion: null,
      };
    }
    case "exr": {
      const { EXRLoader } =
        await import("three/examples/jsm/loaders/EXRLoader.js");
      const objectUrl = await createBlobUrlFromPath(file.path, file.extension);
      const texture = await new EXRLoader().loadAsync(objectUrl);
      texture.name = file.fileName;
      texture.userData.textureSourceKind = "standalone";
      return {
        object: createTexturePreview(texture),
        cleanupUrls: [objectUrl],
        clips: [],
        formatVersion: null,
      };
    }
    default:
      throw new Error(
        `Preview loader is not implemented for .${file.extension}`,
      );
  }
}

function getObjectKind(object: Object3D) {
  if (object instanceof Mesh) {
    return "mesh";
  }

  if (object instanceof Group) {
    return "group";
  }

  return object.type.toLowerCase();
}

function buildHierarchyNode(object: Object3D): HierarchyNode {
  return {
    name: object.name.trim() || "(unnamed)",
    kind: getObjectKind(object),
    children: object.children.map((child) => buildHierarchyNode(child)),
  };
}

function getTextureDimensions(texture: Texture) {
  const image = texture.image as { width?: number; height?: number } | undefined;

  if (
    image &&
    typeof image.width === "number" &&
    typeof image.height === "number"
  ) {
    return `${image.width}x${image.height}`;
  }

  return "unknown";
}

function inferTextureSourceKind(
  texture: Texture,
  currentFile: SelectedFile,
): AssetMetadata["textures"][number]["sourceKind"] {
  const fromUserData = texture.userData.textureSourceKind;
  if (
    fromUserData === "embedded" ||
    fromUserData === "external" ||
    fromUserData === "standalone"
  ) {
    return fromUserData;
  }

  if (currentFile.kind === "texture") {
    return "standalone";
  }

  if (currentFile.extension === "glb") {
    return "embedded";
  }

  if (currentFile.extension === "obj") {
    return "external";
  }

  return "unknown";
}

function collectAssetMetadata(
  object: Group | Mesh,
  currentFile: SelectedFile,
  clips: AnimationClip[],
  formatVersion: string | null,
): MetadataCollection {
  let nodeCount = 0;
  let meshCount = 0;
  const materials = new Set<Material>();
  const textures = new Map<string, AssetMetadata["textures"][number]>();
  const textureRegistry = new Map<string, Texture>();

  object.traverse((child: Object3D) => {
    nodeCount += 1;

    if (!(child instanceof Mesh)) {
      return;
    }

    meshCount += 1;

    for (const material of getMaterials(child.material)) {
      materials.add(material);

      const textureSlots = [
        ["Base Color", "map"],
        ["Normal", "normalMap"],
        ["Metalness", "metalnessMap"],
        ["Roughness", "roughnessMap"],
        ["Emissive", "emissiveMap"],
        ["Alpha", "alphaMap"],
      ] as const satisfies ReadonlyArray<readonly [string, TextureSlotKey]>;

      for (const [channel, key] of textureSlots) {
        const textureValue = (material as TexturedMaterial)[key];
        if (!(textureValue instanceof Texture)) {
          continue;
        }

        const textureId = String(textureValue.uuid);
        if (textures.has(textureId)) {
          continue;
        }

        textures.set(textureId, {
          id: textureId,
          label: textureValue.name.trim() || `${channel} Texture`,
          channel,
          dimensions: getTextureDimensions(textureValue),
          sourceKind: inferTextureSourceKind(textureValue, currentFile),
        });
        textureRegistry.set(textureId, textureValue);
      }
    }
  });

  return {
    metadata: {
      formatLabel: currentFile.extension.toUpperCase(),
      formatVersion,
      nodeCount,
      meshCount,
      materialCount: materials.size,
      textureCount: textures.size,
      hasAnimation: clips.length > 0,
      hierarchy: [buildHierarchyNode(object)],
      textures: [...textures.values()],
    },
    textureRegistry,
  };
}

function buildMissingReferenceMetadata(
  currentFile: SelectedFile,
  formatVersion: string | null,
  missingPaths: string[],
  unresolvedImages: string[],
): AssetMetadata {
  const textureEntries = unresolvedImages.map((path, index) => ({
    id: `unresolved:${path}:${index}`,
    label: path,
    channel: "Missing",
    dimensions: "unknown",
    sourceKind: "unresolved" as const,
  }));

  return {
    formatLabel: currentFile.extension.toUpperCase(),
    formatVersion,
    nodeCount: 0,
    meshCount: 0,
    materialCount: 0,
    textureCount: textureEntries.length,
    hasAnimation: false,
    hierarchy: [],
    textures:
      textureEntries.length > 0
        ? textureEntries
        : missingPaths.map((path, index) => ({
            id: `missing:${path}:${index}`,
            label: path,
            channel: "Missing Resource",
            dimensions: "unknown",
            sourceKind: "unresolved" as const,
          })),
  };
}

function getClipLabel(clip: AnimationClip, index: number) {
  const normalized = clip.name.trim();
  return normalized.length > 0 ? normalized : `Clip ${index + 1}`;
}

function activateClip(
  context: SceneContext,
  clipIndex: number,
  shouldPlay: boolean,
) {
  if (!context.mixer) {
    return null;
  }

  const clip = context.clips[clipIndex];
  if (!clip) {
    return null;
  }

  context.activeAction?.stop();
  const nextAction = context.mixer.clipAction(clip);
  nextAction.reset();
  nextAction.paused = !shouldPlay;
  nextAction.play();
  context.activeAction = nextAction;

  return {
    clipIndex,
    duration: clip.duration,
    currentTime: 0,
    isPlaying: shouldPlay,
  };
}

function setActionPlayback(action: AnimationAction, isPlaying: boolean) {
  action.paused = !isPlaying;
}

function seekAction(
  context: SceneContext,
  action: AnimationAction,
  time: number,
  duration: number,
) {
  const nextTime = Math.min(Math.max(time, 0), duration);
  action.time = nextTime;
  context.mixer?.update(0);
  return nextTime;
}

function stepAction(
  context: SceneContext,
  action: AnimationAction,
  direction: -1 | 1,
  duration: number,
) {
  action.paused = true;
  const frameDuration = 1 / 30;
  const nextTime = Math.min(
    Math.max(action.time + frameDuration * direction, 0),
    duration,
  );
  action.time = nextTime;
  context.mixer?.update(0);
  return nextTime;
}

function applyInitialView(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  object: Group | Mesh,
) {
  const bounds = new Box3().setFromObject(object);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.001);
  const fitHeightDistance =
    maxDimension / (2 * Math.tan(MathUtils.degToRad(camera.fov * 0.5)));
  const fitDistance = fitHeightDistance * 1.5;
  const offset = new Vector3(1.15, 0.8, 1.15)
    .normalize()
    .multiplyScalar(fitDistance);

  camera.position.copy(center.clone().add(offset));
  camera.near = Math.max(maxDimension / 500, 0.01);
  camera.far = Math.max(maxDimension * 20, 200);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.minDistance = Math.max(maxDimension / 50, 0.05);
  controls.maxDistance = Math.max(maxDimension * 40, 50);
  controls.update();
}

function getScaleWarning(object: Group | Mesh) {
  const bounds = new Box3().setFromObject(object);
  const size = bounds.getSize(new Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z);

  if (maxDimension <= 0.001) {
    return "Scale warning: the loaded content is extremely small.";
  }

  if (maxDimension >= 10000) {
    return "Scale warning: the loaded content is extremely large.";
  }

  return null;
}

function applyDisplayMode(object: Group | Mesh, displayMode: DisplayMode) {
  object.traverse((child: Object3D) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    for (const material of getMaterials(child.material)) {
      if (!("wireframe" in material)) {
        continue;
      }

      material.wireframe =
        displayMode === "wireframe" || displayMode === "texturedWireframe";

      if ("map" in material) {
        const originalMap =
          material.userData.originalMap ?? material.map ?? null;
        material.userData.originalMap = originalMap;
        material.map =
          displayMode === "untextured" || displayMode === "wireframe"
            ? null
            : originalMap;
      }

      material.needsUpdate = true;
    }
  });
}

export function AssetViewport({
  currentFile,
  displayMode,
  onFeedbackChange,
  onMetadataChange,
  selectedTextureId,
  textureViewMode,
  viewerSurfaceMode,
  textureExposure,
  textureBlackPoint,
  textureWhitePoint,
  resetVersion,
}: AssetViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneContextRef = useRef<SceneContext | null>(null);
  const resetCameraRef = useRef<(() => void) | null>(null);
  const displayModeRef = useRef(displayMode);
  const [activePreviewPath, setActivePreviewPath] = useState<string | null>(
    null,
  );
  const [overlayMode, setOverlayMode] = useState<ViewerMode>("empty");
  const [animationState, setAnimationState] =
    useState<AnimationState>(emptyAnimationState);
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
    const host = hostRef.current;

    if (!host) {
      return;
    }

    const renderer = new WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.setClearColor("#717781");
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    const scene = new Scene();
    scene.background = new Color("#717781");

    const camera = new PerspectiveCamera(
      45,
      host.clientWidth / host.clientHeight,
      0.01,
      2000,
    );
    camera.up.set(0, 1, 0);

    const pmremGenerator = new PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;

    const ambient = new AmbientLight("#ffffff", 1.8);
    const key = new DirectionalLight("#ffffff", 2.4);
    key.position.set(6, 8, 5);
    const fill = new DirectionalLight("#cfd9ea", 1.2);
    fill.position.set(-5, 3, -4);
    scene.add(ambient, key, fill);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.mouseButtons.LEFT = MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = MOUSE.PAN;
    controls.mouseButtons.RIGHT = MOUSE.DOLLY;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enabled = false;

    const pointerDownHandler = (event: PointerEvent) => {
      if (!sceneContextRef.current?.mountedObject) {
        controls.enabled = false;
        return;
      }

      controls.enabled = event.altKey;
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
    });

    resizeObserver.observe(host);

    let animationFrame = 0;
    const renderLoop = () => {
      animationFrame = window.requestAnimationFrame(renderLoop);
      controls.update();
      renderer.render(scene, camera);
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
      pmremGenerator.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      sceneContextRef.current = null;
      resetCameraRef.current = null;
    };
  }, [onFeedbackChange, onMetadataChange]);

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

    if (!currentFile) {
      onFeedbackChange(neutralFeedback);
      onMetadataChange(emptyAssetMetadata);
      return;
    }

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

    loadPreviewObject(currentFile)
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
        applyDisplayMode(object, displayModeRef.current);
        applyInitialView(context.camera, context.controls, object);
        context.controls.enabled = true;
        setActivePreviewPath(currentFile.path);
        setOverlayMode("ready");
        const metadataCollection = collectAssetMetadata(
          object,
          currentFile,
          clips,
          formatVersion,
        );
        context.textureRegistry = metadataCollection.textureRegistry;
        onMetadataChange(metadataCollection.metadata);

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
          const targetObject = context.mountedObject;

          if (!targetObject) {
            return;
          }

          applyInitialView(context.camera, context.controls, targetObject);
        };

        onFeedbackChange({
          mode: "ready",
          message: `Preview ready: ${currentFile.fileName}`,
          warning: getScaleWarning(object),
          canResetCamera: true,
        });
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Failed to load preview.";
        const missingReferenceError = error as Partial<MissingReferenceError>;
        const mode = message.includes("404")
          || missingReferenceError.missingPaths?.length
          ? "missingReference"
          : "loadFailed";
        setActivePreviewPath(null);
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
    onMetadataChange,
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
      applyInitialView(context.camera, context.controls, context.sourceObject);
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
    );
    context.sourceObject.visible = false;
    context.previewObject = previewObject;
    context.mountedObject = previewObject;
    context.scene.add(previewObject);
    applyInitialView(context.camera, context.controls, previewObject);
  }, [
    selectedTextureId,
    textureBlackPoint,
    textureExposure,
    textureViewMode,
    textureWhitePoint,
    viewerSurfaceMode,
  ]);

  useEffect(() => {
    resetCameraRef.current?.();
  }, [resetVersion]);

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
      {effectiveOverlayMode !== "ready" ? (
        <div className="viewport-overlay">
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
