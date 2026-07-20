import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { error, warn } from "@tauri-apps/plugin-log";
import {
  detachRuntimeLoggingForTest,
  initializeRuntimeLogging,
} from "../runtimeLogging";

const mocks = vi.hoisted(() => ({
  isTauriEnvironment: vi.fn(),
  pluginError: vi.fn(),
  pluginWarn: vi.fn(),
}));

vi.mock("../platform", () => ({
  isTauriEnvironment: mocks.isTauriEnvironment,
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  error: mocks.pluginError,
  warn: mocks.pluginWarn,
}));

const pluginError = vi.mocked(error);
const pluginWarn = vi.mocked(warn);

let originalConsoleError: typeof console.error;
let originalConsoleWarn: typeof console.warn;

beforeEach(() => {
  originalConsoleError = console.error;
  originalConsoleWarn = console.warn;
  vi.clearAllMocks();
  mocks.isTauriEnvironment.mockReturnValue(true);
  pluginError.mockResolvedValue(undefined);
  pluginWarn.mockResolvedValue(undefined);
});

afterEach(() => {
  detachRuntimeLoggingForTest();
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
  vi.restoreAllMocks();
});

describe("initializeRuntimeLogging", () => {
  it("mirrors global fatal events into the local Tauri log", () => {
    initializeRuntimeLogging();

    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("window exploded"),
        message: "window exploded",
      }),
    );
    const rejectionEvent = new Event(
      "unhandledrejection",
    ) as PromiseRejectionEvent;
    Object.defineProperty(rejectionEvent, "reason", {
      value: new Error("promise exploded"),
    });
    window.dispatchEvent(rejectionEvent);

    expect(pluginError).toHaveBeenCalledWith(
      expect.stringContaining(
        "[frontend fatal] window.onerror Error: window exploded",
      ),
      { file: "webview" },
    );
    expect(pluginError).toHaveBeenCalledWith(
      expect.stringContaining(
        "[frontend fatal] window.unhandledrejection Error: promise exploded",
      ),
      { file: "webview" },
    );
  });

  it("bridges console warnings and errors once in Tauri", () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    initializeRuntimeLogging();
    initializeRuntimeLogging();

    console.warn("asset warning", { path: "model.obj" });
    console.error("asset failure", new Error("loader failed"));

    expect(addEventListenerSpy).toHaveBeenCalledTimes(2);
    expect(pluginWarn).toHaveBeenCalledWith(
      'asset warning {"path":"model.obj"}',
      { file: "webview" },
    );
    expect(pluginError).toHaveBeenCalledWith(
      expect.stringContaining("asset failure Error: loader failed"),
      { file: "webview" },
    );
  });

  it("does not install browser-only logging hooks outside Tauri", () => {
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");
    mocks.isTauriEnvironment.mockReturnValue(false);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    initializeRuntimeLogging();

    console.warn("browser warning");
    expect(addEventListenerSpy).not.toHaveBeenCalled();
    expect(pluginWarn).not.toHaveBeenCalled();
    expect(pluginError).not.toHaveBeenCalled();
  });
});
