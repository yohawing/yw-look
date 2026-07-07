import type { ToolbarAction, ToolbarItem } from "./types";

import type {
  Build3DToolbarOptions,
  ViewportSurfaceDisplay,
  ViewportWireframeMode,
} from "../../types/viewer";
import { deriveViewportDisplayState } from "../../types/viewer";

export type { Build3DToolbarOptions } from "../../types/viewer";

function applySurfaceDisplay(
  target: ViewportSurfaceDisplay,
  options: Build3DToolbarOptions,
) {
  const {
    showTexture,
    showUnlit,
    showNormals = false,
    showVertexColors = false,
    onToggleTexture,
    onToggleUnlit,
    onToggleNormals,
    onToggleVertexColors,
  } = options;

  switch (target) {
    case "shaded":
      if (!showTexture) onToggleTexture();
      if (showUnlit) onToggleUnlit();
      if (showNormals && onToggleNormals) onToggleNormals();
      if (showVertexColors && onToggleVertexColors) onToggleVertexColors();
      break;
    case "unlit":
      if (!showTexture) onToggleTexture();
      if (!showUnlit) onToggleUnlit();
      if (showNormals && onToggleNormals) onToggleNormals();
      if (showVertexColors && onToggleVertexColors) onToggleVertexColors();
      break;
    case "normals":
      if (showUnlit) onToggleUnlit();
      if (showVertexColors && onToggleVertexColors) onToggleVertexColors();
      if (onToggleNormals && !showNormals) onToggleNormals();
      break;
    case "vertexColor":
      if (showUnlit) onToggleUnlit();
      if (showNormals && onToggleNormals) onToggleNormals();
      if (onToggleVertexColors && !showVertexColors) onToggleVertexColors();
      break;
  }
}

function applyWireframeMode(
  target: ViewportWireframeMode,
  options: Build3DToolbarOptions,
) {
  const { showTexture, showWireframe, onToggleTexture, onToggleWireframe } =
    options;

  switch (target) {
    case "off":
      if (showWireframe) onToggleWireframe();
      if (!showTexture) onToggleTexture();
      break;
    case "overlay":
      if (!showWireframe) onToggleWireframe();
      if (!showTexture) onToggleTexture();
      break;
    case "only":
      if (!showWireframe) onToggleWireframe();
      if (showTexture) onToggleTexture();
      break;
  }
}

