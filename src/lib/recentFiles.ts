import { invoke } from "@tauri-apps/api/core";

import type { RecentFilesPayload } from "../types/file";

export type { RecentFileEntry, RecentFilesPayload } from "../types/file";

export async function loadRecentFiles() {
  return invoke<RecentFilesPayload>("load_recent_files");
}
