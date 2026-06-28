import { invoke } from "@tauri-apps/api/core";

import type { OptionalLoaderPackManifest } from "../types/ipc";

export type { OptionalLoaderPackManifest } from "../types/ipc";

export async function loadOptionalLoaderManifests() {
  return invoke<OptionalLoaderPackManifest[]>("load_optional_loader_manifests");
}
