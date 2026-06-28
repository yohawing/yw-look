import {
  DirectionalLight,
  Group,
  type Material,
  type Mesh,
  type Object3D,
} from "three";
import type { SelectedFile } from "../../lib/files";
import { readBinaryFile } from "../../lib/files";
import type { MmdAssetMetadata } from "../../components/assetMetadata";
import type { LoaderContext } from "../loaderRegistry";
import { MMD_EXAMPLE_LIGHTING_PRESET } from "../lighting";
import { MMD_PREVIEW_RENDERING_PRESET } from "../rendering";
import { setSelectionProxyTarget } from "../selectionProxy";
import type {
  LoadedMmdMotion,
  LoadedPreview,
  MmdRuntimeModelHandle,
} from "../types";
import { MMD_MODEL_KEY, syncMmdMaterialRenderStates } from "./userData";
import MMD_ANIM_WASM_URL from "virtual:yw-look-mmd-wasm-url";

const MMD_FRAME_RATE = 30;

type MmdTextureDiagnostic = {
  code: string;
  path: string;
};

type MmdLocalAxisTuple = [number, number, number];

type ParsedMmdModelBone = {
  localAxis?: {
    x: MmdLocalAxisTuple;
    z: MmdLocalAxisTuple;
  };
};

type ParsedMmdModel = {
  skeleton(): {
    bones: ParsedMmdModelBone[];
  };
  dispose?(): void;
};

type MmdParserCore = {
  loadModel(buffer: ArrayBuffer | Uint8Array): ParsedMmdModel;
};

type ThreeMmdLoaderModule = {
  ThreeMmdLoader: new (options: {
    geometryAwareAlpha: boolean;
    runtime: unknown;
    textureResolver: {
      resolve(texturePath: string): Promise<string | Blob | undefined>;
    };
  }) => {
    loadModel(
      buffer: ArrayBuffer,
      options: {
        outline: boolean;
        materialRenderOrder: boolean;
        frustumCulled: boolean;
      },
    ): Promise<
      MmdRuntimeModelHandle & {
        root?: Object3D;
        outlineMeshes?: Object3D[];
        renderOrderMeshes?: Object3D[];
        diagnostics: {
          textures: MmdTextureDiagnostic[];
        };
      }
    >;
  };
  parsePmdMetadata(buffer: ArrayBuffer): ParsedMmdMetadata;
  parsePmdSectionInventory(buffer: ArrayBuffer): ParsedMmdInventory;
  parsePmxMetadata(buffer: ArrayBuffer): ParsedMmdMetadata;
  parsePmxSectionInventory(buffer: ArrayBuffer): ParsedMmdInventory;
  parseVmd(buffer: ArrayBuffer): ParsedVmdAnimation;
  parseVmdMetadata(buffer: ArrayBuffer): ParsedVmdMetadata;
  parseVmdSectionInventory(buffer: ArrayBuffer): ParsedVmdInventory;
  initCore(options?: { wasmUrl?: string }): Promise<MmdParserCore>;
  syncMmdSpecularDirection(
    material: Material | Material[],
    light: DirectionalLight,
  ): void;
};

async function importThreeMmdLoader(): Promise<ThreeMmdLoaderModule> {
  return (await import("@yohawing/three-mmd-loader")) as ThreeMmdLoaderModule;
}

export async function syncMmdPreviewSpecularDirection(
  mmd: MmdRuntimeModelHandle | null | undefined,
  light: DirectionalLight | null,
) {
  if (!mmd || !light) {
    return;
  }

  const { syncMmdSpecularDirection } = await importThreeMmdLoader();
  const proxyModel = mmd as MmdRuntimeModelHandle & {
    root?: Object3D;
    outlineMeshes?: Object3D[];
    renderOrderMeshes?: Object3D[];
  };
  if (proxyModel.root) {
    syncMmdSpecularDirectionForObject(
      proxyModel.root,
      light,
      syncMmdSpecularDirection,
    );
    return;
  }

  syncMmdSpecularDirectionForObject(
    proxyModel.mesh,
    light,
    syncMmdSpecularDirection,
  );
  for (const proxy of [
    ...(proxyModel.renderOrderMeshes ?? []),
    ...(proxyModel.outlineMeshes ?? []),
  ]) {
    syncMmdSpecularDirectionForObject(proxy, light, syncMmdSpecularDirection);
  }
}

