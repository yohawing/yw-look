import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearMipmapNearestFilter,
  LoadingManager,
  Mesh,
  MirroredRepeatWrapping,
  NearestFilter,
  NearestMipmapLinearFilter,
  NearestMipmapNearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type Material,
  type Texture,
} from "three";
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
  const deferredTextureJobs = collectDeferredGltfTextureJobs(json);
  const workerText =
    deferredTextureJobs.length > 0
      ? createWorkerGltfTextWithoutTextures(json)
      : rawText;
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

  const bufferUriSet = new Set(bufferUris);
  const resourceUris = [
    ...bufferUris,
    ...imageUris.filter((uri) => !bufferUriSet.has(uri)),
  ];
  const resourceResults = await mapWithConcurrency(
    resourceUris,
    GLTF_RESOURCE_PREFETCH_CONCURRENCY,
    async (uri) => {
      try {
        return { uri, objectUrl: await createMappedBlobUrl(uri) };
      } catch {
        return { uri, objectUrl: null };
      }
    },
  );
  for (const { uri, objectUrl } of resourceResults) {
    if (objectUrl === null) {
      if (bufferUriSet.has(uri)) {
        missingPaths.push(uri);
      } else {
        unresolvedImages.push(uri);
        urlMap.set(uri, FALLBACK_TEXTURE_DATA_URL);
      }
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
    workerText,
    manager,
    cleanupUrls,
    resourceUrls: Object.fromEntries(urlMap),
    deferredTextureJobs,
    formatVersion,
    warnings: formatMissingTextureWarnings(unresolvedImages),
  };
}

type GltfTextureInfo = {
  index?: number;
  texCoord?: number;
  scale?: number;
  strength?: number;
  extensions?: {
    KHR_texture_transform?: GltfTextureTransform;
  };
};

type GltfTextureTransform = {
  offset?: [number, number];
  scale?: [number, number];
  rotation?: number;
  texCoord?: number;
};

type DeferredGltfTextureSlot =
  | "map"
  | "normalMap"
  | "metalnessMap"
  | "roughnessMap"
  | "aoMap"
  | "emissiveMap";

type DeferredGltfTextureJob = {
  materialIndex: number;
  materialName: string | null;
  workerMaterialName: string;
  imageUri: string;
  slots: DeferredGltfTextureSlot[];
  colorSpace: "srgb" | "linear";
  sampler?: GltfSampler;
  transform?: GltfTextureTransform;
  texCoord?: number;
  emissiveFactor?: [number, number, number];
  normalScale?: number;
  occlusionStrength?: number;
  label: string;
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
  emissiveFactor?: [number, number, number];
  extensions?: Record<string, unknown>;
  doubleSided?: boolean;
};

export type GltfDocument = {
  asset?: { version?: string };
  buffers?: Array<{ uri?: string }>;
  images?: Array<{ uri?: string }>;
  textures?: Array<{ source?: number; sampler?: number }>;
  samplers?: GltfSampler[];
  materials?: GltfMaterial[];
};

type GltfSampler = {
  magFilter?: number;
  minFilter?: number;
  wrapS?: number;
  wrapT?: number;
};

const DEFERRED_GLTF_MATERIAL_NAME_PREFIX = "__yw_deferred_gltf_material__";
const DEFERRED_GLTF_TEXTURE_ASSIGNMENT_BATCH_SIZE = 4;

function deferredGltfMaterialName(index: number, name: string | null) {
  return `${DEFERRED_GLTF_MATERIAL_NAME_PREFIX}${index}:${name ?? ""}`;
}

function originalDeferredGltfMaterialName(name: string) {
  if (!name.startsWith(DEFERRED_GLTF_MATERIAL_NAME_PREFIX)) {
    return null;
  }
  const separatorIndex = name.indexOf(":");
  return separatorIndex >= 0 ? name.slice(separatorIndex + 1) : "";
}

function isExternalGltfUri(uri: string | undefined): uri is string {
  return (
    typeof uri === "string" &&
    uri.length > 0 &&
    !/^(data:|blob:|https?:)/i.test(uri)
  );
}

function getGltfTextureImageUri(
  json: GltfDocument,
  textureInfo: GltfTextureInfo | undefined,
) {
  if (
    !textureInfo ||
    typeof textureInfo.index !== "number" ||
    !json.textures?.[textureInfo.index]
  ) {
    return null;
  }

  const source = json.textures[textureInfo.index].source;
  if (typeof source !== "number") {
    return null;
  }

  const uri = json.images?.[source]?.uri;
  return isExternalGltfUri(uri) ? uri : null;
}

