import { invoke } from "@tauri-apps/api/core";

import type { AppSettings, SettingsPayload } from "../types/ipc";

export type { AppSettings, SettingsPayload } from "../types/ipc";

export async function loadSettings() {
  return invoke<SettingsPayload>("load_settings");
}

export async function saveSettings(settings: AppSettings) {
  return invoke<SettingsPayload>("save_settings", { settings });
}
