import {
  CompressedTexture,
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  LoadingManager,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  TextureLoader,
  type Material,
  type Texture,
  Loader as ThreeLoader,
} from "three";
import { type SelectedFile, readBinaryFile } from "../lib/files";
import { isTauriEnvironment } from "../lib/platform";
import { extractGeometry, inspectStage, requiresGlbPreview } from "../lib/usd";
import { LoaderRegistry, type LoaderContext } from "./loaderRegistry";
import { isUsdWorkerEnabled, parseUsdInWorker } from "./usdWorkerLoader";
import type {
  DeferredTextureSnapshot,
  LoadedPreview,
  LoadingStageReporter,
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
    case "ktx2":
      return "image/ktx2";
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
  const buffer = await readArrayBuffer(path);
  const blob = new Blob([buffer], { type: getMimeType(extension) });
  return URL.createObjectURL(blob);
}

function filenameFromUrl(value: string) {
  const normalized = value.replace(/\\/g, "/");
  const withoutQuery = normalized.split(/[?#]/, 1)[0];
  return withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
}

function stripUrlSuffix(value: string) {
  return value.replace(/\\/g, "/").split(/[?#]/, 1)[0];
}

const FALLBACK_TEXTURE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lZ8hdwAAAABJRU5ErkJggg==";

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
      console.info("[fbx] texture stream complete", {
        total: deferredTextureState.total,
        failed: deferredTextureState.failed,
        bytes: deferredTextureState.bytes,
        readMs: Math.round(deferredTextureState.readMs),
        parseMs: Math.round(deferredTextureState.parseMs),
      });
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

    override load(
      url: string,
      onLoad?: (texture: Texture) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (error: unknown) => void,
    ) {
      const resourceUrl = `${this.path ?? ""}${url}`;
      const isLikelyNormalMap = /(^|[_\-.])(?:normal|nrm|n)([_\-.]|$)/i.test(
        filenameFromUrl(resourceUrl),
      );
      const texture: Texture = isLikelyNormalMap
        ? new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)
        : createPendingCompressedTexture();
      texture.userData.fbxDdsTexture = true;
      const textureLabel = filenameFromUrl(resourceUrl);
      texture.userData.fbxSourceName = textureLabel;
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
            console.warn("[fbx] Failed to load deferred DDS texture:", {
              url: resourceUrl,
              error,
            });
            onError?.(error);
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

    override load(
      url: string,
      onLoad?: (texture: DataTexture) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (error: unknown) => void,
    ) {
      const texture = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
      const resourceUrl = `${this.path ?? ""}${url}`;
      const textureLabel = filenameFromUrl(resourceUrl);
      texture.userData.fbxTgaTexture = true;
      texture.userData.fbxSourceName = textureLabel;
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
          console.warn("[fbx] Failed to load deferred TGA texture:", {
            url: resourceUrl,
            error,
          });
          onError?.(error);
          trackTextureFailed();
        })
        .finally(() => manager.itemEnd(resourceUrl));

      return texture;
    }
  }

  manager.addHandler(/\.dds$/i, new LocalDdsLoader());
  manager.addHandler(/\.tga$/i, new LocalTgaLoader());
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

async function materializeGltf(file: SelectedFile) {
  const rawText = await readTextFile(file.path);
  const json = JSON.parse(rawText) as GltfDocument;
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
    const objectUrl = await createBlobUrlFromPath(
      resourcePath,
      extension.toLowerCase(),
    );

    cleanupUrls.push(objectUrl);
    return objectUrl;
  };

  if (json.buffers) {
    for (const buffer of json.buffers) {
      if (!buffer.uri) {
        continue;
      }
      try {
        buffer.uri = await rewriteUri(buffer.uri);
      } catch {
        missingPaths.push(buffer.uri);
      }
    }
  }

  const missingImageIndices = new Set<number>();
  if (json.images) {
    for (const [index, image] of json.images.entries()) {
      if (!image.uri) {
        continue;
      }
      try {
        image.uri = await rewriteUri(image.uri);
      } catch {
        unresolvedImages.push(image.uri);
        missingImageIndices.add(index);
        image.uri = FALLBACK_TEXTURE_DATA_URL;
      }
    }
  }

  if (missingImageIndices.size > 0) {
    applyMissingGltfTextureFallbacks(json, missingImageIndices);
    console.warn(
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

function applyMissingGltfTextureFallbacks(
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

function formatMissingTextureWarnings(paths: string[]) {
  if (paths.length === 0) {
    return [];
  }

  const uniquePaths = [...new Set(paths)];
  const listedPaths = uniquePaths.slice(0, 5).join(", ");
  const suffix =
    uniquePaths.length > 5 ? `, +${uniquePaths.length - 5} more` : "";
  return [
    `Missing texture reference${uniquePaths.length === 1 ? "" : "s"}: ${listedPaths}${suffix}. Fallback material was used.`,
  ];
}

function resolveColladaTextureUrl(
  url: string,
  blobCache: ReadonlyMap<string, string>,
  missingPaths: ReadonlySet<string>,
) {
  if (/^(data:|blob:|https?:)/i.test(url)) return url;
  return (
    blobCache.get(url) ??
    (missingPaths.has(url) ? FALLBACK_TEXTURE_DATA_URL : url)
  );
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

function shouldFailClosedOnUsdPreviewDecisionFailure(
  extension: string,
  isTauriRuntime: boolean,
) {
  return (
    isTauriRuntime &&
    (extension === "usd" || extension === "usda" || extension === "usdz")
  );
}

export async function tryExtractUsdaText(
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
  shouldFailClosedOnUsdPreviewDecisionFailure,
  applyMissingGltfTextureFallbacks,
  formatMissingTextureWarnings,
  resolveColladaTextureUrl,
};

async function loadPreviewObjectCore(
  file: SelectedFile,
  renderer?: import("three").WebGLRenderer,
  options: {
    usdLoadPolicy?: import("../lib/usd").StageLoadPolicy;
    /** #31: variant selections to apply before GLB extraction. */
    variantSelections?: import("../lib/usd").VariantSelection[];
    /**
     * #44: when provided, skip the `extractGeometry` RPC and use this
     * pre-extracted GLB buffer directly. Allows the per-prim payload
     * session to push a freshly extracted buffer into the viewport after
     * a load/unload operation without re-opening the stage.
     */
    glbOverride?: ArrayBuffer | null;
    /** Reports coarse real loader stages for the viewport loading console. */
    onStage?: LoadingStageReporter;
    /** Reports non-blocking texture work that continues after the scene mounts. */
    onDeferredTexture?: (snapshot: DeferredTextureSnapshot) => void;
  } = {},
): Promise<LoadedPreview> {
  const reportStage = options.onStage ?? (() => undefined);
  reportStage("scan");

  switch (file.extension) {
    case "glb": {
      reportStage("decode");
      const { GLTFLoader } =
        await import("three/examples/jsm/loaders/GLTFLoader.js");
      const buffer = await readArrayBuffer(file.path);
      reportStage("gpu");
      const gltf = await new GLTFLoader().parseAsync(buffer, "");
      return {
        object: gltf.scene,
        cleanupUrls: [],
        clips: gltf.animations,
        formatVersion: null,
      };
    }
    case "gltf": {
      reportStage("resolve");
      const { GLTFLoader } =
        await import("three/examples/jsm/loaders/GLTFLoader.js");
      const materialized = await materializeGltf(file);
      reportStage("gpu");
      const gltf = await new GLTFLoader().loadAsync(materialized.rootUrl);
      return {
        object: gltf.scene,
        cleanupUrls: materialized.cleanupUrls,
        clips: gltf.animations,
        formatVersion: materialized.formatVersion,
        warnings: materialized.warnings,
      };
    }
    case "fbx": {
      reportStage("decode");
      const { FBXLoader } = await import("../vendor/FBXLoaderPatched.js");
      const readStartedAt = performance.now();
      const buffer = await readArrayBuffer(file.path);
      const readMs = performance.now() - readStartedAt;
      const { manager, cleanupCallbacks, cleanupUrls } =
        await createFbxLoadingManager(file, options.onDeferredTexture);
      reportStage("scene");
      await yieldToPaint();
      const parseStartedAt = performance.now();
      const object = new FBXLoader(manager).parse(
        buffer,
        `${file.parentDirectory.replace(/\\/g, "/")}/`,
      );
      const parseMs = performance.now() - parseStartedAt;
      flipFbxDdsTextureV(object);
      registerFbxTextureTransparency(object);
      console.info("[fbx] timing", {
        file: file.fileName,
        bytes: buffer.byteLength,
        readMs: Math.round(readMs),
        parseMs: Math.round(parseMs),
      });
      reportStage("gpu");
      return {
        object,
        cleanupUrls,
        cleanupCallbacks,
        clips: object.animations,
        formatVersion: null,
      };
    }
    case "obj": {
      reportStage("decode");
      const { OBJLoader } =
        await import("three/examples/jsm/loaders/OBJLoader.js");
      const text = await readTextFile(file.path);
      reportStage("resolve");
      const object = new OBJLoader().parse(text);
      const bundle = await buildObjTextureBundle(file);
      reportStage("scene");
      applyObjTextureBundle(object, bundle);
      return {
        object,
        cleanupUrls: bundle.cleanupUrls,
        clips: [],
        formatVersion: null,
      };
    }
    case "ply": {
      reportStage("decode");
      const { PLYLoader } =
        await import("three/examples/jsm/loaders/PLYLoader.js");
      const buffer = await readArrayBuffer(file.path);
      reportStage("scene");
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
      reportStage("decode");
      const { STLLoader } =
        await import("three/examples/jsm/loaders/STLLoader.js");
      const buffer = await readArrayBuffer(file.path);
      reportStage("scene");
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
    case "dae": {
      reportStage("decode");
      const [{ ColladaLoader }, { LoadingManager }] = await Promise.all([
        import("three/examples/jsm/loaders/ColladaLoader.js"),
        import("three"),
      ]);
      const text = await readTextFile(file.path);
      const cleanupUrls: string[] = [];
      // Pre-resolve every <image>/<init_from> reference we can find in
      // the DAE document to blob URLs, then feed those through a
      // LoadingManager URL modifier so ColladaLoader.parse() (which is
      // synchronous and cannot await fs reads) picks them up.
      const imagePaths = new Set<string>();
      for (const match of text.matchAll(/<init_from>([^<]+)<\/init_from>/g)) {
        imagePaths.add(match[1].trim());
      }
      for (const match of text.matchAll(
        /<image[^>]*>\s*<source>([^<]+)<\/source>/g,
      )) {
        imagePaths.add(match[1].trim());
      }
      const blobCache = new Map<string, string>();
      const missingPaths: string[] = [];
      for (const imagePath of imagePaths) {
        if (/^(data:|blob:|https?:)/i.test(imagePath)) continue;
        const resolvedPath = resolveSiblingPath(
          file.parentDirectory,
          imagePath,
        );
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
      if (missingPaths.length > 0) {
        console.warn("[dae] missing texture references; continuing:", {
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
      reportStage("scene");
      const collada = loader.parse(text, file.parentDirectory);
      if (!collada) {
        throw new Error(
          "Collada parse returned no result; the document may be malformed.",
        );
      }
      // ColladaLoader returns a `Scene`; our preview pipeline expects
      // `Group | Mesh`. Wrap in a Group so the object is a normal
      // transform container, matching how the other loaders hand off.
      const wrapped = new Group();
      wrapped.add(collada.scene);
      return {
        object: wrapped,
        cleanupUrls,
        clips: [],
        formatVersion: null,
        warnings: formatMissingTextureWarnings(missingPaths),
      };
    }
    case "usd":
    case "usda":
    case "usdc":
    case "usdz": {
      // Phase 3: route through the Rust GLB extraction pipeline whenever
      // the stage depends on anything `USDLoader.parse` can't handle —
      // i.e. a USDC root layer *or* any external composition (references,
      // payloads, sublayers). yw-look only hands `USDLoader.parse` a
      // single text buffer; it has no file-system hook, so any authored
      // reference silently disappears. Single self-contained USDA files
      // still go through the Three.js loader because it preserves the
      // authored xform hierarchy better than our GLB flattener.
      //
      // Branching is NOT by file extension: a `.usdz` archive can wrap
      // either USDA or USDC, and a `.usd` extension can be either format
      // too. `requiresGlbPreview` opens the stage on the Rust side and
      // reports the definitive answer.
      const usdPolicy = options.usdLoadPolicy ?? "loadAll";
      let useGlbPipeline = false;
      try {
        reportStage("resolve");
        useGlbPipeline = await requiresGlbPreview(file.path);
      } catch (error) {
        if (
          shouldFailClosedOnUsdPreviewDecisionFailure(
            file.extension,
            isTauriEnvironment(),
          )
        ) {
          throw new Error(
            `Unable to determine whether ${file.fileName} requires the USD composition backend. ` +
              `JS fallback is disabled for .${file.extension} files because references, payloads, or sublayers could be omitted from the preview.`,
            { cause: error },
          );
        }

        // If the Rust check itself fails (e.g. a catastrophic parse
        // error) outside the Tauri app, fall through to the JS-side
        // magic-byte sniff so browser selftests and mocked environments
        // can still exercise the offline preview path.
        console.warn(
          "[usd] requires_glb_preview failed, falling back to JS detection:",
          error,
        );
      }

      if (useGlbPipeline || options.glbOverride != null) {
        // ---- USDC pipeline -------------------------------------------
        // Yield a frame so the Rust-populated inspector sidebar has a
        // chance to paint before we block on the (potentially heavy)
        // GLB extraction.
        await yieldToPaint();

        const started = performance.now();
        let glbBuffer: ArrayBuffer;
        if (options.glbOverride != null) {
          // #44: use the pre-extracted session buffer directly, skipping
          // the extractGeometry RPC.
          glbBuffer = options.glbOverride;
          console.info(
            `[usd] using session glb override (${glbBuffer.byteLength} bytes): ${file.fileName}`,
          );
        } else {
          reportStage("decode");
          // #31: pass variant selections through to the Tauri backend so
          // the C++ shim can apply them on the session layer before
          // geometry extraction. The options object is only constructed
          // when there are actual selections to avoid redundant IPC shape.
          const extractOptions =
            options.variantSelections && options.variantSelections.length > 0
              ? {
                  policy: usdPolicy,
                  variantSelections: options.variantSelections,
                }
              : usdPolicy;
          glbBuffer = await extractGeometry(file.path, extractOptions);
        }
        console.info(
          `[usd] extract_geometry OK in ${Math.round(
            performance.now() - started,
          )}ms (${glbBuffer.byteLength} bytes, policy=${usdPolicy}): ${file.fileName}`,
        );

        const { GLTFLoader } =
          await import("three/examples/jsm/loaders/GLTFLoader.js");
        reportStage("gpu");
        const gltf = await new GLTFLoader().parseAsync(glbBuffer, "");
        console.info(`[usd] GLTFLoader.parseAsync OK: ${file.fileName}`);

        // GLTFLoader returns a `GLTF` whose `scene` is a Group. Our
        // preview pipeline expects `Group | Mesh`, so we hand back the
        // scene root directly.
        const object = gltf.scene;

        // Apply metersPerUnit / upAxis hints from the inspector — these
        // come from the same Rust backend so the Phase 2 work continues
        // to apply uniformly.
        try {
          reportStage("scene");
          const runtimeHints = await parseUsdRuntimeHints(file.path);
          applyUsdRuntimeHints(object, runtimeHints);
        } catch (error) {
          console.warn("[usd] runtime hints failed:", error);
        }

        return {
          object,
          cleanupUrls: [],
          clips: gltf.animations,
          formatVersion: null,
        };
      }

      // ---- USDA pipeline (existing) ------------------------------------
      const { USDLoader } =
        await import("three/examples/jsm/loaders/USDLoader.js");
      reportStage("decode");
      const buffer = await readArrayBuffer(file.path);
      const loader = new USDLoader();
      const usdaText = await tryExtractUsdaText(file.extension, buffer);

      // Three.js USDLoader only handles USDA (ASCII) format. When
      // tryExtractUsdaText returns null it means the content is USDC
      // binary crate — either a raw `.usdc` / `.usd` file, or a `.usdz`
      // archive whose first layer is USDC. Normally we'd have already
      // taken the GLB pipeline branch above, but if `isRootLayerBinary`
      // failed (e.g. the backend refused to open the stage) we fall back
      // here. Passing a raw USDC buffer to `USDLoader.parse` silently
      // produces empty geometry, so we fail fast with a clear error
      // regardless of the file extension. Previously the USDZ branch
      // fell through to the synchronous loader, which reintroduced the
      // exact silent-empty-preview bug the Phase 3 pipeline is trying
      // to remove.
      if (usdaText === null) {
        throw new Error(
          `USDC binary content detected in ${file.fileName} and the GLB pipeline is unavailable. ` +
            `Stage metadata and inspection are still available in the sidebar.`,
        );
      }

      // Phase 2: yield one frame so the USD inspector sidebar (which is
      // populated in parallel by App.tsx via the Rust backend) has a chance
      // to paint before we block the main thread on the synchronous
      // Three.js parse. See docs/usd-phase2.md for the 2-stage load design.
      await yieldToPaint();

      // Route the parse to a Web Worker by default (#45). On any worker
      // failure we silently fall back to the synchronous main-thread
      // parse so the worker can never make things worse than the
      // pre-#45 behavior. Disable with `VITE_USD_WORKER=0` at build
      // time when bisecting a worker-only regression.
      let workerObject: Object3D | null = null;
      if (isUsdWorkerEnabled()) {
        try {
          reportStage("gpu");
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
      let object: Group;
      try {
        reportStage("scene");
        object =
          (workerObject as Group | null) ??
          (usdaText ? loader.parse(usdaText) : loader.parse(buffer));
        console.info(`[usd] USDLoader.parse OK: ${file.fileName}`);
      } catch (parseError) {
        console.error("[usd] USDLoader.parse failed:", parseError);
        throw parseError;
      }

      try {
        const runtimeHints = await parseUsdRuntimeHints(file.path);
        applyUsdRuntimeHints(object, runtimeHints);
      } catch (error) {
        console.warn("[usd] runtime hints failed:", error);
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
      reportStage("decode");
      const objectUrl = await createBlobUrlFromPath(file.path, file.extension);
      reportStage("gpu");
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
      reportStage("decode");
      const { TGALoader } =
        await import("three/examples/jsm/loaders/TGALoader.js");
      const objectUrl = await createBlobUrlFromPath(file.path, file.extension);
      reportStage("gpu");
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
      reportStage("decode");
      const { DDSLoader } =
        await import("three/examples/jsm/loaders/DDSLoader.js");
      const objectUrl = await createBlobUrlFromPath(file.path, file.extension);
      reportStage("gpu");
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
      reportStage("decode");
      const { RGBELoader } =
        await import("three/examples/jsm/loaders/RGBELoader.js");
      const objectUrl = await createBlobUrlFromPath(file.path, file.extension);
      reportStage("gpu");
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
      reportStage("decode");
      const { EXRLoader } =
        await import("three/examples/jsm/loaders/EXRLoader.js");
      const objectUrl = await createBlobUrlFromPath(file.path, file.extension);
      reportStage("gpu");
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
    case "ktx2": {
      reportStage("decode");
      const { KTX2Loader } =
        await import("three/examples/jsm/loaders/KTX2Loader.js");
      const objectUrl = await createBlobUrlFromPath(file.path, file.extension);
      const loader = new KTX2Loader();
      // The basis transcoder files are served from /basis/ (copied from
      // node_modules/three into public/basis/ at build time).
      loader.setTranscoderPath("/basis/");
      if (renderer) {
        loader.detectSupport(renderer);
      } else {
        // Fallback workerConfig for desktop (Tauri) where we can safely assume
        // S3TC/DXT and BPTC support on modern discrete GPUs. ASTC and PVRTC
        // are mobile-only formats; ETC2 is broadly supported but not critical.
        // This path is only taken in test/SSR environments without a renderer.
        (
          loader as unknown as { workerConfig: Record<string, boolean> }
        ).workerConfig = {
          astcSupported: false,
          astcHDRSupported: false,
          etc1Supported: false,
          etc2Supported: false,
          dxtSupported: true,
          bptcSupported: true,
          pvrtcSupported: false,
        };
      }
      // try/finally guarantees the KTX2 worker pool is torn down even when
      // the transcoder assets are missing, the file is corrupt, or the GPU
      // rejects the format — otherwise repeated failed opens leak workers.
      // On failure we also revoke the blob URL so it does not stay resident
      // (the normal cleanupUrls path only runs when we return successfully).
      let texture;
      try {
        reportStage("gpu");
        texture = await loader.loadAsync(objectUrl);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        throw error;
      } finally {
        loader.dispose();
      }
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

async function loadVrmPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  reportStage("scan");

  try {
    const [{ GLTFLoader }, { VRMLoaderPlugin, VRMUtils }] = await Promise.all([
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("@pixiv/three-vrm"),
    ]);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    reportStage("decode");
    const buffer = await readArrayBuffer(file.path);
    reportStage("gpu");
    const gltf = await loader.parseAsync(buffer, "");
    const vrm = gltf.userData.vrm as import("@pixiv/three-vrm").VRM | undefined;

    if (!vrm) {
      throw new Error(
        "The file loaded as glTF, but no VRM extension data was found.",
      );
    }

    reportStage("scene");
    VRMUtils.rotateVRM0(vrm);

    const modelName = "name" in vrm.meta ? vrm.meta.name : vrm.meta.title;
    vrm.scene.name = modelName || file.fileName;
    vrm.scene.userData.vrm = vrm;

    return {
      object: vrm.scene,
      cleanupUrls: [],
      clips: gltf.animations,
      formatVersion: `VRM ${vrm.meta.metaVersion ?? "unknown"}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load VRM preview: ${message}`, { cause: error });
  }
}

const coreLoaderExtensions = [
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
  "ktx2",
] as const;

export const loaderRegistry = new LoaderRegistry();

loaderRegistry.register({
  id: "core-preview-loader",
  name: "Core Preview Loader",
  extensions: coreLoaderExtensions,
  loadPreviewObject: (file, context) =>
    loadPreviewObjectCore(file, context.renderer, {
      usdLoadPolicy: context.usdLoadPolicy,
      variantSelections: context.variantSelections,
      glbOverride: context.glbOverride,
      onStage: context.onStage,
      onDeferredTexture: context.onDeferredTexture,
    }),
});

loaderRegistry.register({
  id: "vrm-loader-pack",
  name: "VRM Loader Pack",
  extensions: ["vrm"],
  optional: true,
  installed: true,
  loadPreviewObject: loadVrmPreviewObject,
});

export function listRegisteredLoaders() {
  return loaderRegistry.list();
}

export async function loadPreviewObject(
  file: SelectedFile,
  renderer?: import("three").WebGLRenderer,
  options: LoaderContext = {},
): Promise<LoadedPreview> {
  const loader = loaderRegistry.getByExtension(file.extension);
  if (!loader || loader.installed === false) {
    throw new Error(`Preview loader is not installed for .${file.extension}`);
  }

  return loader.loadPreviewObject(file, {
    ...options,
    renderer,
  });
}
