import { Group, LoadingManager } from "three";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { readBinaryFile, type SelectedFile } from "../../lib/files";
import type { LoaderContext } from "../loaderRegistry";
import { isAbortOrTimeoutError, parseModelInWorker } from "../modelParseWorker";
import { formatMissingTextureWarnings } from "../textureWarnings";
import type { LoadedPreview } from "../types";

const FALLBACK_TEXTURE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lZ8hdwAAAABJRU5ErkJggg==";

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
    case "tga":
      return "image/x-tga";
    case "dds":
      return "image/vnd-ms.dds";
    case "hdr":
      return "image/vnd.radiance";
    case "exr":
      return "image/x-exr";
    case "ktx2":
      return "image/ktx2";
    case "bmp":
      return "image/bmp";
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

function warnTextureFallback(
  message: string,
  details: Record<string, unknown>,
) {
  if (import.meta.env.DEV) {
    console.warn(message, details);
  }
}

function isRemoteOrInlineUrl(value: string) {
  return /^(data:|blob:|https?:|asset:)/i.test(value);
}

export function collectColladaImageReferences(text: string) {
  const imagePaths = new Set<string>();
  for (const match of text.matchAll(/<init_from>([^<]+)<\/init_from>/g)) {
    imagePaths.add(match[1].trim());
  }
  for (const match of text.matchAll(
    /<image[^>]*>\s*<source>([^<]+)<\/source>/g,
  )) {
    imagePaths.add(match[1].trim());
  }
  return imagePaths;
}

export function resolveColladaTextureUrl(
  url: string,
  blobCache: ReadonlyMap<string, string>,
  missingPaths: ReadonlySet<string>,
) {
  if (isRemoteOrInlineUrl(url)) return url;
  return (
    blobCache.get(url) ??
    (missingPaths.has(url) ? FALLBACK_TEXTURE_DATA_URL : url)
  );
}

export function buildColladaWorkerTexturePayload(
  blobCache: ReadonlyMap<string, string>,
  missingPaths: readonly string[],
) {
  return {
    textureUrls: Object.fromEntries(blobCache),
    missingTextureUrls: [...missingPaths],
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("Model load was canceled.");
    error.name = "AbortError";
    throw error;
  }
}

export async function loadDaePreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  reportStage("decode");
  const text = await readTextFile(file.path);
  throwIfAborted(context.signal);
  const cleanupUrls: string[] = [];
  const imagePaths = collectColladaImageReferences(text);
  const blobCache = new Map<string, string>();
  const missingPaths: string[] = [];

  for (const imagePath of imagePaths) {
    if (/^(data:|blob:|https?:)/i.test(imagePath)) continue;
    const resolvedPath = resolveSiblingPath(file.parentDirectory, imagePath);
    const extension = imagePath.includes(".")
      ? (imagePath.split(".").pop() ?? "bin").toLowerCase()
      : "bin";
    try {
      const blobUrl = await createBlobUrlFromPath(resolvedPath, extension);
      blobCache.set(imagePath, blobUrl);
      cleanupUrls.push(blobUrl);
    } catch {
      missingPaths.push(imagePath);
    }
  }

  try {
    if (missingPaths.length > 0) {
      warnTextureFallback("[dae] missing texture references; continuing:", {
        file: file.fileName,
        missingTextures: missingPaths,
      });
    }
    reportStage("resolve");
    const manager = new LoadingManager();
    const missingPathSet = new Set(missingPaths);
    manager.setURLModifier((url) => {
      return resolveColladaTextureUrl(url, blobCache, missingPathSet);
    });
    const loader = new ColladaLoader(manager);
    const workerTexturePayload = buildColladaWorkerTexturePayload(
      blobCache,
      missingPaths,
    );
    reportStage("scene");
    let wrapped: Group;
    try {
      wrapped = (await parseModelInWorker(
        file.path,
        {
          kind: "dae",
          text,
          basePath: file.parentDirectory,
          ...workerTexturePayload,
        },
        { signal: context.signal, timeoutMs: context.parseTimeoutMs },
      )) as Group;
    } catch (error) {
      if (isAbortOrTimeoutError(error)) {
        throw error;
      }
      console.warn(
        "[dae] worker parse failed, falling back to main thread:",
        error,
      );
      throwIfAborted(context.signal);
      const collada = loader.parse(text, file.parentDirectory);
      if (!collada) {
        throw new Error(
          "Collada parse returned no result; the document may be malformed.",
          { cause: error },
        );
      }
      wrapped = new Group();
      wrapped.add(collada.scene);
    }
    return {
      object: wrapped,
      cleanupUrls,
      clips: [],
      formatVersion: null,
      warnings: formatMissingTextureWarnings(missingPaths),
    };
  } catch (error) {
    for (const url of cleanupUrls) {
      URL.revokeObjectURL(url);
    }
    throw error;
  }
}
