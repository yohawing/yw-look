import { error, warn } from "@tauri-apps/plugin-log";
import { isTauriEnvironment } from "./platform";

let initialized = false;

function serializeLogArgs(args: readonly unknown[]) {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}\n${arg.stack ?? ""}`.trim();
      }
      if (typeof arg === "string") {
        return arg;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

function logPluginError(message: string) {
  void error(message, { file: "webview" }).catch(() => {});
}

function logPluginWarn(message: string) {
  void warn(message, { file: "webview" }).catch(() => {});
}

export function logFrontendFatal(errorLike: unknown, context: string) {
  const message = serializeLogArgs([context, errorLike]);
  logPluginError(`[frontend fatal] ${message}`);
}

export function initializeRuntimeLogging() {
  if (initialized || !isTauriEnvironment()) {
    return;
  }
  initialized = true;

  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    logPluginWarn(serializeLogArgs(args));
  };

  console.error = (...args: unknown[]) => {
    originalError(...args);
    logPluginError(serializeLogArgs(args));
  };

  window.addEventListener("error", (event) => {
    logFrontendFatal(event.error ?? event.message, "window.onerror");
  });
  window.addEventListener("unhandledrejection", (event) => {
    logFrontendFatal(event.reason, "window.unhandledrejection");
  });
}

export function detachRuntimeLoggingForTest() {
  initialized = false;
}
