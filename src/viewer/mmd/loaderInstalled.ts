import { Group, type Object3D } from "three";
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
import { MMD_MODEL_KEY } from "./userData";

const MMD_FRAME_RATE = 30;
const AMMO_SCRIPT_URL = new URL(
  "../../../node_modules/ammo.js/ammo.js",
  import.meta.url,
).href;

type MmdTextureDiagnostic = {
  code: string;
  path: string;
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
      options: { outlines: boolean; frustumCulled: boolean },
    ): Promise<
      MmdRuntimeModelHandle & {
        outlineMeshes?: Object3D[];
        renderOrderMeshes?: Object3D[];
        textureDiagnostics: MmdTextureDiagnostic[];
      }
    >;
  };
  parsePmdMetadata(buffer: ArrayBuffer): ParsedMmdMetadata;
  parsePmdSectionInventory(buffer: ArrayBuffer): ParsedMmdInventory;
  parsePmxMetadata(buffer: ArrayBuffer): ParsedMmdMetadata;
  parsePmxSectionInventory(buffer: ArrayBuffer): ParsedMmdInventory;
  parseVmd(buffer: ArrayBuffer): LoadedMmdMotion["animation"];
  createAmmoMmdPhysicsBackend(ammo: unknown): unknown;
  loadAmmoNamespace(url: string): Promise<unknown>;
};

async function importThreeMmdLoader(): Promise<ThreeMmdLoaderModule> {
  return (await import("@yohawing/three-mmd-loader")) as ThreeMmdLoaderModule;
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

function normalizeMmdDiagnostics(
  value: unknown,
): MmdAssetMetadata["diagnostics"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const level = record.level === "error" ? "error" : "warning";
    const code = typeof record.code === "string" ? record.code : "UNKNOWN";
    const message =
      typeof record.message === "string" ? record.message : "No message.";
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

async function readArrayBuffer(path: string) {
  const bytes = await readBinaryFile(path);
  return Uint8Array.from(bytes).buffer;
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

function formatMmdResourceDisplayPath(url: string, file: SelectedFile) {
  if (isRemoteOrInlineUrl(url)) {
    return url;
  }
  return resolveMmdResourcePath(url, file);
}

function formatMissingMmdResourceWarning(path: string) {
  return `Missing MMD external asset: ${path}. The model was loaded with a fallback or incomplete material.`;
}

function formatUnsupportedMmdSphereMapWarning(path: string) {
  return `Unsupported MMD sphere texture: ${path}. The model was loaded without this sphere map.`;
}

async function createMmdRuntimeOptions(context: LoaderContext) {
  try {
    const { createAmmoMmdPhysicsBackend, loadAmmoNamespace } =
      await importThreeMmdLoader();
    const ammo = await loadAmmoNamespace(AMMO_SCRIPT_URL);
    const physicsBackend = createAmmoMmdPhysicsBackend(ammo);

    return {
      runtime: {
        frameRate: MMD_FRAME_RATE,
        physics: "external" as const,
        physicsBackend,
      },
      cleanup: () => {
        const maybeDisposable = physicsBackend as { dispose?: () => void };
        maybeDisposable.dispose?.();
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.onWarning?.(
      `MMD physics could not start with Ammo.js: ${message}. Motion playback will continue without physics.`,
    );
    return {
      runtime: {
        frameRate: MMD_FRAME_RATE,
      },
      cleanup: null,
    };
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
    const runtimeOptions = await createMmdRuntimeOptions(context);
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
      outlines: true,
      frustumCulled: false,
    });
    reportStage("scene");

    const displayName = metadata.englishName || metadata.name || file.fileName;
    const object = new Group();
    object.name = `${displayName} Preview`;
    object.userData[MMD_MODEL_KEY] = mmd;
    object.userData.mmdSourceFile = file.path;
    mmd.mesh.name = displayName;
    mmd.mesh.userData[MMD_MODEL_KEY] = mmd;
    mmd.mesh.userData.mmdSourceFile = file.path;
    for (const proxy of [
      ...(mmd.outlineMeshes ?? []),
      ...(mmd.renderOrderMeshes ?? []),
    ]) {
      setSelectionProxyTarget(proxy, mmd.mesh);
    }
    object.add(
      mmd.mesh,
      ...(mmd.outlineMeshes ?? []),
      ...(mmd.renderOrderMeshes ?? []),
    );

    const warnings = [
      ...new Map(
        mmd.textureDiagnostics.map((diagnostic) => {
          const path = formatMmdResourceDisplayPath(diagnostic.path, file);
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
