export function isTauriEnvironment() {
  if (typeof window === "undefined") {
    return false;
  }

  return Object.prototype.hasOwnProperty.call(window, "__TAURI_INTERNALS__");
}
