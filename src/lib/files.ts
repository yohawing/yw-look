import { invokeSafe } from "./invokeSafe";
import { isTauriEnvironment } from "./platform";

import formatSupport from "../formatSupport.json";

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

const MODEL_EXTENSIONS = formatSupport.model;
const TEXTURE_EXTENSIONS = formatSupport.texture;
const MOTION_EXTENSIONS = formatSupport.motion;
const USD_EXTENSIONS = new Set(
  MODEL_EXTENSIONS.filter((extension) =>
    ["usd", "usda", "usdc", "usdz"].includes(extension),
  ),
);
const SUPPORTED_EXTENSIONS = new Set([
  ...MODEL_EXTENSIONS,
  ...TEXTURE_EXTENSIONS,
  ...MOTION_EXTENSIONS,
]);
const BROWSER_LOCAL_PATH_PREFIX = "browser-local://";
const browserFiles = new Map<string, File>();

type BrowserFileInput = File | { file: File; relativePath: string };

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
  const selected = registerBrowserFiles([file])[0];
  if (!selected) {
    const extension = extensionFromFileName(file.name);
    throw new Error(`unsupported file extension: ${extension}`);
  }
  return selected;
}

function normalizeRelativeBrowserPath(path: string) {
  const parts = path
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..");
  return parts.join("/");
}

export function registerBrowserFiles(
  inputs: BrowserFileInput[],
): SelectedFile[] {
  const selectionId = crypto.randomUUID();
  return inputs.flatMap((input) => {
    const file = input instanceof File ? input : input.file;
    const relativePath = normalizeRelativeBrowserPath(
      input instanceof File
        ? file.webkitRelativePath || file.name
        : input.relativePath,
    );
    const extension = extensionFromFileName(file.name);
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      return [];
    }

    const path = `${BROWSER_LOCAL_PATH_PREFIX}${selectionId}/${relativePath}`;
    browserFiles.set(path, file);
    const parentPath = path.slice(0, path.lastIndexOf("/"));
    return [
      {
        path,
        fileName: file.name,
        extension,
        kind: inferAssetKind(extension),
        parentDirectory: parentPath,
      },
    ];
  });
}

function openBrowserFileDialog() {
  return new Promise<SelectedFile[] | null>((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = Array.from(SUPPORTED_EXTENSIONS)
      .map((extension) => `.${extension}`)
      .join(",");
    input.style.display = "none";
    input.addEventListener(
      "change",
      () => {
        const files = Array.from(input.files ?? []);
        input.remove();
        try {
          resolve(files.length > 0 ? registerBrowserFiles(files) : null);
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
  return invokeFile<SelectedFile[] | null>("open_file_dialog");
}

export async function resolveSelectedFiles(paths: string[]) {
  return invokeFile<SelectedFile[]>("resolve_selected_files", { paths });
}

const USD_EXTENSION_PRIORITY = new Map([
  ["usd", 0],
  ["usda", 1],
  ["usdc", 2],
  ["usdz", 3],
]);

function pathParts(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean);
}

function commonPathDepth(files: SelectedFile[]) {
  const paths = files.map((file) => pathParts(file.path).slice(0, -1));
  const shortest = Math.min(...paths.map((parts) => parts.length));
  let depth = 0;
  while (
    depth < shortest &&
    paths.every(
      (parts) => parts[depth].toLowerCase() === paths[0][depth].toLowerCase(),
    )
  ) {
    depth += 1;
  }
  return depth;
}

export function selectPrimaryFile(files: SelectedFile[]) {
  const usdFiles = files.filter((file) => USD_EXTENSIONS.has(file.extension));
  if (usdFiles.length === 0) {
    return files[0] ?? null;
  }

  const commonDepth = commonPathDepth(files);
  return [...usdFiles].sort((left, right) => {
    const leftParts = pathParts(left.path);
    const rightParts = pathParts(right.path);
    const leftStem = left.fileName.slice(0, -(left.extension.length + 1));
    const rightStem = right.fileName.slice(0, -(right.extension.length + 1));
    const leftParent = leftParts.at(-2) ?? "";
    const rightParent = rightParts.at(-2) ?? "";
    const leftRank = [
      leftParts.length - 1 - commonDepth,
      leftStem.toLowerCase() === leftParent.toLowerCase() ? 0 : 1,
      USD_EXTENSION_PRIORITY.get(left.extension) ?? Number.MAX_SAFE_INTEGER,
    ];
    const rightRank = [
      rightParts.length - 1 - commonDepth,
      rightStem.toLowerCase() === rightParent.toLowerCase() ? 0 : 1,
      USD_EXTENSION_PRIORITY.get(right.extension) ?? Number.MAX_SAFE_INTEGER,
    ];

    for (let index = 0; index < leftRank.length; index += 1) {
      const difference = leftRank[index] - rightRank[index];
      if (difference !== 0) return difference;
    }
    const leftPath = left.path.toLowerCase();
    const rightPath = right.path.toLowerCase();
    if (leftPath < rightPath) return -1;
    if (leftPath > rightPath) return 1;
    return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
  })[0];
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
      parentDirectory: path.slice(0, path.lastIndexOf("/")),
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

export type DecodedPsdImage = {
  width: number;
  height: number;
  data: Uint8Array;
};

/**
 * Decode a PSD through the native Rust command.
 *
 * The command returns an 8-byte little-endian width/height header followed by
 * tightly packed RGBA8 pixels. Keeping this as a binary IPC boundary avoids
 * the JSON number-array expansion that is especially costly for 2048² PSDs.
 */
export async function decodePsdFile(path: string): Promise<DecodedPsdImage> {
  if (getBrowserFile(path)) {
    throw new Error("PSD decoding requires the desktop Rust decoder.");
  }

  const packet = await invokeFile<ArrayBuffer>("decode_psd", { path });
  if (packet.byteLength < 8) {
    throw new Error("PSD decoder returned a truncated image packet.");
  }

  const view = new DataView(packet);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  const pixelBytes = width * height * 4;
  if (
    !Number.isSafeInteger(pixelBytes) ||
    width === 0 ||
    height === 0 ||
    packet.byteLength !== 8 + pixelBytes
  ) {
    throw new Error(
      "PSD decoder returned invalid image dimensions or payload.",
    );
  }

  return {
    width,
    height,
    data: new Uint8Array(packet, 8, pixelBytes),
  };
}

export async function getStartupFiles() {
  if (!isTauriEnvironment()) {
    return [];
  }
  return invokeFile<SelectedFile[]>("get_startup_files");
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
      previewImplemented: formatSupport.previewImplemented.includes(
        file.extension,
      ),
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
      previewImplemented: formatSupport.previewImplemented,
    };
  }
  return invokeFile<FormatSupport>("load_format_support");
}
