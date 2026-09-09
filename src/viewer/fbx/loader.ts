import {
  Bone,
  ClampToEdgeWrapping,
  Color,
  CompressedTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  LoadingManager,
  Mesh,
  Object3D,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  UnsignedByteType,
  type Material,
  Loader as ThreeLoader,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { errorMessage } from "../../lib/errors";
import { cancelFbxImport, convertFbxToPreview } from "../../lib/fbx";
import {
  decodePsdFile,
  readBinaryFile,
  type DecodedPsdImage,
  type SelectedFile,
} from "../../lib/files";
import type { LoaderContext } from "../loaderRegistry";
import {
  DEFAULT_MODEL_PARSE_TIMEOUT_MS,
  isAbortOrTimeoutError,
  parseModelInWorker,
} from "../modelParseWorker";
import { formatMissingTextureWarnings } from "../textureWarnings";
import type { DeferredTextureSnapshot, LoadedPreview } from "../types";

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

/** Bounded FBX sidecar policy. Deliberately never searches recursively. */
export function resolveTextureCandidates(
  reference: string,
  baseDirectory: string,
) {
  const fileName = filenameFromUrl(reference);
  const directCandidate = isAbsoluteTexturePath(reference)
    ? reference
    : resolveSiblingPath(baseDirectory, reference);
  const basenameCandidate = resolveSiblingPath(baseDirectory, fileName);
  const textureFolderCandidate = resolveSiblingPath(
    baseDirectory,
    `Textures/${fileName}`,
  );
  const parentTextureCandidate = resolveSiblingPath(
    baseDirectory,
    `../Texture/${fileName}`,
  );
  return [
    ...new Set([
      directCandidate,
      basenameCandidate,
      textureFolderCandidate,
      parentTextureCandidate,
    ]),
  ];
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

function decodeBc4Block(
  block: Uint8Array,
  offset: number,
  palette: Uint8Array,
  values: Uint8Array,
) {
  const endpoint0 = block[offset];
  const endpoint1 = block[offset + 1];
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

  let low =
    block[offset + 2] |
    (block[offset + 3] << 8) |
    (block[offset + 4] << 16) |
    (block[offset + 5] << 24);
  let high = block[offset + 6] | (block[offset + 7] << 8);
  for (let i = 0; i < values.length; i += 1) {
    values[i] = palette[low & 7];
    low = (low >>> 3) | ((high & 7) << 29);
    high >>>= 3;
  }
}

export function decodeDdsAti2NormalMap(buffer: ArrayBuffer) {
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
  const palette = new Uint8Array(8);
  const xValues = new Uint8Array(16);
  const yValues = new Uint8Array(16);
  for (let blockY = 0; blockY < blocksHigh; blockY += 1) {
    for (let blockX = 0; blockX < blocksWide; blockX += 1) {
      const blockOffset = 128 + (blockY * blocksWide + blockX) * 16;
      decodeBc4Block(source, blockOffset, palette, xValues);
      decodeBc4Block(source, blockOffset + 8, palette, yValues);

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
    fbxDecodedTexture?: Texture;
    fbxDdsTexture?: boolean;
    fbxHasAlpha?: boolean;
    fbxMaybeAlphaTexture?: boolean;
    fbxPsdTexture?: boolean;
    fbxSourceName?: string;
    fbxTgaTexture?: boolean;
  };
};

const fbxAlphaMaterialTargets = new WeakMap<Texture, Set<Material>>();
type FbxTextureSlotTarget = { material: Material; slot: string };

const fbxTextureSlotTargets = new WeakMap<Texture, Set<FbxTextureSlotTarget>>();

function copyFbxTextureState(target: Texture, source: Texture) {
  target.name = source.name;
  target.offset.copy(source.offset);
  target.repeat.copy(source.repeat);
  target.center.copy(source.center);
  target.rotation = source.rotation;
  target.wrapS = source.wrapS;
  target.wrapT = source.wrapT;
  target.mapping = source.mapping;
  target.anisotropy = source.anisotropy;
  target.colorSpace = source.colorSpace;
  target.magFilter = LinearFilter;
  target.minFilter = LinearFilter;
  target.generateMipmaps = false;
  target.flipY = false;
  target.userData = { ...source.userData, textureSourceKind: "external" };
}

function createFbxPsdTexture(
  source: Texture,
  width: number,
  height: number,
  data: Uint8Array,
) {
  const texture = new DataTexture(
    new Uint8Array(data),
    width,
    height,
    RGBAFormat,
    UnsignedByteType,
  );
  copyFbxTextureState(texture, source);
  texture.needsUpdate = true;
  return texture;
}

function createFbxPsdAlphaMapTexture(source: Texture) {
  const image = source.image as {
    data?: Uint8Array;
    width?: number;
    height?: number;
  };
  if (
    !(image.data instanceof Uint8Array) ||
    typeof image.width !== "number" ||
    typeof image.height !== "number"
  ) {
    return source;
  }

  const data = new Uint8Array(image.data);
  for (let index = 0; index < data.length; index += 4) {
    data[index + 1] = image.data[index + 3];
  }
  return createFbxPsdTexture(source, image.width, image.height, data);
}

function getFbxDecodedTextureForSlot(source: Texture, slot: string) {
  const decoded = (source as FbxTextureWithAlphaTargets).userData
    .fbxDecodedTexture;
  if (!decoded) {
    return source;
  }
  return slot === "alphaMap" && decoded.userData.fbxPsdTexture === true
    ? createFbxPsdAlphaMapTexture(decoded)
    : decoded;
}

function registerFbxTextureSlotTarget(
  texture: Texture,
  material: Material,
  slot: string,
) {
  let targets = fbxTextureSlotTargets.get(texture);
  if (!targets) {
    targets = new Set<FbxTextureSlotTarget>();
    fbxTextureSlotTargets.set(texture, targets);
  }
  targets.add({ material, slot });
}

function replaceFbxTextureSlotTargets(texture: Texture) {
  const source = texture as FbxTextureWithAlphaTargets;
  if (!source.userData.fbxDecodedTexture) {
    return;
  }

  for (const { material, slot } of fbxTextureSlotTargets.get(texture) ?? []) {
    const materialRecord = material as unknown as Record<string, unknown>;
    if (materialRecord[slot] !== texture) {
      continue;
    }
    materialRecord[slot] = getFbxDecodedTextureForSlot(texture, slot);
    material.needsUpdate = true;
  }
}

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
  // Three.js uploads compressed textures through `mipmaps[0]` before the
  // deferred file read completes. A bare CompressedTexture leaves `mipmaps`
  // undefined, so the first render races the read and crashes in
  // WebGLTextures.uploadTexture. Keep a valid 1x1 RGBA level until DDS data
  // replaces it. The temporary texture is disposed before decoded data is
  // applied so Three.js allocates fresh GPU storage even when the DDS uses
  // the same format and type as this placeholder.
  const texture = new PendingCompressedTexture();
  texture.image = { width: 1, height: 1 };
  texture.mipmaps = [
    {
      data: new Uint8Array([199, 210, 227, 255]),
      width: 1,
      height: 1,
    },
  ];
  // A single placeholder level cannot satisfy a mipmap minification filter.
  texture.minFilter = LinearFilter;
  // CompressedTexture's public type only accepts compressed formats, but
  // Three.js explicitly supports RGBAFormat in its uncompressed mipmap
  // branch, which is what makes this 1x1 placeholder uploadable.
  texture.format = RGBAFormat as CompressedTexture["format"];
  texture.type = UnsignedByteType;
  return texture;
}

export function createFbxPendingImageTexture(name: string) {
  // Keep this a regular Texture. The deferred PNG/JPEG decode replaces the
  // empty image with an HTML image; a DataTexture instance would keep Three's
  // data-texture GPU upload path and render the decoded image black.
  const texture = new Texture();
  texture.name = filenameFromUrl(name);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  texture.userData.textureSourceKind = "unresolved";
  return texture;
}

export function copyDecodedFbxTextureImage(target: Texture, source: Texture) {
  // The pending pixel may already have allocated immutable GPU storage.
  // Release it before replacing the image with different dimensions.
  target.dispose();
  target.image = source.image;
  target.mipmaps = source.mipmaps;
  target.format = source.format;
  target.internalFormat = source.internalFormat;
  target.type = source.type;
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
      for (const [slot, value] of Object.entries(
        material as unknown as Record<string, unknown>,
      )) {
        const targetTexture = value as FbxTextureWithAlphaTargets | null;

        if (
          !targetTexture?.isTexture ||
          (!targetTexture.userData.fbxDdsTexture &&
            !targetTexture.userData.fbxTgaTexture &&
            !targetTexture.userData.fbxPsdTexture)
        ) {
          continue;
        }

        registerFbxTextureSlotTarget(targetTexture, material, slot);

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
      const materialRecord = material as unknown as Record<string, unknown>;
      for (const [slot, value] of Object.entries(
        material as unknown as Record<string, unknown>,
      )) {
        const sourceTexture = value as Texture | null;
        if (!sourceTexture?.isTexture) {
          continue;
        }

        const texture = getFbxDecodedTextureForSlot(sourceTexture, slot);
        if (texture !== sourceTexture) {
          materialRecord[slot] = texture;
          material.needsUpdate = true;
        } else {
          registerFbxTextureSlotTarget(sourceTexture, material, slot);
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
    const candidates = resolveTextureCandidates(
      reference,
      file.parentDirectory,
    );

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

  const decodeResolvedPsdTexture = async (url: string) => {
    const reference = stripUrlSuffix(url);
    const candidates = resolveTextureCandidates(
      reference,
      file.parentDirectory,
    );
    let lastError: unknown = null;
    for (const candidate of candidates) {
      try {
        if (cancelled) {
          throw new Error("FBX texture load cancelled.");
        }
        const decoded = await decodePsdFile(candidate);
        if (cancelled) {
          throw new Error("FBX texture load cancelled.");
        }
        return { path: candidate, decoded };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`Missing FBX PSD texture: ${url}`);
  };

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
      texture.userData.textureSourceKind = "unresolved";
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
                // The placeholder may already have been uploaded at 1x1.
                // Dispose it before changing dimensions so immutable GPU
                // storage is not reused for the decoded image.
                texture.dispose();
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
              texture.userData.textureSourceKind = "external";
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

            // DDS data can be RGBA8, matching the placeholder's format/type.
            // Dispose before replacing dimensions/mipmaps so WebGLTextures
            // cannot sub-upload larger data into the old 1x1 texStorage.
            texture.dispose();

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

            texture.minFilter =
              texData.mipmapCount > 1 ? LinearMipmapLinearFilter : LinearFilter;

            texture.format = texData.format as CompressedTexture["format"];
            texture.userData.textureSourceKind = "external";
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
            // The 1x1 compressed placeholder may already have a GPU
            // allocation from an earlier render. Remove that allocation when
            // the sidecar fails, before the material fallback drops its slot.
            texture.dispose();
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
      texture.userData.textureSourceKind = "unresolved";
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

          texture.userData.textureSourceKind = "external";
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

  class LocalPsdLoader extends ThreeLoader<DataTexture> {
    constructor() {
      super(manager);
    }

    override load(url: string, onLoad?: (texture: DataTexture) => void) {
      // A transparent 1x1 pixel is only a temporary slot. If decode fails,
      // reportMissingTexture removes the material slot so it cannot leave an
      // empty alphaMap that makes the whole FBX mesh invisible.
      const texture = new DataTexture(
        new Uint8Array([0, 0, 0, 0]),
        1,
        1,
        RGBAFormat,
        UnsignedByteType,
      );
      const resourceUrl = `${this.path ?? ""}${url}`;
      const textureReference = stripUrlSuffix(url);
      const textureLabel = filenameFromUrl(textureReference);
      texture.userData.fbxPsdTexture = true;
      texture.userData.fbxSourceName = textureReference;
      texture.userData.textureSourceKind = "unresolved";
      texture.colorSpace = SRGBColorSpace;
      texture.magFilter = LinearFilter;
      texture.minFilter = LinearFilter;
      texture.generateMipmaps = false;
      texture.flipY = false;
      texture.needsUpdate = true;

      trackTextureStart(textureLabel);
      trackTextureActive(textureLabel);
      manager.itemStart(resourceUrl);

      decodeResolvedPsdTexture(resourceUrl)
        .then(({ decoded }: { path: string; decoded: DecodedPsdImage }) => {
          if (cancelled) {
            return;
          }
          texture.name = textureLabel;
          texture.userData.textureSourceKind = "external";
          texture.userData.fbxDecodedTexture = createFbxPsdTexture(
            texture,
            decoded.width,
            decoded.height,
            decoded.data,
          );
          replaceFbxTextureSlotTargets(texture);
          onLoad?.(texture.userData.fbxDecodedTexture);
          trackTextureDone();
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
          manager.itemError(resourceUrl);
          warnTextureFallback("[fbx] Failed to load deferred PSD texture:", {
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
      const texture = createFbxPendingImageTexture(resourceUrl);
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
              copyDecodedFbxTextureImage(texture, loadedTexture);
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

  const ddsLoader = new LocalDdsLoader();
  const tgaLoader = new LocalTgaLoader();
  const psdLoader = new LocalPsdLoader();
  const imageLoader = new LocalImageLoader();
  manager.addHandler(/\.dds$/i, ddsLoader);
  manager.addHandler(/\.tga$/i, tgaLoader);
  manager.addHandler(/\.psd$/i, psdLoader);
  manager.addHandler(/\.(?:png|jpe?g|webp|bmp|gif)$/i, imageLoader);

  /**
   * Start deferred external texture loading for a relative FBX source reference
   * using the same extension handlers as live FBX parse. Does not block; file
   * reads are queued by the existing Local* loaders.
   */
  const loadDeferredTexture = (reference: string): Texture => {
    const stripped = stripUrlSuffix(reference);
    const handler =
      manager.getHandler(stripped) ??
      manager.getHandler(`placeholder.${stripped.split(".").pop() ?? "bin"}`);
    // Local* loaders override load() to return Texture immediately (async fill).
    if (handler && typeof (handler as { load?: unknown }).load === "function") {
      return (handler as unknown as { load: (url: string) => Texture }).load(
        stripped,
      );
    }
    // Unknown extension: still attempt image path so hydration is best-effort.
    return imageLoader.load(stripped);
  };

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
  return {
    manager,
    cleanupUrls: [] as string[],
    cleanupCallbacks: [cleanup],
    loadDeferredTexture,
  };
}

/**
 * Replace worker static-scene texture placeholders (`userData.fbxSourceName`)
 * with main-thread deferred textures from `createFbxLoadingManager`.
 * Preserves sampler/transform properties from the placeholder and does not
 * re-parse the FBX or await texture file I/O.
 */
export function hydrateFbxDeferredTexturePlaceholders(
  object: Object3D,
  loadDeferredTexture: (reference: string) => Texture,
) {
  const hydratedMaterials = new Set<Material>();
  const rootBindings = object.userData?.fbxTextureBindings;
  const bindings = Array.isArray(rootBindings) ? rootBindings : [];

  type FbxBinding = {
    materialId?: number;
    materialIndex?: number;
    slot?: string;
    source?: string;
    wrapS?: number;
    wrapT?: number;
    transform?: {
      offset?: [number, number];
      scale?: [number, number];
      rotation?: number;
    };
  };
  const isBindingForMaterial = (binding: FbxBinding, material: Material) => {
    const materialId = material.userData?.fbxMaterialId;
    const materialIndex = material.userData?.fbxMaterialIndex;
    if (
      typeof materialId === "number" &&
      typeof binding.materialId === "number"
    ) {
      return binding.materialId === materialId;
    }
    return (
      typeof materialIndex === "number" &&
      typeof binding.materialIndex === "number" &&
      binding.materialIndex === materialIndex
    );
  };
  const applyBindingSampler = (texture: Texture, binding: FbxBinding) => {
    if (binding.wrapS === 33071) texture.wrapS = ClampToEdgeWrapping;
    if (binding.wrapS === 10497) texture.wrapS = RepeatWrapping;
    if (binding.wrapT === 33071) texture.wrapT = ClampToEdgeWrapping;
    if (binding.wrapT === 10497) texture.wrapT = RepeatWrapping;
    const transform = binding.transform;
    if (transform) {
      if (transform.offset) texture.offset.fromArray(transform.offset);
      if (transform.scale) texture.repeat.fromArray(transform.scale);
      if (typeof transform.rotation === "number") {
        texture.rotation = transform.rotation;
      }
    }
    texture.needsUpdate = true;
  };
  object.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    for (const material of materials) {
      if (!material || hydratedMaterials.has(material)) {
        continue;
      }
      hydratedMaterials.add(material);
      const materialRecord = material as unknown as Record<string, unknown>;
      const materialBindings = bindings.filter(
        (candidate): candidate is FbxBinding =>
          typeof candidate === "object" &&
          candidate !== null &&
          isBindingForMaterial(candidate as FbxBinding, material),
      );
      for (const binding of materialBindings) {
        if (typeof binding.source !== "string" || binding.source.length === 0) {
          continue;
        }
        const slotMetadata = {
          baseColor: "fbxBaseColorSource",
          normal: "fbxNormalSource",
          emissive: "fbxEmissiveSource",
          opacity: "fbxOpacitySource",
          roughness: "fbxRoughnessSource",
          metalness: "fbxMetalnessSource",
          ambientOcclusion: "fbxAmbientOcclusionSource",
        } as const;
        const slot = binding.slot;
        if (typeof slot === "string" && slot in slotMetadata) {
          material.userData[slotMetadata[slot as keyof typeof slotMetadata]] =
            binding.source;
          const current =
            materialRecord[
              slot === "baseColor"
                ? "map"
                : slot === "normal"
                  ? "normalMap"
                  : slot === "emissive"
                    ? "emissiveMap"
                    : slot === "opacity"
                      ? "alphaMap"
                      : slot === "roughness"
                        ? "roughnessMap"
                        : slot === "metalness"
                          ? "metalnessMap"
                          : "aoMap"
            ];
          if (current instanceof Texture) {
            applyBindingSampler(current, binding);
          }
        }
      }
      // Opacity textures are referenced through occlusionTexture in the GLB
      // solely so GLTFLoader materializes embedded bytes. Move that texture to
      // Three.js' actual alphaMap slot before deferred hydration.
      if (
        material.userData?.fbxOpacityTextureIndex !== undefined &&
        !(materialRecord.alphaMap instanceof Texture) &&
        materialRecord.aoMap instanceof Texture
      ) {
        materialRecord.alphaMap = materialRecord.aoMap;
        materialRecord.aoMap = null;
        const opacityBinding = materialBindings.find(
          (binding) => binding.slot === "opacity",
        );
        if (opacityBinding) {
          applyBindingSampler(
            materialRecord.alphaMap as Texture,
            opacityBinding,
          );
        }
      }
      const opacityMode = material.userData?.fbxOpacityMode;
      if (material.userData?.fbxOpacitySource) {
        if (opacityMode === "MASK") {
          material.transparent = false;
          material.alphaTest = Math.max(material.alphaTest, 0.5);
        } else {
          material.transparent = true;
          material.depthWrite = false;
        }
        material.needsUpdate = true;
      }
      const deferredMaterialSlots = [
        ["map", "fbxBaseColorSource"],
        ["normalMap", "fbxNormalSource"],
        ["emissiveMap", "fbxEmissiveSource"],
        ["alphaMap", "fbxOpacitySource"],
        ["roughnessMap", "fbxRoughnessSource"],
        ["metalnessMap", "fbxMetalnessSource"],
        ["aoMap", "fbxAmbientOcclusionSource"],
      ] as const;
      for (const [slot, metadataKey] of deferredMaterialSlots) {
        const sourceName = material.userData?.[metadataKey];
        if (typeof sourceName !== "string" || sourceName.length === 0) {
          continue;
        }
        const current = materialRecord[slot];
        const bindingSlot =
          slot === "map"
            ? "baseColor"
            : slot === "normalMap"
              ? "normal"
              : slot === "emissiveMap"
                ? "emissive"
                : slot === "alphaMap"
                  ? "opacity"
                  : slot === "roughnessMap"
                    ? "roughness"
                    : slot === "metalnessMap"
                      ? "metalness"
                      : "ambientOcclusion";
        const binding = materialBindings.find(
          (candidate) => candidate.slot === bindingSlot,
        );
        if (current instanceof Texture) {
          current.userData.fbxSourceName ??= sourceName;
          if (!(
            slot === "alphaMap" &&
            material.userData?.fbxOpacityEmbedded === true
          )) {
            current.userData.fbxDeferred ??= true;
          }
          if (binding) applyBindingSampler(current, binding);
        } else {
          const placeholder = new Texture();
          placeholder.userData.fbxSourceName = sourceName;
          placeholder.userData.fbxDeferred = true;
          if (binding) applyBindingSampler(placeholder, binding);
          materialRecord[slot] = placeholder;
        }
      }
      let materialDirty = false;

      for (const [key, value] of Object.entries(materialRecord)) {
        if (!value || typeof value !== "object") {
          continue;
        }
        const placeholder = value as Texture;
        if (!placeholder.isTexture) {
          continue;
        }
        const sourceName = placeholder.userData?.fbxSourceName;
        if (typeof sourceName !== "string" || sourceName.length === 0) {
          continue;
        }
        // Native GLB deferred slots intentionally carry a valid 1x1 pixel so
        // they render opaque before hydration. Only treat real embedded image
        // data as final; fbxDeferred placeholders still need sidecar lookup.
        if (placeholder.userData.fbxDeferred === false) {
          continue;
        }
        if (
          placeholder.userData?.fbxDeferred !== true &&
          !(
            key === "alphaMap" && material.userData?.fbxOpacityEmbedded === true
          ) &&
          placeholder.image &&
          typeof placeholder.image === "object" &&
          "data" in placeholder.image &&
          (placeholder.image as ImageData).data instanceof Uint8ClampedArray &&
          (placeholder.image as ImageData).width > 0 &&
          (placeholder.image as ImageData).height > 0
        ) {
          continue;
        }
        if (
          key === "alphaMap" &&
          material.userData?.fbxOpacityEmbedded === true
        ) {
          continue;
        }
        if (/^(data:|blob:)/i.test(sourceName)) {
          continue;
        }

        const deferred = loadDeferredTexture(sourceName);
        // Keep the native opaque/neutral pixel visible while asynchronous
        // sidecar I/O is pending. Local loaders replace this image on success.
        if (!deferred.image && placeholder.image) {
          deferred.image = placeholder.image;
          deferred.mipmaps = placeholder.mipmaps;
        }
        // Preserve transform/sampler state from the static-scene placeholder.
        deferred.offset.copy(placeholder.offset);
        deferred.repeat.copy(placeholder.repeat);
        deferred.center.copy(placeholder.center);
        deferred.rotation = placeholder.rotation;
        deferred.wrapS = placeholder.wrapS;
        deferred.wrapT = placeholder.wrapT;
        const isDataTexture =
          (deferred as Texture & { isDataTexture?: boolean }).isDataTexture ===
          true;
        const isCompressedTexture =
          (deferred as Texture & { isCompressedTexture?: boolean })
            .isCompressedTexture === true;
        const isPsdTexture = deferred.userData.fbxPsdTexture === true;
        // DataTexture loaders choose a complete sampler state themselves.
        // A worker-side regular Texture placeholder defaults to a mipmapped
        // minification filter, but the deferred DataTexture intentionally has
        // no mipmaps. Copying that placeholder filter makes the WebGL texture
        // incomplete and alphaMap samples become zero.
        if (!isDataTexture && !isPsdTexture) {
          deferred.magFilter = placeholder.magFilter;
          // A pending compressed texture has one 1x1 level until its DDS
          // read completes. Preserve its non-mipmap filter instead of
          // copying the worker placeholder's mipmap filter and creating an
          // incomplete texture during the first render.
          deferred.minFilter = isCompressedTexture
            ? LinearFilter
            : placeholder.minFilter;
        }
        deferred.mapping = placeholder.mapping;
        deferred.anisotropy = placeholder.anisotropy;
        deferred.colorSpace = placeholder.colorSpace;
        if (!isDataTexture && !isPsdTexture) {
          deferred.flipY = placeholder.flipY;
        }
        deferred.userData.fbxSourceName =
          deferred.userData.fbxSourceName ?? sourceName;
        deferred.needsUpdate = true;

        materialRecord[key] = deferred;
        materialDirty = true;
      }

      if (materialDirty) {
        material.needsUpdate = true;
      }
    }
  });
}

export function applyFbxNativeNodeMetadata(object: Object3D): void {
  object.traverse((child) => {
    if (child.userData?.fbxBone === true && !(child instanceof Bone)) {
      // Native motion-only FBX files have no glTF skin to make GLTFLoader
      // instantiate Bone nodes. Bone adds no state beyond Object3D, so retain
      // object identity (and animation bindings) while restoring its runtime
      // type for bounds, metadata, and SkeletonHelper traversal.
      Object.setPrototypeOf(child, Bone.prototype);
      const bone = child as Bone & { isBone: boolean; type: string };
      bone.isBone = true;
      bone.type = "Bone";
    }
    const visible = child.userData?.visible;
    if (typeof visible === "boolean") {
      child.visible = visible;
    }
  });
}

export async function loadFbxPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  throwIfAborted(context.signal);
  reportStage("decode");
  const readStartedAt = performance.now();
  const requestId = `fbx-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const handleAbort = () => {
    void cancelFbxImport(requestId).catch(() => undefined);
  };
  context.signal?.addEventListener("abort", handleAbort, { once: true });
  const nativeTimeoutMs =
    context.parseTimeoutMs ?? DEFAULT_MODEL_PARSE_TIMEOUT_MS;
  let nativeTimeoutId: ReturnType<typeof setTimeout> | undefined;
  const nativeTimeout = new Promise<never>((_, reject) => {
    nativeTimeoutId = setTimeout(() => {
      void cancelFbxImport(requestId).catch(() => undefined);
      const timeoutError = new Error(
        `Native FBX conversion timed out after ${Math.round(nativeTimeoutMs / 1000)}s: ${file.path}`,
      );
      timeoutError.name = "TimeoutError";
      reject(timeoutError);
    }, nativeTimeoutMs);
  });
  let buffer: ArrayBuffer;
  try {
    buffer = await Promise.race([
      convertFbxToPreview(file.path, requestId),
      nativeTimeout,
    ]);
  } catch (error) {
    if (context.signal?.aborted) {
      throw createAbortError();
    }
    throw error;
  } finally {
    if (nativeTimeoutId !== undefined) {
      clearTimeout(nativeTimeoutId);
    }
    context.signal?.removeEventListener("abort", handleAbort);
  }
  throwIfAborted(context.signal);
  const readMs = performance.now() - readStartedAt;
  reportStage("scene");
  await yieldToPaint();
  throwIfAborted(context.signal);
  const parseStartedAt = performance.now();
  // Capture GLB size before transfer detaches the ArrayBuffer.
  const bufferByteLength = buffer.byteLength;
  // Native conversion has already completed off-thread. Retain one GLB-only
  // fallback copy while transferring the primary buffer to the parse worker.
  const fallbackBuffer = buffer.slice(0);
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
        kind: "fbxGlb",
        buffer,
      },
      {
        signal: context.signal,
        timeoutMs: context.parseTimeoutMs,
        transferBuffer: true,
      },
    )) as LoadedPreview["object"] & {
      animations?: LoadedPreview["clips"];
    };
    parsedInWorker = true;
  } catch (error) {
    if (isAbortOrTimeoutError(error)) {
      throw error;
    }
    console.warn(
      "[fbx] worker GLB parse failed, retrying GLB on main thread:",
      error,
    );
  }
  const { manager, cleanupCallbacks, cleanupUrls, loadDeferredTexture } =
    await createFbxLoadingManager(
      file,
      context.onDeferredTexture,
      context.onWarning,
    );
  throwIfAborted(context.signal);
  if (!parsedInWorker) {
    try {
      const gltf = await new GLTFLoader(manager).parseAsync(fallbackBuffer, "");
      gltf.scene.animations = gltf.animations;
      object = gltf.scene;
    } catch (error) {
      const message = errorMessage(error, "Unknown error");
      throw new Error(`Unable to parse native FBX preview GLB: ${message}.`, {
        cause: error,
      });
    }
  }
  if (!object) {
    throw new Error("Unable to parse FBX preview: no object was returned.");
  }
  applyFbxNativeNodeMetadata(object);
  const nativeWarnings = object.userData?.fbxWarnings;
  if (Array.isArray(nativeWarnings)) {
    for (const warning of nativeWarnings) {
      if (typeof warning === "string" && warning.length > 0) {
        context.onWarning?.(warning);
      }
    }
  }
  hydrateFbxDeferredTexturePlaceholders(object, loadDeferredTexture);
  const parseMs = performance.now() - parseStartedAt;
  flipFbxDdsTextureV(object);
  registerFbxTextureMaterialFallbacks(object);
  registerFbxTextureTransparency(object);
  if (import.meta.env.DEV) {
    console.info("[fbx] timing", {
      file: file.fileName,
      bytes: bufferByteLength,
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
