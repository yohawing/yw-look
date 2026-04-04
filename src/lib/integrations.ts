import { invoke } from "@tauri-apps/api/core";

export type IntegrationPayload = {
  fileAssociationsEnabled: boolean;
  installStrategy: string;
  supportedExtensions: string[];
};

export async function loadSupportedExtensions() {
  return invoke<IntegrationPayload>("load_supported_extensions");
}