function collectDeferredGltfTextureJobs(
  json: GltfDocument,
): DeferredGltfTextureJob[] {
  const jobs: DeferredGltfTextureJob[] = [];
  for (const [materialIndex, material] of (json.materials ?? []).entries()) {
    const materialName = material.name ?? null;
    const pushJob = (
      textureInfo: GltfTextureInfo | undefined,
      slots: DeferredGltfTextureSlot[],
      colorSpace: DeferredGltfTextureJob["colorSpace"],
      label: string,
      factors: Pick<
        DeferredGltfTextureJob,
        "emissiveFactor" | "normalScale" | "occlusionStrength"
      > = {},
    ) => {
      const imageUri = getGltfTextureImageUri(json, textureInfo);
      if (!imageUri || !textureInfo) {
        return;
      }
      const deferredTextureInfo = textureInfo;
      jobs.push({
        materialIndex,
        materialName,
        workerMaterialName: deferredGltfMaterialName(
          materialIndex,
          materialName,
        ),
        imageUri,
        slots,
        colorSpace,
        sampler:
          typeof deferredTextureInfo.index === "number"
            ? json.samplers?.[
                json.textures?.[deferredTextureInfo.index]?.sampler ?? -1
              ]
            : undefined,
        transform: deferredTextureInfo.extensions?.KHR_texture_transform,
        texCoord:
          deferredTextureInfo.extensions?.KHR_texture_transform?.texCoord ??
          deferredTextureInfo.texCoord,
        ...factors,
        label: materialName ? `${materialName} ${label}` : label,
      });
    };

    pushJob(
      material.pbrMetallicRoughness?.baseColorTexture,
      ["map"],
      "srgb",
      "base color",
    );
    pushJob(
      material.pbrMetallicRoughness?.metallicRoughnessTexture,
      ["metalnessMap", "roughnessMap"],
      "linear",
      "metallic roughness",
    );
    pushJob(material.normalTexture, ["normalMap"], "linear", "normal", {
      normalScale: material.normalTexture?.scale,
    });
    pushJob(material.occlusionTexture, ["aoMap"], "linear", "occlusion", {
      occlusionStrength: material.occlusionTexture?.strength,
    });
    pushJob(material.emissiveTexture, ["emissiveMap"], "srgb", "emissive", {
      emissiveFactor: material.emissiveFactor,
    });
  }
  return jobs;
}

function createWorkerGltfTextWithoutTextures(json: GltfDocument) {
  const workerJson = structuredClone(json);
  for (const [index, sourceMaterial] of (json.materials ?? []).entries()) {
    const workerMaterial = workerJson.materials?.[index];
    if (!workerMaterial) {
      continue;
    }
    workerMaterial.name = deferredGltfMaterialName(
      index,
      sourceMaterial.name ?? null,
    );

    if (
      getGltfTextureImageUri(
        json,
        sourceMaterial.pbrMetallicRoughness?.baseColorTexture,
      )
    ) {
      delete workerMaterial.pbrMetallicRoughness?.baseColorTexture;
    }
    if (
      getGltfTextureImageUri(
        json,
        sourceMaterial.pbrMetallicRoughness?.metallicRoughnessTexture,
      )
    ) {
      delete workerMaterial.pbrMetallicRoughness?.metallicRoughnessTexture;
    }
    if (getGltfTextureImageUri(json, sourceMaterial.normalTexture)) {
      delete workerMaterial.normalTexture;
    }
    if (getGltfTextureImageUri(json, sourceMaterial.occlusionTexture)) {
      delete workerMaterial.occlusionTexture;
    }
    if (getGltfTextureImageUri(json, sourceMaterial.emissiveTexture)) {
      delete workerMaterial.emissiveTexture;
    }
  }
  return JSON.stringify(workerJson);
}

type GltfDeferredMaterial = Material &
  Partial<Record<DeferredGltfTextureSlot, Texture | null>>;

function collectDeferredGltfMaterials(object: LoadedPreview["object"]) {
  const materials: GltfDeferredMaterial[] = [];
  const seen = new Set<Material>();
  object.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }
    const meshMaterials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of meshMaterials) {
      if (seen.has(material)) {
        continue;
      }
      seen.add(material);
      materials.push(material as GltfDeferredMaterial);
    }
  });
  return materials;
}