function syncMmdSpecularDirectionForObject(
  object: Object3D,
  light: DirectionalLight,
  sync: (material: Material | Material[], light: DirectionalLight) => void,
) {
  object.traverse((child) => {
    const material = (child as Partial<Mesh>).material;
    if (material) {
      sync(material, light);
    }
  });
}

type ParsedMmdMetadata = {
  format: "pmx" | "pmd";
  header: {
    version: number;
    encoding?: string;
    additionalUvCount?: number;
    indexSizes?: object;
  };
  encoding?: string;
  name: string;
  englishName: string;
  comment?: string;
  englishComment?: string;
  counts: object;
  trailingBytes?: number;
};

type ParsedMmdInventory = {
  trailingBytes?: number;
  sections: Array<{
    name: string;
    count: number;
    offset: number;
    byteLength: number;
  }>;
};

type ParsedVmdMetadata = {
  format: "vmd";
  signature: string;
  encoding: "shift-jis";
  modelName: string;
  counts: {
    bones: number;
    morphs: number;
    cameras: number;
    lights: number;
    selfShadows: number;
    properties: number;
  };
  trailingBytes: number;
};

type ParsedVmdInventory = ParsedVmdMetadata & {
  sections: Array<{
    name: string;
    count: number;
    countOffset: number;
    dataOffset: number;
    byteLength: number;
  }>;
};

type ParsedVmdAnimation = LoadedMmdMotion["animation"] & {
  metadata: LoadedMmdMotion["animation"]["metadata"] & {
    modelName?: string;
    counts?: ParsedVmdMetadata["counts"];
  };
  boneTracks: Record<string, unknown>;
  morphTracks: Record<string, unknown>;
  cameraFrames: unknown[];
  lightFrames: unknown[];
  selfShadowFrames: unknown[];
  propertyFrames: unknown[];
};

