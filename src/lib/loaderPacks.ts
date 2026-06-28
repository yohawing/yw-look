import { invoke } from "@tauri-apps/api/core";

import type { OptionalLoaderPackManifest } from "../types/ipc";

export type { OptionalLoaderPackManifest } from "../types/ipc";

export async function loadOptionalLoaderManifests() {
  return invoke<OptionalLoaderPackManifest[]>("load_optional_loader_manifests");
}

export async function installOptionalLoaderPack(packId: string) {
  return invoke<OptionalLoaderPackManifest[]>("install_optional_loader_pack", {
    packId,
  });
}

export async function removeOptionalLoaderPack(packId: string) {
  return invoke<OptionalLoaderPackManifest[]>("remove_optional_loader_pack", {
    packId,
  });
}
