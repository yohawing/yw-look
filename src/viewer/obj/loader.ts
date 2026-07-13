import {
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  TextureLoader,
} from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import {
  readBinaryFile,
  readBinaryFilePrefix,
  type SelectedFile,
} from "../../lib/files";
import type { LoaderContext } from "../loaderRegistry";
import { isAbortOrTimeoutError, parseModelInWorker } from "../modelParseWorker";
import { formatMissingTextureWarnings } from "../textureWarnings";
import type { LoadedPreview, TextureBundle } from "../types";

async function readTextFile(path: string) {
  const buffer = await readBinaryFile(path);
  return new TextDecoder().decode(buffer);
}

function getMimeType(extension: string) {
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "bmp":
      return "image/bmp";
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
      if (segments.length === 0) {
        throw new Error(
          `Path traversal beyond filesystem root: ${relativePath}`,
        );
      }
      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return `${prefix}${segments.join(separator)}`;
}

async function createBlobUrlFromPath(path: string, extension: string) {
  const buffer = await readBinaryFile(path);
  const blob = new Blob([buffer], { type: getMimeType(extension) });
  return URL.createObjectURL(blob);
}

async function tryLoadTextureFromPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "bin";
  let objectUrl: string | null = null;
  try {
    objectUrl = await createBlobUrlFromPath(path, extension);
    const texture = await new TextureLoader().loadAsync(objectUrl);
    texture.colorSpace = SRGBColorSpace;
    texture.userData.textureSourceKind = "external";
    return { texture, objectUrl };
  } catch {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    return null;
  }
}

async function pathExists(path: string) {
  try {
    await readBinaryFilePrefix(path, 1);
    return true;
  } catch {
    return false;
  }
}

function extractMtlLibraries(objText: string) {
  return objText
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .map((line) => line.match(/^mtllib\s+(.+)$/i)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));
}

function extractTextureReference(line: string) {
  const match = line
    .replace(/#.*/, "")
    .trim()
    .match(/^(?:map_[a-z0-9_]+|bump|norm)\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const tokens = match[1].match(/"[^"]+"|'[^']+'|\S+/g) ?? [];
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index].replace(/^["']|["']$/g, "");
    if (token && !token.startsWith("-")) {
      return token;
    }
  }
  return null;
}

async function collectMissingMtlTextureReferences(
  file: SelectedFile,
  objText: string,
) {
  const missingPaths: string[] = [];

  for (const mtlLibrary of extractMtlLibraries(objText)) {
    const mtlPath = resolveSiblingPath(file.parentDirectory, mtlLibrary);
    let mtlText: string;
    try {
      mtlText = await readTextFile(mtlPath);
    } catch {
      missingPaths.push(mtlLibrary);
      continue;
    }

    for (const line of mtlText.split(/\r?\n/)) {
      const texturePath = extractTextureReference(line);
      if (!texturePath) {
        continue;
      }
      const resolvedTexturePath = resolveSiblingPath(
        file.parentDirectory,
        texturePath,
      );
      if (!(await pathExists(resolvedTexturePath))) {
        missingPaths.push(texturePath);
      }
    }
  }

  return formatMissingTextureWarnings(missingPaths);
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("Model load was canceled.");
    error.name = "AbortError";
    throw error;
  }
}

export async function loadObjPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  reportStage("decode");
  const text = await readTextFile(file.path);
  const warnings = await collectMissingMtlTextureReferences(file, text);
  throwIfAborted(context.signal);
  reportStage("resolve");
  let object: Group;
  try {
    object = (await parseModelInWorker(
      file.path,
      { kind: "obj", text },
      { signal: context.signal, timeoutMs: context.parseTimeoutMs },
    )) as Group;
  } catch (error) {
    if (isAbortOrTimeoutError(error)) {
      throw error;
    }
    console.warn(
      "[obj] worker parse failed, falling back to main thread:",
      error,
    );
    throwIfAborted(context.signal);
    object = new OBJLoader().parse(text);
  }
  const bundle = await buildObjTextureBundle(file);
  throwIfAborted(context.signal);
  reportStage("scene");
  applyObjTextureBundle(object, bundle);
  return {
    object,
    cleanupUrls: bundle.cleanupUrls,
    clips: [],
    formatVersion: null,
    warnings,
  };
}
