import { invoke } from "@tauri-apps/api/core";

export type UpdateConfigurationPayload = {
  currentVersion: string;
  defaultEndpoint?: string | null;
  defaultPubkeyAvailable: boolean;
  effectiveEndpoint?: string | null;
  effectivePubkeyAvailable: boolean;
  usingOverrideEndpoint: boolean;
  usingOverridePubkey: boolean;
  allowInsecureUpdateEndpoint: boolean;
};

export type UpdateMetadataPayload = {
  version: string;
  currentVersion: string;
  notes?: string | null;
  pubDate?: string | null;
  target: string;
  downloadUrl: string;
};

export type UpdateCheckPayload = {
  configuration: UpdateConfigurationPayload;
  update?: UpdateMetadataPayload | null;
};

export type UpdateInstallPayload = {
  installedVersion: string;
  restartRequired: boolean;
  note: string;
};

export async function loadUpdateConfiguration() {
  return invoke<UpdateConfigurationPayload>("load_update_configuration");
}

export async function checkForUpdate() {
  return invoke<UpdateCheckPayload>("check_for_update");
}

export async function installPendingUpdate() {
  return invoke<UpdateInstallPayload>("install_pending_update");
}
