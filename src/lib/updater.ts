import { invoke } from "@tauri-apps/api/core";

import type {
  UpdateConfigurationPayload,
  UpdateCheckPayload,
  UpdateInstallPayload,
} from "../types/ipc";

export type {
  UpdateConfigurationPayload,
  UpdateMetadataPayload,
  UpdateCheckPayload,
  UpdateInstallPayload,
} from "../types/ipc";

export function isUpdaterConfigured(
  configuration: UpdateConfigurationPayload | null,
): boolean {
  return Boolean(
    configuration?.effectiveEndpoint?.trim() &&
    configuration.effectivePubkeyAvailable,
  );
}

export async function loadUpdateConfiguration() {
  return invoke<UpdateConfigurationPayload>("load_update_configuration");
}

export async function checkForUpdate() {
  return invoke<UpdateCheckPayload>("check_for_update");
}

export async function installPendingUpdate() {
  return invoke<UpdateInstallPayload>("install_pending_update");
}
