import { invoke } from "@tauri-apps/api/core";
import type { FileAssociationSyncResult } from "../types/ipc";

export type { FileAssociationSyncResult } from "../types/ipc";

export async function syncFileAssociations() {
  return invoke<FileAssociationSyncResult>("sync_file_associations");
}

export async function openDefaultAppsSettings() {
  return invoke<FileAssociationSyncResult>("open_default_apps_settings");
}
