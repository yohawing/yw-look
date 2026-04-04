import { invoke } from "@tauri-apps/api/core";

export type AppSettings = {
  version: number;
  recentFilesLimit: number;
  diagnosticsLogLevel: string;
  fileAssociationsEnabled: boolean;
  updateEndpointOverride?: string | null;
  updatePublicKeyOverride?: string | null;
  allowInsecureUpdateEndpoint: boolean;
};

export type SettingsPayload = {
  settingsPath: string;
  settings: AppSettings;
};

export async function loadSettings() {
  return invoke<SettingsPayload>("load_settings");
}

export async function saveSettings(settings: AppSettings) {
  return invoke<SettingsPayload>("save_settings", { settings });
}