function applyGltfSampler(texture: Texture, sampler: GltfSampler | undefined) {
  if (!sampler) {
    return;
  }

  texture.wrapS =
    sampler.wrapS === 33071
      ? ClampToEdgeWrapping
      : sampler.wrapS === 33648
        ? MirroredRepeatWrapping
        : RepeatWrapping;
  texture.wrapT =
    sampler.wrapT === 33071
      ? ClampToEdgeWrapping
      : sampler.wrapT === 33648
        ? MirroredRepeatWrapping
        : RepeatWrapping;

  if (sampler.magFilter === 9728) {
    texture.magFilter = NearestFilter;
  } else if (sampler.magFilter === 9729) {
    texture.magFilter = LinearFilter;
  }

  switch (sampler.minFilter) {
    case 9728:
      texture.minFilter = NearestFilter;
      break;
    case 9729:
      texture.minFilter = LinearFilter;
      break;
    case 9984:
      texture.minFilter = NearestMipmapNearestFilter;
      break;
    case 9985:
      texture.minFilter = LinearMipmapNearestFilter;
      break;
    case 9986:
      texture.minFilter = NearestMipmapLinearFilter;
      break;
    case 9987:
      texture.minFilter = LinearMipmapLinearFilter;
      break;
  }
}

function applyGltfTextureTransform(
  texture: Texture,
  transform: GltfTextureTransform | undefined,
) {
  if (!transform) {
    return;
  }
  if (transform.offset) {
    texture.offset.set(transform.offset[0], transform.offset[1]);
  }
  if (transform.scale) {
    texture.repeat.set(transform.scale[0], transform.scale[1]);
  }
  if (typeof transform.rotation === "number") {
    texture.rotation = transform.rotation;
  }
}

function applyDeferredGltfMaterialFactors(
  material: GltfDeferredMaterial,
  job: DeferredGltfTextureJob,
) {
  const materialRecord = material as unknown as {
    emissive?: { setRGB: (r: number, g: number, b: number) => void };
    normalScale?: { set: (x: number, y: number) => void };
    aoMapIntensity?: number;
  };

  if (job.emissiveFactor && materialRecord.emissive) {
    materialRecord.emissive.setRGB(
      job.emissiveFactor[0],
      job.emissiveFactor[1],
      job.emissiveFactor[2],
    );
  }
  if (typeof job.normalScale === "number" && materialRecord.normalScale) {
    materialRecord.normalScale.set(job.normalScale, job.normalScale);
  }
  if (typeof job.occlusionStrength === "number") {
    materialRecord.aoMapIntensity = job.occlusionStrength;
  }
}

