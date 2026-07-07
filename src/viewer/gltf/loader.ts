import { LoadingManager } from "three";
import { readBinaryFile, type SelectedFile } from "../../lib/files";
import type { LoaderContext } from "../loaderRegistry";
import { isAbortOrTimeoutError, parseModelInWorker } from "../modelParseWorker";
import { formatMissingTextureWarnings } from "../textureWarnings";
import type { LoadedPreview, MissingReferenceError } from "../types";

const WORKER_FALLBACK_SIZE_LIMIT = 50 * 1024 * 1024;

async function readArrayBuffer(path: string) {
  return readBinaryFile(path);
}

function warnTextureFallback(
  message: string,
  details: Record<string, unknown>,
) {
  if (import.meta.env.DEV) {
    console.warn(message, details);
  }
}

async function yieldToPaint(): Promise<void> {
  if (typeof requestAnimationFrame === "function") {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        setTimeout(() => resolve(), 0);
      }),
    );
    return;
  }
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
}

function createAbortError(message = "Model load was canceled."): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}
async function readTextFile(path: string) {
  const buffer = await readArrayBuffer(path);
  return new TextDecoder().decode(buffer);
}

export function getMimeType(extension: string) {
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

export function resolveSiblingPath(
  baseDirectory: string,
  relativePath: string,
) {
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
  const buffer = await readArrayBuffer(path);
  const blob = new Blob([buffer], { type: getMimeType(extension) });
  return URL.createObjectURL(blob);
}

const FALLBACK_TEXTURE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lZ8hdwAAAABJRU5ErkJggg==";

const GLTF_RESOURCE_PREFETCH_CONCURRENCY = 4;

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await mapper(items[index], index);
    }
  };

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function materializeGltf(file: SelectedFile) {
  const rawText = await readTextFile(file.path);
  let json: GltfDocument | null = null;
  try {
    json = JSON.parse(rawText) as GltfDocument;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse glTF document: ${message}`, {
      cause: error,
    });
  }
  const formatVersion = json.asset?.version ?? null;
  const bufferUris = [
    ...new Set(
      (json.buffers ?? [])
        .map((buffer) => buffer.uri)
        .filter(
          (uri): uri is string =>
            typeof uri === "string" &&
            uri.length > 0 &&
            !/^(data:|blob:|https?:)/i.test(uri),
        ),
    ),
  ];
  const imageUris = [
    ...new Set(
      (json.images ?? [])
        .map((image) => image.uri)
        .filter(
          (uri): uri is string =>
            typeof uri === "string" &&
            uri.length > 0 &&
            !/^(data:|blob:|https?:)/i.test(uri),
        ),
    ),
  ];
  json = null;

  const cleanupUrls: string[] = [];
  const missingPaths: string[] = [];
  const unresolvedImages: string[] = [];
  const urlMap = new Map<string, string>();

  const createMappedBlobUrl = async (uri: string) => {
    const resourcePath = resolveSiblingPath(file.parentDirectory, uri);
    const extension = uri.includes(".")
      ? (uri.split(".").pop() ?? "bin")
      : "bin";
    const objectUrl = await createBlobUrlFromPath(
      resourcePath,
      extension.toLowerCase(),
    );
    return objectUrl;
  };

  const bufferResults = await mapWithConcurrency(
    bufferUris,
    GLTF_RESOURCE_PREFETCH_CONCURRENCY,
    async (uri) => {
      try {
        return { uri, objectUrl: await createMappedBlobUrl(uri) };
      } catch {
        return { uri, objectUrl: null };
      }
    },
  );
  for (const { uri, objectUrl } of bufferResults) {
    if (objectUrl === null) {
      missingPaths.push(uri);
      continue;
    }
    cleanupUrls.push(objectUrl);
    urlMap.set(uri, objectUrl);
  }

  const pendingImageUris = imageUris.filter((uri) => !urlMap.has(uri));
  const imageResults = await mapWithConcurrency(
    pendingImageUris,
    GLTF_RESOURCE_PREFETCH_CONCURRENCY,
    async (uri) => {
      try {
        return { uri, objectUrl: await createMappedBlobUrl(uri) };
      } catch {
        return { uri, objectUrl: null };
      }
    },
  );
  for (const { uri, objectUrl } of imageResults) {
    if (objectUrl === null) {
      unresolvedImages.push(uri);
      urlMap.set(uri, FALLBACK_TEXTURE_DATA_URL);
      continue;
    }
    cleanupUrls.push(objectUrl);
    urlMap.set(uri, objectUrl);
  }

  if (unresolvedImages.length > 0) {
    warnTextureFallback(
      "[gltf] missing texture references; using fallback material:",
      {
        file: file.fileName,
        missingTextures: unresolvedImages,
      },
    );
  }

  if (missingPaths.length > 0) {
    for (const url of cleanupUrls) {
      URL.revokeObjectURL(url);
    }
    const error = new Error(
      `Missing reference: ${missingPaths.join(", ")}`,
    ) as MissingReferenceError;
    error.formatVersion = formatVersion;
    error.missingPaths = missingPaths;
    error.unresolvedImages = unresolvedImages;
    throw error;
  }

  const manager = new LoadingManager();
  manager.setURLModifier((url) => urlMap.get(url) ?? url);

  return {
    rawText,
    manager,
    cleanupUrls,
    resourceUrls: Object.fromEntries(urlMap),
    formatVersion,
    warnings: formatMissingTextureWarnings(unresolvedImages),
  };
}

type GltfTextureInfo = {
  index?: number;
};

type GltfMaterial = {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorTexture?: GltfTextureInfo;
    metallicRoughnessTexture?: GltfTextureInfo;
    baseColorFactor?: [number, number, number, number];
    metallicFactor?: number;
    roughnessFactor?: number;
  };
  normalTexture?: GltfTextureInfo;
  occlusionTexture?: GltfTextureInfo;
  emissiveTexture?: GltfTextureInfo;
  extensions?: Record<string, unknown>;
  doubleSided?: boolean;
};

export type GltfDocument = {
  asset?: { version?: string };
  buffers?: Array<{ uri?: string }>;
  images?: Array<{ uri?: string }>;
  textures?: Array<{ source?: number }>;
  materials?: GltfMaterial[];
};

const GLTF_MISSING_TEXTURE_FALLBACK = {
  pbrMetallicRoughness: {
    baseColorFactor: [0.78, 0.82, 0.9, 1] as [number, number, number, number],
    metallicFactor: 0,
    roughnessFactor: 0.72,
  },
};

function textureInfoUsesMissingImage(
  textureInfo: GltfTextureInfo | undefined,
  textures: GltfDocument["textures"],
  missingImageIndices: ReadonlySet<number>,
) {
  if (
    !textureInfo ||
    typeof textureInfo.index !== "number" ||
    !textures?.[textureInfo.index]
  ) {
    return false;
  }

  const source = textures[textureInfo.index].source;
  return typeof source === "number" && missingImageIndices.has(source);
}

function materialUsesMissingGltfTexture(
  material: GltfMaterial,
  textures: GltfDocument["textures"],
  missingImageIndices: ReadonlySet<number>,
) {
  return valueUsesMissingGltfTexture(
    material,
    textures,
    missingImageIndices,
    new Set(),
  );
}

function valueUsesMissingGltfTexture(
  value: unknown,
  textures: GltfDocument["textures"],
  missingImageIndices: ReadonlySet<number>,
  seen: Set<object>,
): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) =>
      valueUsesMissingGltfTexture(item, textures, missingImageIndices, seen),
    );
  }

  return Object.entries(value).some(([key, item]) => {
    if (
      key.endsWith("Texture") &&
      textureInfoUsesMissingImage(
        item as GltfTextureInfo,
        textures,
        missingImageIndices,
      )
    ) {
      return true;
    }

    return valueUsesMissingGltfTexture(
      item,
      textures,
      missingImageIndices,
      seen,
    );
  });
}

export function applyMissingGltfTextureFallbacks(
  json: GltfDocument,
  missingImageIndices: ReadonlySet<number>,
) {
  if (missingImageIndices.size === 0 || !json.materials?.length) {
    return;
  }

  for (const material of json.materials) {
    if (
      !materialUsesMissingGltfTexture(
        material,
        json.textures,
        missingImageIndices,
      )
    ) {
      continue;
    }

    material.pbrMetallicRoughness = {
      ...GLTF_MISSING_TEXTURE_FALLBACK.pbrMetallicRoughness,
    };
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.emissiveTexture;
    delete material.extensions;
  }
}

export async function loadGltfPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);

  switch (file.extension) {
    case "glb": {
      reportStage("decode");
      const buffer = await readArrayBuffer(file.path);
      throwIfAborted(context.signal);
      await yieldToPaint();
      reportStage("gpu");
      let object:
        | (LoadedPreview["object"] & {
            animations?: LoadedPreview["clips"];
          })
        | null = null;
      let parsedInWorker = false;
      try {
        object = (await parseModelInWorker(
          file.path,
          { kind: "glb", buffer },
          { signal: context.signal, timeoutMs: context.parseTimeoutMs },
        )) as LoadedPreview["object"] & {
          animations?: LoadedPreview["clips"];
        };
        parsedInWorker = true;
      } catch (error) {
        if (isAbortOrTimeoutError(error)) {
          throw error;
        }
        if (buffer.byteLength >= WORKER_FALLBACK_SIZE_LIMIT) {
          const fileSizeMb = (buffer.byteLength / (1024 * 1024)).toFixed(1);
          throw new Error(
            `Worker parsing failed for large file (${fileSizeMb} MB). ` +
              "Main thread fallback is disabled for files over 50 MB to prevent UI freeze.",
            { cause: error },
          );
        }
        console.warn(
          "[glb] worker parse failed, falling back to main thread:",
          error,
        );
      }
      if (!parsedInWorker) {
        const { GLTFLoader } =
          await import("three/examples/jsm/loaders/GLTFLoader.js");
        throwIfAborted(context.signal);
        let gltf: Awaited<
          ReturnType<InstanceType<typeof GLTFLoader>["parseAsync"]>
        >;
        try {
          gltf = await new GLTFLoader().parseAsync(buffer, "");
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new Error(`Unable to parse GLB document: ${message}`, {
            cause: error,
          });
        }
        gltf.scene.animations = gltf.animations;
        object = gltf.scene;
      }
      if (object === null) {
        throw new Error("Unable to parse GLB preview: no object was returned.");
      }
      throwIfAborted(context.signal);
      return {
        object,
        cleanupUrls: [],
        clips: object.animations ?? [],
        formatVersion: null,
      };
    }
    case "gltf": {
      reportStage("resolve");
      const materialized = await materializeGltf(file);
      throwIfAborted(context.signal);
      await yieldToPaint();
      reportStage("gpu");
      let object:
        | (LoadedPreview["object"] & {
            animations?: LoadedPreview["clips"];
          })
        | null = null;
      let parsedInWorker = false;
      try {
        object = (await parseModelInWorker(
          file.path,
          {
            kind: "gltf",
            text: materialized.rawText,
            resourceUrls: materialized.resourceUrls,
          },
          { signal: context.signal, timeoutMs: context.parseTimeoutMs },
        )) as LoadedPreview["object"] & {
          animations?: LoadedPreview["clips"];
        };
        parsedInWorker = true;
      } catch (error) {
        if (isAbortOrTimeoutError(error)) {
          throw error;
        }
        if (materialized.rawText.length >= WORKER_FALLBACK_SIZE_LIMIT) {
          const fileSizeMb = (
            materialized.rawText.length /
            (1024 * 1024)
          ).toFixed(1);
          throw new Error(
            `Worker parsing failed for large file (${fileSizeMb} MB). ` +
              "Main thread fallback is disabled for files over 50 MB to prevent UI freeze.",
            { cause: error },
          );
        }
        console.warn(
          "[gltf] worker parse failed, falling back to main thread:",
          error,
        );
      }
      if (!parsedInWorker) {
        const { GLTFLoader } =
          await import("three/examples/jsm/loaders/GLTFLoader.js");
        const gltf = await new GLTFLoader(materialized.manager).parseAsync(
          materialized.rawText,
          "",
        );
        gltf.scene.animations = gltf.animations;
        object = gltf.scene;
      }
      if (object === null) {
        throw new Error(
          "Unable to parse glTF preview: no object was returned.",
        );
      }
      throwIfAborted(context.signal);
      return {
        object,
        cleanupUrls: materialized.cleanupUrls,
        clips: object.animations ?? [],
        formatVersion: materialized.formatVersion,
        warnings: materialized.warnings,
      };
    }
    default:
      throw new Error(
        `Preview loader is not implemented for .${file.extension}`,
      );
  }
}
