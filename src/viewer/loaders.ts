import {
  CompressedTexture,
  DataTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
} from "three";
import { type SelectedFile, readBinaryFile } from "../lib/files";
import { inspectStage } from "../lib/usd";
import { isUsdWorkerEnabled, parseUsdInWorker } from "./usdWorkerLoader";
import type {
  LoadedPreview,
  MissingReferenceError,
  TextureBundle,
} from "./types";

async function readArrayBuffer(path: string) {
  const bytes = await readBinaryFile(path);
  return Uint8Array.from(bytes).buffer;
}

/**
 * Yields control to the browser for one paint frame. Used before heavy
 * synchronous work (e.g. Three.js USDLoader.parse) so that React commits
 * staged earlier in the same tick get a chance to paint first.
 *
 * Falls back to a microtask/macrotask chain when running outside a DOM
 * context (tests, SSR) where `requestAnimationFrame` is unavailable.
 */
async function yieldToPaint(): Promise<void> {
  if (typeof requestAnimationFrame === "function") {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        // A second macrotask tick ensures the paint after RAF has landed
        // before we start burning the main thread again.
        setTimeout(() => resolve(), 0);
      }),
    );
    return;
  }
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
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

type UsdRuntimeHints = {
  metersPerUnit: number | null;
};

function applyUsdRuntimeHints(object: Object3D, hints: UsdRuntimeHints) {
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

async function parseUsdRuntimeHints(path: string): Promise<UsdRuntimeHints> {
  // Delegated to the Rust `OpenusdBackend` via the Tauri command surface,
  // so this works for USDA, USDC, and USDZ uniformly. Returns just the
  // pieces the Three.js viewer cannot recover by itself — currently only
  // `metersPerUnit` (USDLoader handles the xform graph natively).
  //
  // Wrapped in a hard timeout so a hung / slow backend call can never
  // stall the preview pipeline — we fall back to "no hint" and the
  // viewer still renders with USDLoader's own scene.
  const started = performance.now();
  const TIMEOUT_MS = 10_000;
  const inspection = await Promise.race([
    inspectStage(path),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`inspectStage timeout after ${TIMEOUT_MS}ms for ${path}`),
          ),
        TIMEOUT_MS,
      ),
    ),
  ]);
  const elapsed = Math.round(performance.now() - started);
  console.info(
    `[usd] inspectStage OK in ${elapsed}ms: metersPerUnit=${inspection.metersPerUnit}`,
  );
  return {
    metersPerUnit: inspection.metersPerUnit,
  };
}

/**
 * @internal Exported for unit-testing only. Not part of the public API.
 */
export {
  getMimeType,
  resolveSiblingPath,
  isUsdcCrateBuffer,
  readUsdzFirstFileName,
};

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
      // Phase 2: yield one frame so the USD inspector sidebar (which is
      // populated in parallel by App.tsx via the Rust backend) has a chance
      // to paint before we block the main thread on the synchronous
      // Three.js parse. See docs/usd-phase2.md for the 2-stage load design.
      await yieldToPaint();

      // Phase 2: optionally route the parse to a Web Worker. Default OFF.
      // On any worker failure we silently fall back to the synchronous
      // main-thread parse so the feature flag can never regress.
      let workerObject: Object3D | null = null;
      if (isUsdWorkerEnabled()) {
        try {
          workerObject = await parseUsdInWorker(
            file.path,
            usdaText
              ? { kind: "text", text: usdaText }
              : { kind: "binary", buffer },
          );
        } catch (error) {
          console.warn(
            "[usd] worker parse failed, falling back to main thread:",
            error,
          );
          workerObject = null;
        }
      }
      // `USDLoader.parse` returns a `Group`; the worker path reconstructs
      // via `ObjectLoader.parse`, which is typed as `Object3D`. We cast
      // the worker output to `Group` to match `LoadedPreview.object` —
      // the scene graph shape is compatible even if the runtime class
      // nominal identity differs.
      const object: Group =
        (workerObject as Group | null) ??
        (usdaText ? loader.parse(usdaText) : loader.parse(buffer));

      try {
        const runtimeHints = await parseUsdRuntimeHints(file.path);
        applyUsdRuntimeHints(object, runtimeHints);
      } catch (error) {
        console.warn("USD hint parsing failed:", error);
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
