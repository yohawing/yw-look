import type { CameraPreset } from "../types/viewer";
import type { ViewportShortcutCommand } from "../types/ui";

type ViewportCommandHandlers = {
  applyCameraPreset?: (preset: CameraPreset) => boolean;
  applyShortcutCommand?: (command: ViewportShortcutCommand) => boolean;
  cancelScaleNormalization?: () => boolean;
  resetCamera?: () => void;
};

let activeHandlers: ViewportCommandHandlers = {};

export function registerViewportCommandHandlers(
  handlers: ViewportCommandHandlers,
): () => void {
  activeHandlers = handlers;

  return () => {
    if (activeHandlers === handlers) {
      activeHandlers = {};
    }
  };
}

export function requestViewportCameraReset(): boolean {
  const resetCamera = activeHandlers.resetCamera;
  if (!resetCamera) {
    return false;
  }

  resetCamera();
  return true;
}

export function requestViewportCameraPreset(preset: CameraPreset): boolean {
  const applyCameraPreset = activeHandlers.applyCameraPreset;
  if (!applyCameraPreset) {
    return false;
  }

  return applyCameraPreset(preset);
}

export function requestViewportShortcutCommand(
  command: ViewportShortcutCommand,
): boolean {
  const applyShortcutCommand = activeHandlers.applyShortcutCommand;
  if (!applyShortcutCommand) {
    return false;
  }

  return applyShortcutCommand(command);
}

export function requestViewportScaleNormalizationCancel(): boolean {
  const cancelScaleNormalization = activeHandlers.cancelScaleNormalization;
  if (!cancelScaleNormalization) {
    return false;
  }

  return cancelScaleNormalization();
}

export function resetViewportCommandHandlersForTests(): void {
  activeHandlers = {};
}
