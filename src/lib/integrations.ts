import { invoke } from "@tauri-apps/api/core";

import type { IntegrationPayload } from "../types/ipc";

export type { IntegrationPayload } from "../types/ipc";

export async function loadSupportedExtensions() {
  return invoke<IntegrationPayload>("load_supported_extensions");
}
