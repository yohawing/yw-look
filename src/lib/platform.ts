import { isTauri } from "@tauri-apps/api/core";

export function isTauriEnvironment() {
  return isTauri();
}