function normalizeMmdDiagnostics(
  value: unknown,
): MmdAssetMetadata["diagnostics"] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const level = record.level === "error" ? "error" : "warning";
    const code = typeof record.code === "string" ? record.code : "UNKNOWN";
    const message =
      typeof record.message === "string" ? record.message : "No message.";
    const key = `${level}\0${code}\0${message}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ level, code, message }];
  });
}

function normalizeNumberRecord(
  value: object | undefined,
): Record<string, number> | null {
  if (!value) return null;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function buildMmdAssetMetadata(
  metadata: ParsedMmdMetadata,
  inventory: ParsedMmdInventory,
  diagnostics: unknown,
): MmdAssetMetadata {
  return {
    format: metadata.format,
    version: metadata.header.version,
    encoding: metadata.header.encoding ?? metadata.encoding ?? null,
    name: metadata.name,
    englishName: metadata.englishName,
    comment: metadata.comment ?? "",
    englishComment: metadata.englishComment ?? "",
    counts: normalizeNumberRecord(metadata.counts) ?? {},
    additionalUvCount: metadata.header.additionalUvCount ?? null,
    indexSizes: normalizeNumberRecord(metadata.header.indexSizes),
    trailingBytes: inventory.trailingBytes ?? metadata.trailingBytes ?? 0,
    sections: inventory.sections.map((section) => ({ ...section })),
    diagnostics: normalizeMmdDiagnostics(diagnostics),
  };
}

function buildVmdAssetMetadata(
  metadata: ParsedVmdMetadata,
  inventory: ParsedVmdInventory,
  animation: ParsedVmdAnimation,
): MmdAssetMetadata {
  return {
    format: "vmd",
    version: null,
    encoding: metadata.encoding,
    name: metadata.modelName,
    englishName: "",
    comment: "",
    englishComment: "",
    counts: {
      maxFrame: animation.metadata.maxFrame ?? 0,
      boneTracks: Object.keys(animation.boneTracks ?? {}).length,
      morphTracks: Object.keys(animation.morphTracks ?? {}).length,
      boneKeyframes: metadata.counts.bones,
      morphKeyframes: metadata.counts.morphs,
      cameraKeyframes: metadata.counts.cameras,
      lightKeyframes: metadata.counts.lights,
      selfShadowKeyframes: metadata.counts.selfShadows,
      propertyKeyframes: metadata.counts.properties,
    },
    additionalUvCount: null,
    indexSizes: null,
    trailingBytes: metadata.trailingBytes,
    sections: inventory.sections.map((section) => ({
      name: section.name,
      count: section.count,
      offset: section.dataOffset,
      byteLength: section.byteLength,
    })),
    diagnostics: [],
  };
}

async function readArrayBuffer(path: string) {
  return readBinaryFile(path);
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
    if (segment === ".") continue;
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

function stripUrlSuffix(value: string) {
  return value.replace(/\\/g, "/").split(/[?#]/, 1)[0];
}

function isRemoteOrInlineUrl(value: string) {
  return /^(data:|blob:|https?:|asset:)/i.test(value);
}

function decodeResourcePath(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function toPlatformLocalPath(path: string, baseDirectory: string) {
  if (/^[a-zA-Z]:[\\/]/.test(baseDirectory)) {
    return path.replace(/\//g, "\\");
  }
  return path;
}

function resolveMmdResourcePath(url: string, file: SelectedFile) {
  const stripped = stripUrlSuffix(decodeResourcePath(url));
  if (/^[a-zA-Z]:[\\/]/.test(stripped) || stripped.startsWith("/")) {
    return toPlatformLocalPath(stripped, file.parentDirectory);
  }
  return resolveSiblingPath(file.parentDirectory, stripped);
}

const mmdBuiltInToonTextureUrls = Object.fromEntries(
  Array.from({ length: 10 }, (_, index) => {
    const fileName = `toon${String(index + 1).padStart(2, "0")}.bmp`;
    return [
      fileName,
      new URL(
        `../../../node_modules/@yohawing/three-mmd-loader/dist/three/assets/mmd/${fileName}`,
        import.meta.url,
      ).toString(),
    ];
  }),
) as Record<string, string>;

function resolveMmdBuiltInToonTextureUrl(texturePath: string) {
  const normalized = stripUrlSuffix(decodeResourcePath(texturePath))
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .toLowerCase();
  if (normalized.includes("/")) {
    return undefined;
  }
  return mmdBuiltInToonTextureUrls[normalized];
}

async function readTextureBlobFromPath(path: string) {
  const extension =
    stripUrlSuffix(path).split(".").pop()?.toLowerCase() ?? "bin";
  const buffer = await readArrayBuffer(path);
  return new Blob([buffer], { type: getMimeType(extension) });
}

function readCachedTextureBlobFromPath(
  path: string,
  cache: Map<string, Promise<Blob | null>>,
) {
  const cached = cache.get(path);
  if (cached) {
    return cached;
  }

  const promise = readTextureBlobFromPath(path).catch(() => null);
  cache.set(path, promise);
  return promise;
}

async function resolveMmdLocalTextureBlob(
  texturePath: string,
  file: SelectedFile,
  cache: Map<string, Promise<Blob | null>>,
) {
  const candidates = texturePath
    .split("*")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    const blob = await readCachedTextureBlobFromPath(
      resolveMmdResourcePath(candidate, file),
      cache,
    );
    if (blob) {
      return blob;
    }
  }

  return null;
}

function formatMmdResourceDisplayPath(url: string) {
  if (isRemoteOrInlineUrl(url)) {
    return url;
  }
  return url
    .split("*")
    .map((entry) => {
      const stripped = stripUrlSuffix(entry.trim());
      if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(stripped)) {
        return (
          stripped.split(/[\\/]/).filter(Boolean).at(-1) ?? "external asset"
        );
      }
      return entry.trim();
    })
    .filter(Boolean)
    .join("*");
}

function formatMissingMmdResourceWarning(path: string) {
  return `Missing MMD external asset: ${path}. The model was loaded with a fallback or incomplete material.`;
}

function formatUnsupportedMmdSphereMapWarning(path: string) {
  return `Unsupported MMD sphere texture: ${path}. The model was loaded without this sphere map.`;
}

async function createMmdRuntimeOptions() {
  return {
    runtime: {
      frameRate: MMD_FRAME_RATE,
      physics: "none" as const,
    },
    cleanup: null,
  };
}

function isNumberTuple3(value: unknown): value is MmdLocalAxisTuple {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (component) =>
        typeof component === "number" && Number.isFinite(component),
    )
  );
}

function attachParsedLocalAxisToBones(
  mmd: MmdRuntimeModelHandle,
  parsedBones: ParsedMmdModelBone[],
) {
  const skeletonBones = (
    mmd.mesh as Object3D & {
      skeleton?: { bones?: Object3D[] };
    }
  ).skeleton?.bones;
  if (!Array.isArray(skeletonBones)) {
    return 0;
  }

  let attached = 0;
  for (let index = 0; index < skeletonBones.length; index += 1) {
    const localAxis = parsedBones[index]?.localAxis;
    if (!localAxis) {
      continue;
    }
    if (!isNumberTuple3(localAxis.x) || !isNumberTuple3(localAxis.z)) {
      continue;
    }
    const bone = skeletonBones[index];
    if (!bone) {
      continue;
    }
    bone.userData.mmdLocalAxis = {
      x: [...localAxis.x],
      z: [...localAxis.z],
    };
    attached += 1;
  }
  return attached;
}

async function attachPmxLocalAxes(
  buffer: ArrayBuffer,
  mmd: MmdRuntimeModelHandle,
  context: LoaderContext,
) {
  try {
    const { initCore } = await importThreeMmdLoader();
    const core = await initCore({ wasmUrl: MMD_ANIM_WASM_URL });
    let parsedModel: ParsedMmdModel | null = null;
    try {
      parsedModel = core.loadModel(buffer);
      attachParsedLocalAxisToBones(mmd, parsedModel.skeleton().bones);
    } finally {
      parsedModel?.dispose?.();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.onWarning?.(
      `PMX LocalAxis metadata could not be attached to joint axes: ${message}.`,
    );
  }
}

export async function loadMmdPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  reportStage("scan");

  try {
    const {
      ThreeMmdLoader,
      parsePmdMetadata,
      parsePmdSectionInventory,
      parsePmxMetadata,
      parsePmxSectionInventory,
    } = await importThreeMmdLoader();

    const buffer = await readArrayBuffer(file.path);
    const metadata =
      file.extension === "pmx"
        ? parsePmxMetadata(buffer)
        : parsePmdMetadata(buffer);
    const inventory =
      file.extension === "pmx"
        ? parsePmxSectionInventory(buffer)
        : parsePmdSectionInventory(buffer);
    const textureBlobCache = new Map<string, Promise<Blob | null>>();
    const runtimeOptions = await createMmdRuntimeOptions();
    const loader = new ThreeMmdLoader({
      geometryAwareAlpha: true,
      runtime: runtimeOptions.runtime,
      textureResolver: {
        async resolve(texturePath) {
          if (isRemoteOrInlineUrl(texturePath)) {
            return texturePath;
          }
          const builtInToonTextureUrl =
            resolveMmdBuiltInToonTextureUrl(texturePath);
          if (builtInToonTextureUrl) {
            return (
              (await resolveMmdLocalTextureBlob(
                texturePath,
                file,
                textureBlobCache,
              )) ?? builtInToonTextureUrl
            );
          }
          return (
            (await resolveMmdLocalTextureBlob(
              texturePath,
              file,
              textureBlobCache,
            )) ?? undefined
          );
        },
      },
    });

    reportStage("decode");
    const mmd = await loader.loadModel(buffer, {
      outline: true,
      materialRenderOrder: true,
      frustumCulled: false,
    });
    if (mmd.root) {
      syncMmdMaterialRenderStates(mmd.root);
    } else {
      syncMmdMaterialRenderStates(mmd.mesh);
      for (const proxy of [
        ...(mmd.outlineMeshes ?? []),
        ...(mmd.renderOrderMeshes ?? []),
      ]) {
        syncMmdMaterialRenderStates(proxy);
      }
    }
    if (file.extension === "pmx") {
      await attachPmxLocalAxes(buffer, mmd, context);
    }
    reportStage("scene");

    const displayName = metadata.englishName || metadata.name || file.fileName;
    const object = new Group();
    object.name = `${displayName} Preview`;
    object.userData[MMD_MODEL_KEY] = mmd;
    object.userData.mmdSourceFile = file.path;
    if (mmd.root) {
      mmd.root.name = displayName;
      mmd.root.userData[MMD_MODEL_KEY] = mmd;
      mmd.root.userData.mmdSourceFile = file.path;
    }
    mmd.mesh.name = displayName;
    mmd.mesh.userData[MMD_MODEL_KEY] = mmd;
    mmd.mesh.userData.mmdSourceFile = file.path;
    for (const proxy of [
      ...(mmd.outlineMeshes ?? []),
      ...(mmd.renderOrderMeshes ?? []),
    ]) {
      setSelectionProxyTarget(proxy, mmd.mesh);
    }
    if (mmd.root) {
      object.add(mmd.root);
    } else {
      object.add(
        mmd.mesh,
        ...(mmd.outlineMeshes ?? []),
        ...(mmd.renderOrderMeshes ?? []),
      );
    }

    const warnings = [
      ...new Map(
        mmd.diagnostics.textures.map((diagnostic) => {
          const path = formatMmdResourceDisplayPath(diagnostic.path);
          const warning =
            diagnostic.code === "SPHERE_MAP_NOT_SUPPORTED"
              ? formatUnsupportedMmdSphereMapWarning(path)
              : formatMissingMmdResourceWarning(path);
          return [`${diagnostic.code}:${path}`, warning] as const;
        }),
      ).values(),
    ];
    for (const warning of warnings) {
      context.onWarning?.(warning);
    }

    return {
      object,
      cleanupCallbacks: runtimeOptions.cleanup ? [runtimeOptions.cleanup] : [],
      cleanupUrls: [],
      clips: [],
      formatVersion: `${metadata.format.toUpperCase()} ${metadata.header.version}`,
      lighting: MMD_EXAMPLE_LIGHTING_PRESET,
      rendering: MMD_PREVIEW_RENDERING_PRESET,
      skipScaleNormalization: true,
      mmdMetadata: buildMmdAssetMetadata(
        metadata,
        inventory,
        (mmd.mesh.userData.mmdModel as { diagnostics?: unknown } | undefined)
          ?.diagnostics,
      ),
      mmdModel: mmd as MmdRuntimeModelHandle,
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load MMD preview: ${message}`, { cause: error });
  }
}