export function build3DToolbar(options: Build3DToolbarOptions): ToolbarItem[] {
  const items: ToolbarItem[] = [];

  function push(action: ToolbarAction) {
    items.push(action);
  }

  function sep() {
    if (items.length > 0 && items[items.length - 1].kind !== "separator") {
      items.push({ kind: "separator" });
    }
  }

  let lastGroup: string | null = null;

  function groupSep(group: string) {
    if (lastGroup !== null && lastGroup !== group) {
      sep();
    }
    lastGroup = group;
  }

  const {
    showTexture,
    showWireframe,
    showUnlit,
    showNormals = false,
    showVertexColors = false,
  } = options;

  const activeDisplayState = deriveViewportDisplayState({
    showTexture,
    showWireframe,
    showUnlit,
    showNormals,
    showVertexColors,
  });

  // ── Camera ──────────────────────────────────────────────
  const cameraOpts = options.cameraPresetOptions;
  if (cameraOpts.length > 0 && options.onSelectCameraPreset) {
    groupSep("camera");
    const cameraChildren: ToolbarItem[] = cameraOpts.map((preset) => ({
      id: `camera-${preset.id}`,
      mode: "3d" as const,
      group: "camera" as const,
      kind: "button" as const,
      label: preset.label,
      active: options.cameraPreset === preset.id,
      onRun: () => options.onSelectCameraPreset?.(preset.id),
    }));

    push({
      id: "camera",
      mode: "3d",
      group: "camera",
      kind: "popover",
      label: "Camera",
      iconId: "camera",
      children: cameraChildren,
    });
  }

  // ── Display (surface + wireframe) ───────────────────────
  {
    groupSep("display");
    const children: ToolbarItem[] = [];

    const surfaceModes: Array<{
      id: ViewportSurfaceDisplay;
      label: string;
      available: boolean;
    }> = [
      { id: "shaded", label: "Shaded", available: true },
      { id: "unlit", label: "Unlit", available: true },
      {
        id: "normals",
        label: "Normals",
        available: options.onToggleNormals !== undefined,
      },
      {
        id: "vertexColor",
        label: "Vertex Color",
        available: options.onToggleVertexColors !== undefined,
      },
    ];

    for (const mode of surfaceModes) {
      if (!mode.available) continue;
      children.push({
        id: `display-${mode.id}`,
        mode: "3d",
        group: "display",
        kind: "button",
        label: mode.label,
        active: activeDisplayState.surface === mode.id,
        onRun: () => applySurfaceDisplay(mode.id, options),
      });
    }

    children.push({ kind: "separator" });

    children.push({
      id: "wireframe-section-label",
      mode: "3d",
      group: "wireframe",
      kind: "status",
      label: "Wireframe",
    });

    const wireframeModes: Array<{
      id: ViewportWireframeMode;
      label: string;
    }> = [
      { id: "off", label: "Off" },
      { id: "overlay", label: "Overlay" },
      { id: "only", label: "Only" },
    ];

    for (const mode of wireframeModes) {
      children.push({
        id: `display-wireframe-${mode.id}`,
        mode: "3d",
        group: "wireframe",
        kind: "button",
        label: mode.label,
        active: activeDisplayState.wireframe === mode.id,
        onRun: () => applyWireframeMode(mode.id, options),
      });
    }

    push({
      id: "display",
      mode: "3d",
      group: "display",
      kind: "popover",
      label: "Display",
      iconId: "light",
      children,
    });
  }

  // ── Overlay ─────────────────────────────────────────────
  {
    const children: ToolbarItem[] = [];

    if (
      options.showBoundingBoxes !== undefined &&
      options.onToggleBoundingBoxes
    ) {
      children.push({
        id: "bounding-boxes-toggle",
        mode: "3d",
        group: "overlay",
        kind: "toggle",
        label: "Bounding Box",
        active: options.showBoundingBoxes,
        onRun: options.onToggleBoundingBoxes,
      });
    }

    if (options.showSkeleton !== undefined && options.onToggleSkeleton) {
      if (children.length > 0) {
        children.push({ kind: "separator" });
      }
      children.push({
        id: "skeleton-section-label",
        mode: "3d",
        group: "overlay",
        kind: "status",
        label: "Skeleton",
      });
      children.push({
        id: "skeleton-bones",
        mode: "3d",
        group: "overlay",
        kind: "toggle",
        label: "Bone",
        active: options.showSkeleton,
        onRun: options.onToggleSkeleton,
      });
      if (options.showLocalAxis !== undefined && options.onToggleLocalAxis) {
        children.push({
          id: "local-axis",
          mode: "3d",
          group: "overlay",
          kind: "toggle",
          label: "Local Axis",
          active: options.showLocalAxis,
          onRun: options.onToggleLocalAxis,
        });
      }
      if (options.showJointNames !== undefined && options.onToggleJointNames) {
        children.push({
          id: "bone-name",
          mode: "3d",
          group: "overlay",
          kind: "toggle",
          label: "Bone Name",
          active: options.showJointNames,
          onRun: options.onToggleJointNames,
        });
      }
    }

    if (children.length > 0) {
      groupSep("overlay");
      push({
        id: "overlays",
        mode: "3d",
        group: "overlay",
        kind: "popover",
        label: "Overlays",
        iconId: "overlay",
        active: Boolean(
          options.showBoundingBoxes ||
          options.showSkeleton ||
          options.showLocalAxis ||
          options.showJointNames,
        ),
        children,
      });
    }
  }

  return items;
}