function installDeferredGltfTextures(
  object: LoadedPreview["object"],
  jobs: readonly DeferredGltfTextureJob[],
  resourceUrls: Record<string, string>,
  context: LoaderContext,
) {
  if (jobs.length === 0) {
    return [];
  }

  const loader = new TextureLoader();
  const materials = collectDeferredGltfMaterials(object);
  const materialsByWorkerName = new Map<string, GltfDeferredMaterial>();
  for (const material of materials) {
    if (
      material.name.startsWith(DEFERRED_GLTF_MATERIAL_NAME_PREFIX) &&
      !materialsByWorkerName.has(material.name)
    ) {
      materialsByWorkerName.set(material.name, material);
    }
  }
  for (const [workerName, material] of materialsByWorkerName) {
    material.name = originalDeferredGltfMaterialName(workerName) ?? "";
  }

  const jobsByImageUri = new Map<string, DeferredGltfTextureJob[]>();
  for (const job of jobs) {
    const uriJobs = jobsByImageUri.get(job.imageUri);
    if (uriJobs) {
      uriJobs.push(job);
    } else {
      jobsByImageUri.set(job.imageUri, [job]);
    }
  }
  const queue = [...jobsByImageUri.entries()].map(([imageUri, uriJobs]) => ({
    imageUri,
    jobs: uriJobs,
  }));
  const timeoutIds: Array<ReturnType<typeof setTimeout>> = [];
  const idleIds: number[] = [];
  const warnedImageUris = new Set<string>();
  let running = false;
  let cancelled = false;
  let loaded = 0;
  let failed = 0;
  let activeLabel: string | null = queue[0]?.jobs[0]?.label ?? null;
  let activeBaseTexture: Texture | null = null;

  const report = () => {
    const completed = loaded + failed;
    // Progress remains material-job based for compatibility even though one
    // shared image decode fans out across bounded assignment batches.
    context.onDeferredTexture?.({
      kind: "texture",
      total: jobs.length,
      loaded,
      failed,
      pending: Math.max(0, jobs.length - completed),
      activeLabel,
    });
  };

  const resolveMaterial = (job: DeferredGltfTextureJob) =>
    materialsByWorkerName.get(job.workerMaterialName) ?? null;

  const assignTexture = (
    material: GltfDeferredMaterial,
    job: DeferredGltfTextureJob,
    texture: Texture,
  ) => {
    texture.name = job.imageUri;
    texture.flipY = false;
    if (job.colorSpace === "srgb") {
      texture.colorSpace = SRGBColorSpace;
    }
    applyGltfSampler(texture, job.sampler);
    applyGltfTextureTransform(texture, job.transform);
    if (typeof job.texCoord === "number" && "channel" in texture) {
      (texture as Texture & { channel: number }).channel = job.texCoord;
    }
    applyDeferredGltfMaterialFactors(material, job);
    for (const slot of job.slots) {
      material[slot] = texture;
    }
    material.needsUpdate = true;
  };

  const disposeActiveBaseTexture = () => {
    activeBaseTexture?.dispose();
    activeBaseTexture = null;
  };

  const scheduleIdle = (callback: () => void) => {
    if (cancelled) {
      return;
    }
    const globalWithIdle = globalThis as typeof globalThis & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
    };
    if (typeof globalWithIdle.requestIdleCallback === "function") {
      idleIds.push(
        globalWithIdle.requestIdleCallback(callback, { timeout: 500 }),
      );
    } else {
      timeoutIds.push(setTimeout(callback, 16));
    }
  };

  const finishActiveGroup = () => {
    disposeActiveBaseTexture();
    running = false;
    activeLabel = null;
    if (!cancelled) {
      report();
      scheduleNext();
    }
  };

  const runNext = () => {
    if (cancelled || running) {
      return;
    }
    const group = queue.shift();
    if (!group) {
      activeLabel = null;
      report();
      return;
    }

    running = true;
    activeLabel = group.jobs[0]?.label ?? group.imageUri;
    report();
    const url = resourceUrls[group.imageUri];
    const resolvedJobs = group.jobs.map((job) => ({
      job,
      material: resolveMaterial(job),
    }));
    if (!url || resolvedJobs.every(({ material }) => material === null)) {
      failed += group.jobs.length;
      finishActiveGroup();
      return;
    }

    void loader.loadAsync(url).then(
      (baseTexture) => {
        if (cancelled) {
          baseTexture.dispose();
          return;
        }
        activeBaseTexture = baseTexture;
        let jobIndex = 0;
        const assignNextBatch = () => {
          if (cancelled) {
            disposeActiveBaseTexture();
            return;
          }
          // Four jobs bounds each synchronous fan-out turn while letting the
          // common <=4-job image group complete immediately after decode.
          const batchEnd = Math.min(
            jobIndex + DEFERRED_GLTF_TEXTURE_ASSIGNMENT_BATCH_SIZE,
            resolvedJobs.length,
          );
          while (jobIndex < batchEnd) {
            const resolvedJob = resolvedJobs[jobIndex];
            jobIndex += 1;
            if (!resolvedJob) {
              continue;
            }
            const { job, material } = resolvedJob;
            if (!material) {
              failed += 1;
            } else {
              let texture: Texture | null = null;
              try {
                texture = baseTexture.clone();
                if (cancelled) {
                  texture.dispose();
                  disposeActiveBaseTexture();
                  return;
                }
                assignTexture(material, job, texture);
                loaded += 1;
              } catch {
                texture?.dispose();
                failed += 1;
              }
            }
          }
          activeLabel = resolvedJobs[jobIndex]?.job.label ?? null;
          report();
          if (cancelled) {
            disposeActiveBaseTexture();
            return;
          }
          if (jobIndex < resolvedJobs.length) {
            scheduleIdle(assignNextBatch);
          } else {
            finishActiveGroup();
          }
        };
        assignNextBatch();
      },
      () => {
        if (cancelled) {
          return;
        }
        failed += group.jobs.length;
        if (!warnedImageUris.has(group.imageUri)) {
          warnedImageUris.add(group.imageUri);
          context.onWarning?.(
            formatMissingTextureWarnings([group.imageUri])[0],
          );
        }
        finishActiveGroup();
      },
    );
  };

  const scheduleNext = () => {
    if (cancelled || running || queue.length === 0) {
      return;
    }
    scheduleIdle(runNext);
  };

  report();
  scheduleNext();

  return [
    () => {
      cancelled = true;
      queue.length = 0;
      disposeActiveBaseTexture();
      running = false;
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
    },
  ];
}

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
      try {
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
              text: materialized.workerText,
              resourceUrls: materialized.resourceUrls,
              ...(materialized.deferredTextureJobs.length > 0
                ? { preferObjectJson: true }
                : {}),
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
        const cleanupCallbacks = parsedInWorker
          ? installDeferredGltfTextures(
              object,
              materialized.deferredTextureJobs,
              materialized.resourceUrls,
              context,
            )
          : [];
        return {
          object,
          cleanupUrls: materialized.cleanupUrls,
          cleanupCallbacks,
          clips: object.animations ?? [],
          formatVersion: materialized.formatVersion,
          warnings: materialized.warnings,
        };
      } catch (error) {
        for (const url of materialized.cleanupUrls) {
          URL.revokeObjectURL(url);
        }
        throw error;
      }
    }
    default:
      throw new Error(
        `Preview loader is not implemented for .${file.extension}`,
      );
  }
}
