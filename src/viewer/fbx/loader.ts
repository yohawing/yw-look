import {
  Color,
  CompressedTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  LoadingManager,
  Mesh,
  Object3D,
  RGBAFormat,
  SRGBColorSpace,
  TextureLoader,
  type Material,
  type Texture,
  Loader as ThreeLoader,
} from "three";
import { errorMessage } from "../../lib/errors";
import { readBinaryFile, type SelectedFile } from "../../lib/files";
import type { LoaderContext } from "../loaderRegistry";
import { isAbortOrTimeoutError, parseModelInWorker } from "../modelParseWorker";
import { formatMissingTextureWarnings } from "../textureWarnings";
import type { DeferredTextureSnapshot, LoadedPreview } from "../types";

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
function filenameFromUrl(value: string) {
  const normalized = value.replace(/\\/g, "/");
  const withoutQuery = normalized.split(/[?#]/, 1)[0];
  return withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
}

export function resolveMissingTextureLabel(url: string, texture?: Texture) {
  const label = stripUrlSuffix(url);
  const sourceName = texture?.userData?.fbxSourceName;
  if (!/^blob:/i.test(label)) {
    if (typeof sourceName === "string" && sourceName.length > 0) {
      return stripUrlSuffix(sourceName);
    }
    return label;
  }

  const blobLabel = filenameFromUrl(label);
  if (
    typeof sourceName === "string" &&
    sourceName.length > 0 &&
    sourceName !== blobLabel
  ) {
    return filenameFromUrl(sourceName);
  }

  const textureName = texture?.isTexture ? texture.name : undefined;
  return typeof textureName === "string" && textureName.length > 0
    ? filenameFromUrl(textureName)
    : blobLabel;
}

function stripUrlSuffix(value: string) {
  return value.replace(/\\/g, "/").split(/[?#]/, 1)[0];
}

function isAbsoluteTexturePath(value: string) {
  return /^[a-zA-Z]:\//.test(value) || value.startsWith("/");
}

function getDdsFourCC(buffer: ArrayBuffer) {
  if (buffer.byteLength < 88) {
    return "";
  }
  const fourCC = new DataView(buffer).getUint32(84, true);
  return String.fromCharCode(
    fourCC & 0xff,
    (fourCC >> 8) & 0xff,
    (fourCC >> 16) & 0xff,
    (fourCC >> 24) & 0xff,
  );
}

function readDdsDimension(buffer: ArrayBuffer, offset: number) {
  return new DataView(buffer).getUint32(offset, true);
}

function decodeBc4Block(block: Uint8Array, offset: number) {
  const endpoint0 = block[offset];
  const endpoint1 = block[offset + 1];
  const palette = new Uint8Array(8);
  palette[0] = endpoint0;
  palette[1] = endpoint1;

  if (endpoint0 > endpoint1) {
    for (let i = 1; i <= 6; i += 1) {
      palette[i + 1] = Math.round(((7 - i) * endpoint0 + i * endpoint1) / 7);
    }
  } else {
    for (let i = 1; i <= 4; i += 1) {
      palette[i + 1] = Math.round(((5 - i) * endpoint0 + i * endpoint1) / 5);
    }
    palette[6] = 0;
    palette[7] = 255;
  }

  let indices = 0;
  for (let i = 0; i < 6; i += 1) {
    indices += block[offset + 2 + i] * 2 ** (8 * i);
  }

  const values = new Uint8Array(16);
  for (let i = 0; i < values.length; i += 1) {
    values[i] = palette[Math.floor(indices / 2 ** (3 * i)) & 0x07];
  }
  return values;
}

function decodeDdsAti2NormalMap(buffer: ArrayBuffer) {
  if (buffer.byteLength < 128 || getDdsFourCC(buffer) !== "ATI2") {
    throw new Error("DDS texture is not ATI2/BC5.");
  }

  const width = readDdsDimension(buffer, 16);
  const height = readDdsDimension(buffer, 12);
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  const source = new Uint8Array(buffer);
  const expectedLength = 128 + blocksWide * blocksHigh * 16;
  if (source.length < expectedLength) {
    throw new Error("DDS ATI2 payload is truncated.");
  }

  const data = new Uint8Array(width * height * 4);
  for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      const blockOffset = 128 + (blockY * blocksWide + blockX) * 16;
      const xValues = decodeBc4Block(source, blockOffset);
      const yValues = decodeBc4Block(source, blockOffset + 8);

      for (let localY = 0; localY < 4; localY += 1) {
        const y = blockY * 4 + localY;
        if (y >= height) continue;

        for (let localX = 0; localX < 4; localX += 1) {
          const x = blockX * 4 + localX;
          if (x >= width) continue;

          const blockIndex = localY * 4 + localX;
          const nx = xValues[blockIndex] / 127.5 - 1;
          const ny = yValues[blockIndex] / 127.5 - 1;
          const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
          const pixelOffset = (y * width + x) * 4;
          data[pixelOffset] = xValues[blockIndex];
          data[pixelOffset + 1] = yValues[blockIndex];
          data[pixelOffset + 2] = Math.round((nz * 0.5 + 0.5) * 255);
          data[pixelOffset + 3] = 255;
        }
      }
    }
  }

  return { width, height, data };
}

type FbxTextureWithAlphaTargets = Texture & {
  userData: Texture["userData"] & {
    fbxAlphaMode?: "blend" | "cutout";
    fbxDdsTexture?: boolean;
    fbxHasAlpha?: boolean;
    fbxMaybeAlphaTexture?: boolean;
    fbxSourceName?: string;
    fbxTgaTexture?: boolean;
  };
};

const fbxAlphaMaterialTargets = new WeakMap<Texture, Set<Material>>();

function isAlphaTextureName(value: string) {
  return /(^|[_\-.])(?:alpha|opacity|transparent|cutout|mask)([_\-.]|$)/i.test(
    value,
  );
}

function getTgaAlphaBits(buffer: ArrayBuffer) {
  if (buffer.byteLength < 18) {
    return 0;
  }
  return new DataView(buffer).getUint8(17) & 0x0f;
}

function createPendingCompressedTexture() {
  const PendingCompressedTexture = CompressedTexture as unknown as {
    new (): CompressedTexture;
  };
  return new PendingCompressedTexture();
}

function createFallbackTexture(name: string) {
  const texture = new DataTexture(new Uint8Array([199, 210, 227, 255]), 1, 1);
  texture.name = filenameFromUrl(name);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  texture.userData.textureSourceKind = "unresolved";
  return texture;
}

function copyTextureInto(target: Texture, source: Texture) {
  target.image = source.image;
  target.mipmaps = source.mipmaps;
  target.mapping = source.mapping;
  target.channel = source.channel;
  target.wrapS = source.wrapS;
  target.wrapT = source.wrapT;
  target.magFilter = source.magFilter;
  target.minFilter = source.minFilter;
  target.anisotropy = source.anisotropy;
  target.format = source.format;
  target.internalFormat = source.internalFormat;
  target.type = source.type;
  target.offset.copy(source.offset);
  target.repeat.copy(source.repeat);
  target.center.copy(source.center);
  target.rotation = source.rotation;
  target.matrix.copy(source.matrix);
  target.matrixAutoUpdate = source.matrixAutoUpdate;
  target.generateMipmaps = source.generateMipmaps;
  target.premultiplyAlpha = source.premultiplyAlpha;
  target.flipY = source.flipY;
  target.unpackAlignment = source.unpackAlignment;
  target.colorSpace = source.colorSpace;
  target.needsUpdate = true;
}

function enableFbxMaterialTransparency(
  material: Material,
  mode: "blend" | "cutout" = "cutout",
) {
  material.transparent = true;
  if (mode === "cutout") {
    material.alphaTest = Math.max(material.alphaTest, 0.01);
  } else {
    material.depthWrite = false;
  }
  material.needsUpdate = true;
}

function markFbxTextureHasAlpha(
  texture: Texture,
  mode: "blend" | "cutout" = "cutout",
) {
  const targetTexture = texture as FbxTextureWithAlphaTargets;
  targetTexture.userData.fbxHasAlpha = true;
  targetTexture.userData.fbxAlphaMode = mode;

  for (const material of fbxAlphaMaterialTargets.get(texture) ?? []) {
    enableFbxMaterialTransparency(material, mode);
  }
}

function registerFbxTextureTransparency(object: Object3D) {
  object.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    for (const material of materials) {
      for (const value of Object.values(
        material as unknown as Record<string, unknown>,
      )) {
        const targetTexture = value as FbxTextureWithAlphaTargets | null;

        if (
          !targetTexture?.isTexture ||
          (!targetTexture.userData.fbxDdsTexture &&
            !targetTexture.userData.fbxTgaTexture)
        ) {
          continue;
        }

        if (targetTexture.userData.fbxHasAlpha) {
          enableFbxMaterialTransparency(
            material,
            targetTexture.userData.fbxAlphaMode,
          );
          continue;
        }

        let targets = fbxAlphaMaterialTargets.get(targetTexture);
        if (!targets) {
          targets = new Set<Material>();
          fbxAlphaMaterialTargets.set(targetTexture, targets);
        }
        targets.add(material);
      }
    }
  });
}

