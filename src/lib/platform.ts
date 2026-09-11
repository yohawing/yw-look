import { isTauri } from "@tauri-apps/api/core";

export function isTauriEnvironment() {
  return isTauri();
}

export function isWindowsEnvironment() {
  return (
    typeof navigator !== "undefined" && /\bWindows\b/i.test(navigator.userAgent)
  );
}
