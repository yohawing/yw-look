import type { ToolbarAction, ToolbarItem } from "./types";

import type { Build3DToolbarOptions } from "../../types/viewer";

export type { Build3DToolbarOptions } from "../../types/viewer";

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

  // ── Shading ─────────────────────────────────────────────
  {
    groupSep("shading");
    const children: ToolbarItem[] = [];

    // Lit / Unlit (active based on showUnlit only)
    children.push(
      {
        id: "shading-lit",
        mode: "3d",
        group: "shading",
        kind: "button",
        label: "Lit",
        active: !showUnlit,
        onRun: () => {
          if (!showTexture) options.onToggleTexture();
          if (showUnlit) options.onToggleUnlit();
          if (showNormals && options.onToggleNormals) options.onToggleNormals();
          if (showVertexColors && options.onToggleVertexColors)
            options.onToggleVertexColors();
        },
      },
      {
        id: "shading-unlit",
        mode: "3d",
        group: "shading",
        kind: "button",
        label: "Unlit",
        active: showUnlit,
        onRun: () => {
          if (!showTexture) options.onToggleTexture();
          if (!showUnlit) options.onToggleUnlit();
          if (showNormals && options.onToggleNormals) options.onToggleNormals();
          if (showVertexColors && options.onToggleVertexColors)
            options.onToggleVertexColors();
        },
      },
    );

    // Normal overlay
    if (options.onToggleNormals) {
      children.push({ kind: "separator" });
      children.push({
        id: "shading-normal",
        mode: "3d",
        group: "shading",
        kind: "button",
        label: "Normal",
        active: showNormals,
        onRun: options.onToggleNormals,
      });
    }

    // Vertex Color
    if (options.onToggleVertexColors) {
      children.push({
        id: "shading-vertexColor",
        mode: "3d",
        group: "shading",
        kind: "button",
        label: "Vertex Color",
        active: showVertexColors,
        onRun: options.onToggleVertexColors,
      });
    }

    children.push({ kind: "separator" });

    // Texture / Material display
    children.push({
      id: "shading-texture",
      mode: "3d",
      group: "shading",
      kind: "toggle",
      label: "Texture / Material",
      active: showTexture,
      onRun: options.onToggleTexture,
    });

    push({
      id: "shading",
      mode: "3d",
      group: "shading",
      kind: "popover",
      label: "Shading",
      iconId: "light",
      children,
    });
  }

  // ── Wireframe ───────────────────────────────────────────
  {
    groupSep("wireframe");

    const isWireOff = !showWireframe;
    const isWireOverlay = showWireframe && showTexture;
    const isWireOnly = showWireframe && !showTexture;

    const wireframeModes: Array<{
      id: string;
      label: string;
      active: boolean;
      onRun: () => void;
    }> = [
      {
        id: "off",
        label: "Off",
        active: isWireOff,
        onRun: () => {
          if (showWireframe) options.onToggleWireframe();
          if (!showTexture) options.onToggleTexture();
        },
      },
      {
        id: "overlay",
        label: "Overlay",
        active: isWireOverlay,
        onRun: () => {
          if (!showWireframe) options.onToggleWireframe();
          if (!showTexture) options.onToggleTexture();
        },
      },
      {
        id: "wireOnly",
        label: "Wire Only",
        active: isWireOnly,
        onRun: () => {
          if (!showWireframe) options.onToggleWireframe();
          if (showTexture) options.onToggleTexture();
        },
      },
    ];

    const children: ToolbarItem[] = wireframeModes.map((mode) => ({
      id: `wireframe-${mode.id}`,
      mode: "3d" as const,
      group: "wireframe" as const,
      kind: "button" as const,
      label: mode.label,
      active: mode.active,
      onRun: mode.onRun,
    }));

    push({
      id: "wireframe",
      mode: "3d",
      group: "wireframe",
      kind: "popover",
      label: "Wireframe",
      iconId: "wireframe",
      children,
    });
  }

  // ── Overlay ─────────────────────────────────────────────
  {
    let hasOverlay = false;

    if (
      options.showBoundingBoxes !== undefined &&
      options.onToggleBoundingBoxes
    ) {
      groupSep("overlay");
      hasOverlay = true;
      push({
        id: "bounding-boxes",
        mode: "3d",
        group: "overlay",
        kind: "popover",
        label: "Bounding Box",
        iconId: "bbox",
        active: options.showBoundingBoxes,
        children: [
          {
            id: "bounding-boxes-toggle",
            mode: "3d",
            group: "overlay",
            kind: "toggle",
            label: "Bounding Box",
            active: options.showBoundingBoxes,
            onRun: options.onToggleBoundingBoxes,
          },
        ],
      });
    }

    if (options.showSkeleton !== undefined && options.onToggleSkeleton) {
      if (!hasOverlay) groupSep("overlay");
      hasOverlay = true;
      const children: ToolbarItem[] = [
        {
          id: "skeleton-bones",
          mode: "3d",
          group: "overlay",
          kind: "toggle",
          label: "Bone",
          active: options.showSkeleton,
          onRun: options.onToggleSkeleton,
        },
      ];
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
      push({
        id: "skeleton",
        mode: "3d",
        group: "overlay",
        kind: "popover",
        label: "Skeleton",
        iconId: "skeleton",
        active: options.showSkeleton,
        children,
      });
    }
  }

  return items;
}