export async function loadMmdMotionPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  reportStage("scan");

  try {
    const { parseVmd, parseVmdMetadata, parseVmdSectionInventory } =
      await importThreeMmdLoader();
    const buffer = await readArrayBuffer(file.path);

    reportStage("decode");
    const animation = parseVmd(buffer);
    const metadata = parseVmdMetadata(buffer);
    const inventory = parseVmdSectionInventory(buffer);

    reportStage("scene");
    const object = new Group();
    object.name = `${metadata.modelName || file.fileName} Motion Preview`;
    object.userData.disableAutoFrame = true;
    object.userData.mmdSourceFile = file.path;
    object.userData.mmdMotionSourceFile = file.path;

    return {
      object,
      cleanupUrls: [],
      clips: [],
      formatVersion: "VMD",
      skipScaleNormalization: true,
      mmdMetadata: buildVmdAssetMetadata(metadata, inventory, animation),
      assetKind: "motion",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load MMD motion preview: ${message}`, {
      cause: error,
    });
  }
}

export async function loadMmdMotion(
  file: SelectedFile,
): Promise<LoadedMmdMotion> {
  try {
    const { parseVmd } = await importThreeMmdLoader();
    const buffer = await readArrayBuffer(file.path);
    const animation = parseVmd(buffer);
    const duration = Math.max(
      (animation.metadata?.maxFrame ?? 0) / MMD_FRAME_RATE,
      0,
    );
    return {
      animation,
      duration,
      label: file.fileName,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load MMD motion: ${message}`, { cause: error });
  }
}
