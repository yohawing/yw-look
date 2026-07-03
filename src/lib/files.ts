import { invokeSafe } from "./invokeSafe";
import { isTauriEnvironment } from "./platform";

import type {
  AssetKind,
  SelectedFile,
  AssetInspection,
  FormatSupport,
  DirectoryListing,
} from "../types/file";

export type {
  AssetKind,
  SelectedFile,
  DirectoryListing,
  ImageDimensions,
  AssetInspection,
  FormatSupport,
} from "../types/file";

const USD_EXTENSIONS = new Set(["usd", "usda", "usdc", "usdz"]);
const MODEL_EXTENSIONS = [
  "glb",
  "gltf",
  "fbx",
  "obj",
  "ply",
  "stl",
  "usd",
  "usda",
  "usdc",
  "usdz",
  "dae",
  "vrm",
  "abc",
  "pmx",
  "pmd",
  "splat",
  "spz",
  "ksplat",
  "sog",
];
const TEXTURE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "tga",
  "dds",
  "ktx2",
  "hdr",
  "exr",
];
const MOTION_EXTENSIONS = ["vmd"];
const SUPPORTED_EXTENSIONS = new Set([
  ...MODEL_EXTENSIONS,
  ...TEXTURE_EXTENSIONS,
  ...MOTION_EXTENSIONS,
]);
const BROWSER_LOCAL_PATH_PREFIX = "browser-local://";
const browserFiles = new Map<string, File>();

async function invokeFile<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const result = await invokeSafe<T>(cmd, args);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

export function isUsdFile(file: SelectedFile | null): boolean {
  return !!file && USD_EXTENSIONS.has(file.extension);
}

function extensionFromFileName(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : "";
}

function inferAssetKind(extension: string): AssetKind {
  if (TEXTURE_EXTENSIONS.includes(extension)) return "texture";
  if (MOTION_EXTENSIONS.includes(extension)) return "motion";
  if (MODEL_EXTENSIONS.includes(extension)) return "model";
  return "unknown";
}

function getBrowserFile(path: string) {
  if (!path.startsWith(BROWSER_LOCAL_PATH_PREFIX)) return null;
  return browserFiles.get(path) ?? null;
}

export function registerBrowserFile(file: File): SelectedFile {
  const extension = extensionFromFileName(file.name);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`unsupported file extension: ${extension}`);
  }

  const path = `${BROWSER_LOCAL_PATH_PREFIX}${crypto.randomUUID()}/${encodeURIComponent(
    file.name,
  )}`;
  browserFiles.set(path, file);
  return {
    path,
    fileName: file.name,
    extension,
    kind: inferAssetKind(extension),
    parentDirectory: BROWSER_LOCAL_PATH_PREFIX,
  };
}

function openBrowserFileDialog() {
  return new Promise<SelectedFile | null>((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = Array.from(SUPPORTED_EXTENSIONS)
      .map((extension) => `.${extension}`)
      .join(",");
    input.style.display = "none";
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0] ?? null;
        input.remove();
        try {
          resolve(file ? registerBrowserFile(file) : null);
        } catch (error) {
          reject(error);
        }
      },
      { once: true },
    );
    input.addEventListener(
      "cancel",
      () => {
        input.remove();
        resolve(null);
      },
      { once: true },
    );
    document.body.append(input);
    input.click();
  });
}

export async function openFileDialog() {
  if (!isTauriEnvironment()) {
    return openBrowserFileDialog();
  }
  return invokeFile<SelectedFile | null>("open_file_dialog");
}

export async function resolveSelectedFile(path: string) {
  const browserFile = getBrowserFile(path);
  if (browserFile) {
    const extension = extensionFromFileName(browserFile.name);
    return {
      path,
      fileName: browserFile.name,
      extension,
      kind: inferAssetKind(extension),
      parentDirectory: BROWSER_LOCAL_PATH_PREFIX,
    };
  }
  return invokeFile<SelectedFile>("resolve_selected_file", { path });
}

export async function listSupportedSiblings(path: string) {
  const browserFile = getBrowserFile(path);
  if (browserFile) {
    const file = await resolveSelectedFile(path);
    return { files: [file], currentIndex: 0 };
  }
  return invokeFile<DirectoryListing>("list_supported_siblings", { path });
}

export async function readBinaryFile(path: string) {
  const browserFile = getBrowserFile(path);
  if (browserFile) {
    return browserFile.arrayBuffer();
  }
  // Backed by `tauri::ipc::Response`, so this resolves to a raw `ArrayBuffer`
  // (not a JSON number array) — essential for large assets like Gaussian
  // splats that would otherwise exhaust memory crossing the IPC boundary.
  return invokeFile<ArrayBuffer>("read_binary_file", { path });
}

export async function readBinaryFilePrefix(path: string, maxBytes: number) {
  const browserFile = getBrowserFile(path);
  if (browserFile) {
    return browserFile.slice(0, maxBytes).arrayBuffer();
  }
  return invokeFile<ArrayBuffer>("read_binary_file_prefix", { path, maxBytes });
}

export async function getStartupFile() {
  if (!isTauriEnvironment()) {
    return null;
  }
  return invokeFile<SelectedFile | null>("get_startup_file");
}

export async function inspectAsset(path: string) {
  const browserFile = getBrowserFile(path);
  if (browserFile) {
    const file = await resolveSelectedFile(path);
    return {
      path,
      fileName: file.fileName,
      extension: file.extension,
      kind: file.kind,
      fileSizeBytes: browserFile.size,
      modifiedAt: browserFile.lastModified
        ? String(Math.floor(browserFile.lastModified / 1000))
        : null,
      createdAt: null,
      previewImplemented: true,
      imageDimensions: null,
    };
  }
  return invokeFile<AssetInspection>("inspect_asset", { path });
}

export async function loadFormatSupport() {
  if (!isTauriEnvironment()) {
    return {
      modelExtensions: MODEL_EXTENSIONS,
      textureExtensions: TEXTURE_EXTENSIONS,
      motionExtensions: MOTION_EXTENSIONS,
      previewImplemented: Array.from(SUPPORTED_EXTENSIONS),
    };
  }
  return invokeFile<FormatSupport>("load_format_support");
}
