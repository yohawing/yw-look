import { invoke } from "@tauri-apps/api/core";

export type AssetKind = "model" | "texture" | "unknown";

export type SelectedFile = {
  path: string;
  fileName: string;
  extension: string;
  kind: AssetKind;
  parentDirectory: string;
};

export type DirectoryListing = {
  files: SelectedFile[];
  currentIndex: number | null;
};

export async function openFileDialog() {
  return invoke<SelectedFile | null>("open_file_dialog");
}

export async function resolveSelectedFile(path: string) {
  return invoke<SelectedFile>("resolve_selected_file", { path });
}

export async function listSupportedSiblings(path: string) {
  return invoke<DirectoryListing>("list_supported_siblings", { path });
}

export async function readBinaryFile(path: string) {
  return invoke<number[]>("read_binary_file", { path });
}

export async function getStartupFile() {
  return invoke<SelectedFile | null>("get_startup_file");
}

export type ImageDimensions = {
  width: number;
  height: number;
  source: string;
};

export type AssetInspection = {
  path: string;
  fileName: string;
  extension: string;
  kind: AssetKind;
  fileSizeBytes: number;
  modifiedAt: string | null;
  createdAt: string | null;
  previewImplemented: boolean;
  imageDimensions: ImageDimensions | null;
};

export async function inspectAsset(path: string) {
  return invoke<AssetInspection>("inspect_asset", { path });
}

export type FormatSupport = {
  modelExtensions: string[];
  textureExtensions: string[];
  previewImplemented: string[];
};

export async function loadFormatSupport() {
  return invoke<FormatSupport>("load_format_support");
}
