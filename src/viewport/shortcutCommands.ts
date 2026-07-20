import type { PurposeModes } from "../lib/usd";
import type { ViewportShortcutCommand } from "../lib/viewerShortcuts";
import type { SceneContext, ViewerSurfaceMode } from "../types/viewer";
import {
  configureAssetControls,
  frameCurrentMountedObject,
  frameObjectBounds,
} from "./camera";
import {
  applyManualVisibility,
  applyPurposeVisibility,
  findObjectBySelectionKey,
  isolateObject,
  setSubtreeManualHidden,
} from "./selection";

export type ApplyViewportShortcutCommandOptions = {
  cameraSpeedMultiplier: number;
  command: ViewportShortcutCommand | null | undefined;
  context: SceneContext | null;
  purposeModes: PurposeModes | undefined;
  showAxes: boolean;
  showGrid: boolean;
  texturePreview3D: boolean;
  viewerSurfaceMode: ViewerSurfaceMode;
};

export function applyViewportShortcutCommand({
  cameraSpeedMultiplier,
  command,
  context,
  purposeModes,
  showAxes,
  showGrid,
  texturePreview3D,
  viewerSurfaceMode,
}: ApplyViewportShortcutCommandOptions) {
  if (!command || !context) {
    return false;
  }

  const sourceObject = context.sourceObject;

  switch (command.kind) {
    case "focusSelected": {
      if (!sourceObject || viewerSurfaceMode !== "asset") {
        return false;
      }
      const target = findObjectBySelectionKey(
        sourceObject,
        command.selectionKey,
      );
      if (!target) {
        return false;
      }
      configureAssetControls(context.controls);
      frameObjectBounds(context, target, cameraSpeedMultiplier);
      return true;
    }
    case "frameAll":
    case "resetView":
      return frameCurrentMountedObject(
        context,
        viewerSurfaceMode,
        showGrid,
        showAxes,
        cameraSpeedMultiplier,
        texturePreview3D,
      );
    case "hideSelected": {
      if (!sourceObject || viewerSurfaceMode !== "asset") {
        return false;
      }
      const target = findObjectBySelectionKey(
        sourceObject,
        command.selectionKey,
      );
      if (!target) {
        return false;
      }
      setSubtreeManualHidden(target, true);
      applyManualVisibility(sourceObject);
      return true;
    }
    case "isolateSelected": {
      if (!sourceObject || viewerSurfaceMode !== "asset") {
        return false;
      }
      const target = findObjectBySelectionKey(
        sourceObject,
        command.selectionKey,
      );
      if (!target) {
        return false;
      }
      isolateObject(sourceObject, target);
      applyPurposeVisibility(sourceObject, purposeModes);
      return true;
    }
    case "unhideAll":
      if (!sourceObject || viewerSurfaceMode !== "asset") {
        return false;
      }
      setSubtreeManualHidden(sourceObject, false);
      applyPurposeVisibility(sourceObject, purposeModes);
      return true;
  }
}
