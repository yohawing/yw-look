import { invoke } from "@tauri-apps/api/core";

export type AppSettings = {
  version: number;
  recentFilesLimit: number;
  diagnosticsLogLevel: string;
  fileAssociationsEnabled: boolean;
  updateEndpointOverride?: string | null;
  updatePublicKeyOverride?: string | null;
  allowInsecureUpdateEndpoint: boolean;
  /**
   * #26: when `true`, App.tsx fires a single `check_for_update` call
   * during deferred startup so a pending build is surfaced without the
   * user opening the Updates card. The Rust backend defaults this to
   * `false`; existing on-disk settings files predate the field and
   * fall through `serde(default)` to the same `false`.
   */
  autoCheckForUpdates: boolean;
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
