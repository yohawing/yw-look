import { invoke } from "@tauri-apps/api/core";

export type RecentFileEntry = {
  path: string;
  kind: string;
  lastAccessedAt: string;
};

export type RecentFilesPayload = {
  recentFilesPath: string;
  entries: RecentFileEntry[];
};

export async function loadRecentFiles() {
  return invoke<RecentFilesPayload>("load_recent_files");
}