const fbxTextureMaterialTargets = new WeakMap<Texture, Set<Material>>();
export function applyMissingTextureMaterialFallback(texture: Texture) {
  texture.userData.fbxMissingTexture = true;
  const targets = fbxTextureMaterialTargets.get(texture);
  if (!targets) {
    return;
  }

  for (const material of targets) {
    const texturedMaterial = material as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(texturedMaterial)) {
      if (value === texture) {
        texturedMaterial[key] = null;
      }
    }
    if ("color" in material && material.color instanceof Color) {
      material.color.set("#c7d2e3");
    }
    if ("metalness" in material && typeof material.metalness === "number") {
      material.metalness = 0.08;
    }
    if ("roughness" in material && typeof material.roughness === "number") {
      material.roughness = 0.72;
    }
    material.needsUpdate = true;
  }
}

export function registerFbxTextureMaterialFallbacks(object: Object3D) {
  object.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    for (const material of materials) {
      for (const value of Object.values(
        material as unknown as Record<string, unknown>,
      )) {
        const texture = value as Texture | null;
        if (!texture?.isTexture) {
          continue;
        }

        let targets = fbxTextureMaterialTargets.get(texture);
        if (!targets) {
          targets = new Set<Material>();
          fbxTextureMaterialTargets.set(texture, targets);
        }
        targets.add(material);

        if (texture.userData.fbxMissingTexture) {
          applyMissingTextureMaterialFallback(texture);
        }
      }
    }
  });
}

