import {
  CompressedTexture,
  DataTexture,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
} from "three";
import { type SelectedFile, readBinaryFile } from "../lib/files";
import type {
  LoadedPreview,
  MissingReferenceError,
  TextureBundle,
} from "./types";

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
      objectUrl = await createBlobUrlFromPath(
        resourcePath,
        extension.toLowerCase(),
      );
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
    for (const url of cleanupUrls) {
      URL.revokeObjectURL(url);
    }
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

async function buildObjTextureBundle(
  file: SelectedFile,
): Promise<TextureBundle> {
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
  if (
    !bundle.albedo &&
    !bundle.normal &&
    !bundle.metalness &&
    !bundle.roughness
  ) {
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

type UsdXformHints = {
  path: string;
  hasMatrixTransform: boolean;
  order: string[];
  scale: [number, number, number] | null;
  translate: [number, number, number] | null;
  rotateXYZ: [number, number, number] | null;
};

type UsdRuntimeHints = {
  metersPerUnit: number | null;
  xforms: UsdXformHints[];
};

const usdXformKeyPatterns = {
  transform: /\bxformOp:transform(?!:)/,
  scale: /\bxformOp:scale(?!:)/,
  translate: /\bxformOp:translate(?!:)/,
  rotateXYZ: /\bxformOp:rotateXYZ(?!:)/,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseUsdFloatTuple(value: string): [number, number, number] | null {
  const matches = value.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!matches) {
    return null;
  }

  const numbers = matches
    .map((entry) => Number.parseFloat(entry))
    .filter((num) => Number.isFinite(num));

  if (numbers.length !== 3) {
    return null;
  }

  return [numbers[0], numbers[1], numbers[2]];
}

function parseUsdOpOrder(value: string) {
  const matches = value.match(/"([^"]+)"/g);
  if (!matches) {
    return [];
  }

  return matches.map((token) => token.replace(/^"|"$/g, ""));
}

function parseUsdNumericValue(value: string) {
  const match = value.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
  if (!match) {
    return null;
  }

  const numeric = Number.parseFloat(match[0]);
  return Number.isFinite(numeric) ? numeric : null;
}

function findUsdMetersPerUnit(data: Record<string, unknown>): number | null {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && key.includes("metersPerUnit")) {
      const parsed = parseUsdNumericValue(value);
      if (parsed && parsed > 0) {
        return parsed;
      }
    }

    if (isRecord(value)) {
      const nested = findUsdMetersPerUnit(value);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function extractUsdPrimName(key: string) {
  const match = key.match(/^def Xform "([^"]+)"$/);
  return match?.[1].trim() || null;
}

function buildUsdXformPath(parentSegments: string[], segment: string) {
  return [...parentSegments, segment].join("/");
}

function isExactUsdXformKey(entryKey: string, op: string) {
  const pattern = usdXformKeyPatterns[op as keyof typeof usdXformKeyPatterns];
  return pattern ? pattern.test(entryKey) : false;
}

function collectUsdXformHints(
  data: Record<string, unknown>,
  parentSegments: string[],
  result: UsdXformHints[],
  siblingIndex = 0,
): number {
  let currentSiblingIndex = siblingIndex;

  for (const [key, value] of Object.entries(data)) {
    if (!isRecord(value)) {
      continue;
    }

    if (key.startsWith("def Scope")) {
      currentSiblingIndex = collectUsdXformHints(
        value,
        parentSegments,
        result,
        currentSiblingIndex,
      );
      continue;
    }

    if (key.startsWith("def Xform")) {
      const segment = extractUsdPrimName(key) ?? `#${currentSiblingIndex}`;
      const path = buildUsdXformPath(parentSegments, segment);
      const hints: UsdXformHints = {
        path,
        hasMatrixTransform: false,
        order: [],
        scale: null,
        translate: null,
        rotateXYZ: null,
      };

      for (const [entryKey, entryValue] of Object.entries(value)) {
        if (typeof entryValue !== "string") {
          continue;
        }

        if (isExactUsdXformKey(entryKey, "transform")) {
          hints.hasMatrixTransform = true;
        } else if (isExactUsdXformKey(entryKey, "scale")) {
          hints.scale = parseUsdFloatTuple(entryValue);
        } else if (isExactUsdXformKey(entryKey, "translate")) {
          hints.translate = parseUsdFloatTuple(entryValue);
        } else if (isExactUsdXformKey(entryKey, "rotateXYZ")) {
          hints.rotateXYZ = parseUsdFloatTuple(entryValue);
        } else if (/\bxformOpOrder\b/.test(entryKey)) {
          hints.order = parseUsdOpOrder(entryValue);
        }
      }

      result.push(hints);
      currentSiblingIndex += 1;
      collectUsdXformHints(value, [...parentSegments, segment], result);
    }
  }

  return currentSiblingIndex;
}

function collectUsdXformNodeMap(root: Object3D) {
  const nodes = new Map<string, Object3D>();

  const walk = (current: Object3D, parentSegments: string[]) => {
    current.children.forEach((child, index) => {
      const segment = child.name.trim() || `#${index}`;
      const path = buildUsdXformPath(parentSegments, segment);
      nodes.set(path, child);
      walk(child, [...parentSegments, segment]);
    });
  };

  walk(root, []);
  return nodes;
}

function applyUsdXformHint(target: Object3D, hint: UsdXformHints) {
  if (hint.hasMatrixTransform) {
    return;
  }

  const order =
    hint.order.length > 0
      ? hint.order
      : ["xformOp:translate", "xformOp:rotateXYZ", "xformOp:scale"];

  const composed = new Matrix4().identity();
  let transformed = false;

  for (const rawToken of order) {
    const invert = rawToken.startsWith("!invert!");
    const token = rawToken.replace(/^!invert!/, "");
    let step: Matrix4 | null = null;

    if (token === "xformOp:translate" && hint.translate) {
      step = new Matrix4().makeTranslation(
        hint.translate[0],
        hint.translate[1],
        hint.translate[2],
      );
    } else if (token === "xformOp:rotateXYZ" && hint.rotateXYZ) {
      step = new Matrix4().makeRotationFromEuler(
        new Euler(
          (hint.rotateXYZ[0] * Math.PI) / 180,
          (hint.rotateXYZ[1] * Math.PI) / 180,
          (hint.rotateXYZ[2] * Math.PI) / 180,
          "XYZ",
        ),
      );
    } else if (token === "xformOp:scale" && hint.scale) {
      step = new Matrix4().makeScale(
        hint.scale[0],
        hint.scale[1],
        hint.scale[2],
      );
    }

    if (!step) {
      continue;
    }

    if (invert) {
      step.invert();
    }

    composed.multiply(step);
    transformed = true;
  }

  if (!transformed) {
    return;
  }

  composed.decompose(target.position, target.quaternion, target.scale);
}

function applyUsdRuntimeHints(object: Object3D, hints: UsdRuntimeHints) {
  const nodeMap = collectUsdXformNodeMap(object);

  for (const hint of hints.xforms) {
    const target = nodeMap.get(hint.path);
    if (!target) {
      continue;
    }
    applyUsdXformHint(target, hint);
  }

  if (!hints.metersPerUnit || Math.abs(hints.metersPerUnit - 1) < 1e-6) {
    return;
  }

  const correctionScale = 1 / hints.metersPerUnit;
  object.scale.multiplyScalar(correctionScale);
}

function toArrayBuffer(data: Uint8Array) {
  return data.slice().buffer;
}

function isUsdcCrateBuffer(buffer: ArrayBuffer) {
  const crateHeader = [0x50, 0x58, 0x52, 0x2d, 0x55, 0x53, 0x44, 0x43];
  const view = new Uint8Array(buffer);

  if (view.byteLength < crateHeader.length) {
    return false;
  }

  return crateHeader.every((value, index) => view[index] === value);
}

async function tryExtractUsdaText(
  extension: string,
  buffer: ArrayBuffer,
): Promise<string | null> {
  if (extension === "usda") {
    return new TextDecoder().decode(buffer);
  }

  if (extension === "usd") {
    if (isUsdcCrateBuffer(buffer)) {
      return null;
    }
    return new TextDecoder().decode(buffer);
  }

  if (extension !== "usdz") {
    return null;
  }

  const firstFileName = readUsdzFirstFileName(buffer);
  if (!firstFileName) {
    return null;
  }

  const { unzip, strFromU8 } =
    await import("three/examples/jsm/libs/fflate.module.js");
  const zip = (await new Promise<Record<string, Uint8Array>>(
    (resolve, reject) => {
      unzip(new Uint8Array(buffer), (error, files) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(files as Record<string, Uint8Array>);
      });
    },
  )) as Record<string, Uint8Array>;

  const firstFile = zip[firstFileName];
  if (!firstFile) {
    return null;
  }

  if (firstFileName.endsWith("usda")) {
    return strFromU8(firstFile);
  }

  if (firstFileName.endsWith("usdc")) {
    return null;
  }

  if (firstFileName.endsWith("usd")) {
    const firstBuffer = toArrayBuffer(firstFile);
    if (isUsdcCrateBuffer(firstBuffer)) {
      return null;
    }
    return strFromU8(firstFile);
  }

  return null;
}

