import { invoke } from "@tauri-apps/api/core";

import type {
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

export function isUsdFile(file: SelectedFile | null): boolean {
  return !!file && USD_EXTENSIONS.has(file.extension);
}

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

export async function inspectAsset(path: string) {
  return invoke<AssetInspection>("inspect_asset", { path });
}

export async function loadFormatSupport() {
  return invoke<FormatSupport>("load_format_support");
}