function flipFbxDdsTextureV(object: Object3D) {
  object.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    for (const material of materials) {
      for (const value of Object.values(
        material as unknown as Record<string, unknown>,
      )) {
        const texture = value as {
          isTexture?: boolean;
          isCompressedTexture?: boolean;
          repeat?: { y: number };
          offset?: { y: number };
          userData?: Record<string, unknown>;
        };
        if (
          !texture ||
          (!texture.isCompressedTexture && !texture.userData?.fbxDdsTexture) ||
          !texture.repeat ||
          !texture.offset ||
          !texture.userData ||
          texture.userData.fbxDdsVFlipped
        ) {
          continue;
        }

        texture.repeat.y *= -1;
        texture.offset.y = 1 - texture.offset.y;
        texture.userData.fbxDdsVFlipped = true;
      }
    }
  });
}

async function createFbxLoadingManager(
  file: SelectedFile,
  onDeferredTexture?: (snapshot: DeferredTextureSnapshot) => void,
  onWarning?: (warning: string) => void,
) {
  const [{ DDSLoader }, { TGALoader }] = await Promise.all([
    import("three/examples/jsm/loaders/DDSLoader.js"),
    import("three/examples/jsm/loaders/TGALoader.js"),
  ]);
  const manager = new LoadingManager();
  const ddsParser = new DDSLoader();
  const tgaParser = new TGALoader();
  const deferredTextureQueue: Array<() => Promise<void>> = [];
  let deferredTextureRunning = false;
  let cancelled = false;
  const timeoutIds: Array<ReturnType<typeof setTimeout>> = [];
  const idleIds: number[] = [];
  const deferredTextureState = {
    total: 0,
    loaded: 0,
    failed: 0,
    activeLabel: null as string | null,
    bytes: 0,
    readMs: 0,
    parseMs: 0,
  };
  const reportedMissingTextures = new Set<string>();

  const reportMissingTexture = (url: string, texture?: Texture) => {
    const label = resolveMissingTextureLabel(url, texture);
    if (texture) {
      applyMissingTextureMaterialFallback(texture);
    }
    if (reportedMissingTextures.has(label)) {
      return;
    }
    reportedMissingTextures.add(label);
    onWarning?.(formatMissingTextureWarnings([label])[0]);
  };

  const reportDeferredTexture = () => {
    const completed = deferredTextureState.loaded + deferredTextureState.failed;
    onDeferredTexture?.({
      total: deferredTextureState.total,
      loaded: deferredTextureState.loaded,
      failed: deferredTextureState.failed,
      pending: Math.max(0, deferredTextureState.total - completed),
      activeLabel: deferredTextureState.activeLabel,
      bytes: deferredTextureState.bytes,
      readMs: deferredTextureState.readMs,
      parseMs: deferredTextureState.parseMs,
    });
  };

  const scheduleDeferredTextureQueue = () => {
    if (cancelled) {
      return;
    }
    if (deferredTextureRunning) {
      return;
    }

    const work = deferredTextureQueue.shift();
    if (!work) {
      return;
    }

    deferredTextureRunning = true;
    const run = () => {
      if (cancelled) {
        deferredTextureRunning = false;
        return;
      }
      void work().finally(() => {
        deferredTextureRunning = false;
        scheduleDeferredTextureQueue();
      });
    };
    const globalWithIdle = globalThis as typeof globalThis & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
    };

    if (typeof globalWithIdle.requestIdleCallback === "function") {
      idleIds.push(globalWithIdle.requestIdleCallback(run, { timeout: 2_000 }));
    } else {
      timeoutIds.push(setTimeout(run, 16));
    }
  };

  const enqueueDeferredTexture = (label: string, work: () => Promise<void>) => {
    trackTextureStart(label);
    deferredTextureQueue.push(work);
    timeoutIds.push(setTimeout(scheduleDeferredTextureQueue, 1_000));
  };

  const trackTextureStart = (label: string) => {
    deferredTextureState.total += 1;
    deferredTextureState.activeLabel ??= label;
    reportDeferredTexture();
  };

  const trackTextureActive = (label: string) => {
    deferredTextureState.activeLabel = label;
    reportDeferredTexture();
  };

  const trackTextureDone = () => {
    deferredTextureState.loaded += 1;
    deferredTextureState.activeLabel = null;
    reportDeferredTexture();
    const completed = deferredTextureState.loaded + deferredTextureState.failed;
    if (
      completed === deferredTextureState.total &&
      deferredTextureState.total
    ) {
      if (import.meta.env.DEV) {
        console.info("[fbx] texture stream complete", {
          total: deferredTextureState.total,
          failed: deferredTextureState.failed,
          bytes: deferredTextureState.bytes,
          readMs: Math.round(deferredTextureState.readMs),
          parseMs: Math.round(deferredTextureState.parseMs),
        });
      }
    }
  };

  const trackTextureFailed = () => {
    deferredTextureState.failed += 1;
    deferredTextureState.activeLabel = null;
    reportDeferredTexture();
  };

  const readResolvedTextureBuffer = async (url: string) => {
    const reference = stripUrlSuffix(url);
    const fileName = filenameFromUrl(reference);
    const directCandidate = isAbsoluteTexturePath(reference)
      ? reference
      : resolveSiblingPath(file.parentDirectory, reference);
    const textureFolderCandidate = resolveSiblingPath(
      file.parentDirectory,
      `Textures/${fileName}`,
    );
    const candidates =
      directCandidate === textureFolderCandidate
        ? [directCandidate]
        : [directCandidate, textureFolderCandidate];

    let lastError: unknown = null;
    for (const candidate of candidates) {
      try {
        if (cancelled) {
          throw new Error("FBX texture load cancelled.");
        }
        const readStartedAt = performance.now();
        const buffer = await readArrayBuffer(candidate);
        if (cancelled) {
          throw new Error("FBX texture load cancelled.");
        }
        deferredTextureState.bytes += buffer.byteLength;
        deferredTextureState.readMs += performance.now() - readStartedAt;
        return {
          path: candidate,
          buffer,
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Missing FBX texture: ${url}`);
  };

  const readTextureBuffer = async (url: string) =>
    (await readResolvedTextureBuffer(url)).buffer;

  class LocalDdsLoader extends ThreeLoader<Texture> {
    constructor() {
      super(manager);
    }

    override load(url: string, onLoad?: (texture: Texture) => void) {
      const resourceUrl = `${this.path ?? ""}${url}`;
      const textureReference = stripUrlSuffix(url);
      const isLikelyNormalMap = /(^|[_\-.])(?:normal|nrm|n)([_\-.]|$)/i.test(
        filenameFromUrl(textureReference),
      );
      const texture: Texture = isLikelyNormalMap
        ? new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)
        : createPendingCompressedTexture();
      texture.userData.fbxDdsTexture = true;
      const textureLabel = filenameFromUrl(textureReference);
      texture.userData.fbxSourceName = textureReference;
      if (isAlphaTextureName(textureLabel)) {
        texture.userData.fbxMaybeAlphaTexture = true;
        texture.userData.fbxAlphaMode = "cutout";
      }

      const loadTexture = () => {
        trackTextureActive(textureLabel);
        manager.itemStart(resourceUrl);
        return readResolvedTextureBuffer(resourceUrl)
          .then(({ buffer }) => {
            if (cancelled) {
              return;
            }
            const fourCC = getDdsFourCC(buffer);
            if (fourCC === "DXT3" || fourCC === "DXT5") {
              markFbxTextureHasAlpha(texture);
            }

            const parseStartedAt = performance.now();
            if (fourCC === "ATI2") {
              const decoded = decodeDdsAti2NormalMap(buffer);
              deferredTextureState.parseMs +=
                performance.now() - parseStartedAt;
              if (texture instanceof DataTexture) {
                texture.image.width = decoded.width;
                texture.image.height = decoded.height;
                texture.image.data = decoded.data;
                texture.format = RGBAFormat;
                texture.magFilter = LinearFilter;
                texture.minFilter = LinearFilter;
                texture.generateMipmaps = false;
                texture.needsUpdate = true;
              } else {
                console.warn(
                  "[fbx] ATI2/BC5 DDS texture was not named like a normal map, so the compressed placeholder was left unchanged:",
                  resourceUrl,
                );
              }
              onLoad?.(texture);
              trackTextureDone();
              return;
            }

            const texData = ddsParser.parse(buffer, true);
            deferredTextureState.parseMs += performance.now() - parseStartedAt;
            if (cancelled) {
              return;
            }
            if (!(texture instanceof CompressedTexture)) {
              console.warn(
                "[fbx] DDS texture was named like a normal map but is not ATI2/BC5, so it was left as a neutral normal placeholder:",
                resourceUrl,
              );
              onLoad?.(texture);
              trackTextureDone();
              return;
            }

            if (isAlphaTextureName(textureLabel)) {
              markFbxTextureHasAlpha(texture);
            }

            if (texData.isCubemap) {
              const faces = texData.mipmaps.length / texData.mipmapCount;
              (texture as unknown as { image: unknown }).image = Array.from(
                { length: faces },
                (_, face) => ({
                  mipmaps: texData.mipmaps.slice(
                    face * texData.mipmapCount,
                    (face + 1) * texData.mipmapCount,
                  ),
                  format: texData.format,
                  width: texData.width,
                  height: texData.height,
                }),
              );
            } else {
              texture.image.width = texData.width;
              texture.image.height = texData.height;
              texture.mipmaps = texData.mipmaps;
            }

            if (texData.mipmapCount === 1) {
              texture.minFilter = LinearFilter;
            }

            texture.format = texData.format as CompressedTexture["format"];
            texture.needsUpdate = true;
            onLoad?.(texture);
            trackTextureDone();
          })
          .catch((error: unknown) => {
            if (cancelled) {
              return;
            }
            manager.itemError(resourceUrl);
            warnTextureFallback("[fbx] Failed to load deferred DDS texture:", {
              url: resourceUrl,
              error,
            });
            reportMissingTexture(resourceUrl, texture);
            trackTextureFailed();
          })
          .finally(() => manager.itemEnd(resourceUrl));
      };

      if (isLikelyNormalMap) {
        enqueueDeferredTexture(textureLabel, loadTexture);
      } else {
        trackTextureStart(textureLabel);
        void loadTexture();
      }

      return texture;
    }
  }

  class LocalTgaLoader extends ThreeLoader<DataTexture> {
    constructor() {
      super(manager);
    }

    override load(url: string, onLoad?: (texture: DataTexture) => void) {
      const texture = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
      const resourceUrl = `${this.path ?? ""}${url}`;
      const textureReference = stripUrlSuffix(url);
      const textureLabel = filenameFromUrl(textureReference);
      texture.userData.fbxTgaTexture = true;
      texture.userData.fbxSourceName = textureReference;
      if (isAlphaTextureName(textureLabel)) {
        texture.userData.fbxMaybeAlphaTexture = true;
        texture.userData.fbxAlphaMode = "cutout";
      }
      trackTextureStart(textureLabel);
      trackTextureActive(textureLabel);
      manager.itemStart(resourceUrl);

      readTextureBuffer(resourceUrl)
        .then((buffer) => {
          if (cancelled) {
            return;
          }
          const parseStartedAt = performance.now();
          if (getTgaAlphaBits(buffer) > 0) {
            markFbxTextureHasAlpha(texture);
          }
          const texData = tgaParser.parse(buffer) as unknown as {
            image?: DataTexture["image"];
            data?: Uint8Array;
            width: number;
            height: number;
            wrapS?: DataTexture["wrapS"];
            wrapT?: DataTexture["wrapT"];
            magFilter?: DataTexture["magFilter"];
            minFilter?: DataTexture["minFilter"];
            anisotropy?: number;
            format?: DataTexture["format"];
            type?: DataTexture["type"];
            flipY?: boolean;
            colorSpace?: DataTexture["colorSpace"];
            mipmaps?: DataTexture["mipmaps"];
            mipmapCount?: number;
            generateMipmaps?: boolean;
          };
          deferredTextureState.parseMs += performance.now() - parseStartedAt;
          if (cancelled) {
            return;
          }
          if (isAlphaTextureName(textureLabel)) {
            markFbxTextureHasAlpha(texture);
          }

          if (texData.image !== undefined) {
            texture.image = texData.image;
          } else if (texData.data !== undefined) {
            texture.image.width = texData.width;
            texture.image.height = texData.height;
            texture.image.data = texData.data;
          }

          texture.wrapS = texData.wrapS ?? texture.wrapS;
          texture.wrapT = texData.wrapT ?? texture.wrapT;
          texture.magFilter = texData.magFilter ?? LinearFilter;
          texture.minFilter = texData.minFilter ?? LinearFilter;
          texture.anisotropy = texData.anisotropy ?? 1;

          if (texData.format !== undefined) texture.format = texData.format;
          if (texData.type !== undefined) texture.type = texData.type;
          if (texData.flipY !== undefined) texture.flipY = texData.flipY;
          if (texData.colorSpace !== undefined) {
            texture.colorSpace = texData.colorSpace;
          }
          if (texData.mipmaps !== undefined) {
            texture.mipmaps = texData.mipmaps;
            texture.minFilter = LinearMipmapLinearFilter;
          }
          if (texData.mipmapCount === 1) {
            texture.minFilter = LinearFilter;
          }
          if (texData.generateMipmaps !== undefined) {
            texture.generateMipmaps = texData.generateMipmaps;
          }

          texture.needsUpdate = true;
          onLoad?.(texture);
          trackTextureDone();
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
          manager.itemError(resourceUrl);
          warnTextureFallback("[fbx] Failed to load deferred TGA texture:", {
            url: resourceUrl,
            error,
          });
          reportMissingTexture(resourceUrl, texture);
          trackTextureFailed();
        })
        .finally(() => manager.itemEnd(resourceUrl));

      return texture;
    }
  }

  class LocalImageLoader extends ThreeLoader<Texture> {
    constructor() {
      super(manager);
    }

    override load(url: string, onLoad?: (texture: Texture) => void) {
      const resourceUrl = `${this.path ?? ""}${url}`;
      const textureReference = stripUrlSuffix(url);
      const textureLabel = filenameFromUrl(textureReference);
      const texture = createFallbackTexture(resourceUrl);
      texture.userData.fbxSourceName = textureReference;

      trackTextureStart(textureLabel);
      trackTextureActive(textureLabel);
      manager.itemStart(resourceUrl);

      readResolvedTextureBuffer(resourceUrl)
        .then(({ buffer, path }) => {
          if (cancelled) {
            return;
          }
          const extension = path.split(".").pop()?.toLowerCase() ?? "bin";
          const objectUrl = URL.createObjectURL(
            new Blob([buffer], { type: getMimeType(extension) }),
          );
          return new TextureLoader()
            .loadAsync(objectUrl)
            .then((loadedTexture) => {
              URL.revokeObjectURL(objectUrl);
              if (cancelled) {
                return;
              }
              copyTextureInto(texture, loadedTexture);
              loadedTexture.dispose();
              texture.name = textureLabel;
              texture.userData.fbxSourceName = textureReference;
              texture.userData.textureSourceKind = "external";
              onLoad?.(texture);
              trackTextureDone();
            })
            .catch((error: unknown) => {
              URL.revokeObjectURL(objectUrl);
              throw error;
            });
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
          manager.itemError(resourceUrl);
          warnTextureFallback("[fbx] Failed to load texture; using fallback:", {
            url: resourceUrl,
            error,
          });
          reportMissingTexture(resourceUrl, texture);
          onLoad?.(texture);
          trackTextureFailed();
        })
        .finally(() => manager.itemEnd(resourceUrl));

      return texture;
    }
  }

  manager.addHandler(/\.dds$/i, new LocalDdsLoader());
  manager.addHandler(/\.tga$/i, new LocalTgaLoader());
  manager.addHandler(/\.(?:png|jpe?g|webp|bmp|gif)$/i, new LocalImageLoader());
  const cleanup = () => {
    cancelled = true;
    deferredTextureQueue.length = 0;
    for (const timeoutId of timeoutIds) {
      clearTimeout(timeoutId);
    }
    const globalWithIdle = globalThis as typeof globalThis & {
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof globalWithIdle.cancelIdleCallback === "function") {
      for (const idleId of idleIds) {
        globalWithIdle.cancelIdleCallback(idleId);
      }
    }
  };
  return { manager, cleanupUrls: [], cleanupCallbacks: [cleanup] };
}

export async function loadFbxPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  throwIfAborted(context.signal);
  reportStage("decode");
  const { FBXLoader } = await import("../../vendor/FBXLoaderPatched.js");
  const readStartedAt = performance.now();
  const buffer = await readArrayBuffer(file.path);
  throwIfAborted(context.signal);
  const readMs = performance.now() - readStartedAt;
  reportStage("scene");
  await yieldToPaint();
  throwIfAborted(context.signal);
  const parseStartedAt = performance.now();
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
        kind: "fbx",
        buffer,
        resourcePath: `${file.parentDirectory.replace(/\\/g, "/")}/`,
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
    if (buffer.byteLength >= WORKER_FALLBACK_SIZE_LIMIT) {
      const fileSizeMb = (buffer.byteLength / (1024 * 1024)).toFixed(1);
      throw new Error(
        `Worker parsing failed for large file (${fileSizeMb} MB). ` +
          "Main thread fallback is disabled for files over 50 MB to prevent UI freeze.",
        { cause: error },
      );
    }
    console.warn(
      "[fbx] worker parse failed, falling back to main thread:",
      error,
    );
  }
  const { manager, cleanupCallbacks, cleanupUrls } =
    await createFbxLoadingManager(
      file,
      context.onDeferredTexture,
      context.onWarning,
    );
  throwIfAborted(context.signal);
  if (!parsedInWorker) {
    try {
      object = new FBXLoader(manager).parse(
        buffer,
        `${file.parentDirectory.replace(/\\/g, "/")}/`,
      );
    } catch (error) {
      const message = errorMessage(error, "Unknown error");
      throw new Error(
        `Unable to parse FBX preview: ${message}. This FBX may contain animation-only data or unsupported deformers without geometry.`,
        { cause: error },
      );
    }
  }
  if (!object) {
    throw new Error("Unable to parse FBX preview: no object was returned.");
  }
  const parseMs = performance.now() - parseStartedAt;
  flipFbxDdsTextureV(object);
  registerFbxTextureMaterialFallbacks(object);
  registerFbxTextureTransparency(object);
  if (import.meta.env.DEV) {
    console.info("[fbx] timing", {
      file: file.fileName,
      bytes: buffer.byteLength,
      readMs: Math.round(readMs),
      parseMs: Math.round(parseMs),
    });
  }
  reportStage("gpu");
  return {
    object,
    cleanupUrls,
    cleanupCallbacks,
    clips: object.animations ?? [],
    formatVersion: null,
  };
}