function readUsdzFirstFileName(buffer: ArrayBuffer) {
  const header = new DataView(buffer);
  // ZIP local file header signature ("PK\x03\x04"), used by USDZ archives.
  const localFileHeaderSignature = 0x04034b50;

  if (
    header.byteLength < 30 ||
    header.getUint32(0, true) !== localFileHeaderSignature
  ) {
    return null;
  }

  const fileNameLength = header.getUint16(26, true);
  const extraFieldLength = header.getUint16(28, true);
  const fileNameStart = 30;
  const fileNameEnd = fileNameStart + fileNameLength;

  if (
    fileNameLength === 0 ||
    fileNameEnd + extraFieldLength > header.byteLength
  ) {
    return null;
  }

  const bytes = new Uint8Array(buffer, fileNameStart, fileNameLength);
  return new TextDecoder().decode(bytes);
}

async function parseUsdRuntimeHints(
  usdaText: string,
): Promise<UsdRuntimeHints> {
  const parserModulePath = "three/examples/jsm/loaders/usd/USDAParser.js";
  const parserModule = (await import(parserModulePath)) as {
    USDAParser: new () => {
      parseText: (text: string) => Record<string, unknown>;
    };
  };
  const { USDAParser } = parserModule;
  const parser = new USDAParser();
  const root = parser.parseText(usdaText) as Record<string, unknown>;
  const xforms: UsdXformHints[] = [];
  collectUsdXformHints(root, [], xforms);

  return {
    metersPerUnit: findUsdMetersPerUnit(root),
    xforms,
  };
}

export async function loadPreviewObject(
  file: SelectedFile,
): Promise<LoadedPreview> {
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
    case "usd":
    case "usda":
    case "usdc":
    case "usdz": {
      const { USDLoader } =
        await import("three/examples/jsm/loaders/USDLoader.js");
      const buffer = await readArrayBuffer(file.path);
      const loader = new USDLoader();
      const usdaText = await tryExtractUsdaText(file.extension, buffer);
      const object = usdaText ? loader.parse(usdaText) : loader.parse(buffer);

      if (usdaText) {
        try {
          const runtimeHints = await parseUsdRuntimeHints(usdaText);
          applyUsdRuntimeHints(object, runtimeHints);
        } catch (error) {
          console.warn("USD hint parsing failed:", error);
        }
      }

      return {
        object,
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
