import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerViewportCommandHandlers,
  requestViewportCameraPreset,
  requestViewportCameraReset,
  requestViewportShortcutCommand,
  requestViewportScaleNormalizationCancel,
  resetViewportCommandHandlersForTests,
} from "../viewportCommands";

beforeEach(() => {
  resetViewportCommandHandlersForTests();
});

describe("viewportCommands", () => {
  it("ignores camera reset requests when no viewport is registered", () => {
    expect(requestViewportCameraReset()).toBe(false);
  });

  it("routes camera reset requests to the active viewport handler", () => {
    const resetCamera = vi.fn();

    registerViewportCommandHandlers({ resetCamera });

    expect(requestViewportCameraReset()).toBe(true);
    expect(resetCamera).toHaveBeenCalledTimes(1);
  });

  it("ignores camera preset requests when no viewport is registered", () => {
    expect(requestViewportCameraPreset("front")).toBe(false);
  });

  it("routes camera preset requests to the active viewport handler", () => {
    const applyCameraPreset = vi.fn(() => true);

    registerViewportCommandHandlers({ applyCameraPreset });

    expect(requestViewportCameraPreset("front")).toBe(true);
    expect(requestViewportCameraPreset("front")).toBe(true);
    expect(applyCameraPreset).toHaveBeenCalledTimes(2);
    expect(applyCameraPreset).toHaveBeenNthCalledWith(1, "front");
    expect(applyCameraPreset).toHaveBeenNthCalledWith(2, "front");
  });

  it("returns false when the active viewport cannot apply a camera preset", () => {
    const applyCameraPreset = vi.fn(() => false);

    registerViewportCommandHandlers({ applyCameraPreset });

    expect(requestViewportCameraPreset("top")).toBe(false);
    expect(applyCameraPreset).toHaveBeenCalledTimes(1);
  });

  it("ignores shortcut commands when no viewport is registered", () => {
    expect(requestViewportShortcutCommand({ kind: "frameAll" })).toBe(false);
  });

  it("routes shortcut commands to the active viewport handler", () => {
    const applyShortcutCommand = vi.fn(() => true);

    registerViewportCommandHandlers({ applyShortcutCommand });

    expect(requestViewportShortcutCommand({ kind: "frameAll" })).toBe(true);
    expect(requestViewportShortcutCommand({ kind: "frameAll" })).toBe(true);
    expect(applyShortcutCommand).toHaveBeenCalledTimes(2);
    expect(applyShortcutCommand).toHaveBeenNthCalledWith(1, {
      kind: "frameAll",
    });
    expect(applyShortcutCommand).toHaveBeenNthCalledWith(2, {
      kind: "frameAll",
    });
  });

  it("returns false when the active viewport cannot apply a shortcut command", () => {
    const applyShortcutCommand = vi.fn(() => false);

    registerViewportCommandHandlers({ applyShortcutCommand });

    expect(requestViewportShortcutCommand({ kind: "resetView" })).toBe(false);
    expect(applyShortcutCommand).toHaveBeenCalledTimes(1);
  });

  it("ignores scale normalization cancel requests when no viewport is registered", () => {
    expect(requestViewportScaleNormalizationCancel()).toBe(false);
  });

  it("routes scale normalization cancel requests to the active viewport handler", () => {
    const cancelScaleNormalization = vi.fn(() => true);

    registerViewportCommandHandlers({ cancelScaleNormalization });

    expect(requestViewportScaleNormalizationCancel()).toBe(true);
    expect(cancelScaleNormalization).toHaveBeenCalledTimes(1);
  });

  it("returns false when the active viewport cannot cancel scale normalization", () => {
    const cancelScaleNormalization = vi.fn(() => false);

    registerViewportCommandHandlers({ cancelScaleNormalization });

    expect(requestViewportScaleNormalizationCancel()).toBe(false);
    expect(cancelScaleNormalization).toHaveBeenCalledTimes(1);
  });

  it("unregisters only the active viewport handlers", () => {
    const stalePreset = vi.fn(() => true);
    const staleShortcut = vi.fn(() => true);
    const staleReset = vi.fn();
    const staleCancel = vi.fn(() => true);
    const activePreset = vi.fn(() => true);
    const activeShortcut = vi.fn(() => true);
    const activeReset = vi.fn();
    const activeCancel = vi.fn(() => true);
    const unregisterStale = registerViewportCommandHandlers({
      applyCameraPreset: stalePreset,
      applyShortcutCommand: staleShortcut,
      cancelScaleNormalization: staleCancel,
      resetCamera: staleReset,
    });
    registerViewportCommandHandlers({
      applyCameraPreset: activePreset,
      applyShortcutCommand: activeShortcut,
      cancelScaleNormalization: activeCancel,
      resetCamera: activeReset,
    });

    unregisterStale();

    expect(requestViewportCameraPreset("left")).toBe(true);
    expect(requestViewportShortcutCommand({ kind: "unhideAll" })).toBe(true);
    expect(requestViewportCameraReset()).toBe(true);
    expect(requestViewportScaleNormalizationCancel()).toBe(true);
    expect(stalePreset).not.toHaveBeenCalled();
    expect(staleShortcut).not.toHaveBeenCalled();
    expect(staleReset).not.toHaveBeenCalled();
    expect(staleCancel).not.toHaveBeenCalled();
    expect(activePreset).toHaveBeenCalledTimes(1);
    expect(activeShortcut).toHaveBeenCalledTimes(1);
    expect(activeReset).toHaveBeenCalledTimes(1);
    expect(activeCancel).toHaveBeenCalledTimes(1);
  });
});
