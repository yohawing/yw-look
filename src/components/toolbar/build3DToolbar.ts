import type { ToolbarAction, ToolbarItem } from "./types";

export type Build3DToolbarOptions = {
  // Camera
  cameraPreset: string | null;
  cameraPresetOptions: Array<{ id: string; label: string }>;
  onSelectCameraPreset?: (preset: string) => void;
  onCycleCamera?: () => void;

  // Shading
  showTexture: boolean;
  onToggleTexture: () => void;
  showUnlit: boolean;
  onToggleUnlit: () => void;
  showNormals?: boolean;
  onToggleNormals?: () => void;
  showVertexColors?: boolean;
  onToggleVertexColors?: () => void;

  // Wireframe
  showWireframe: boolean;
  onToggleWireframe: () => void;

  // Look
  environmentPreset: string;
  environmentPresetOptions: Array<{ id: string; label: string }>;
  onSelectEnvironmentPreset?: (preset: string) => void;
  showShadows?: boolean;
  onToggleShadows?: () => void;
  showEnvironmentBackground?: boolean;
  onToggleEnvironmentBackground?: () => void;

  // Overlay
  showBoundingBoxes?: boolean;
  onToggleBoundingBoxes?: () => void;
  showSkeleton?: boolean;
  onToggleSkeleton?: () => void;
};

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
      onRun: options.onCycleCamera,
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

    // UV (placeholder)
    children.push({
      id: "shading-uv",
      mode: "3d",
      group: "shading",
      kind: "button",
      label: "UV",
      disabled: true,
    });

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

    // Cycle: toggles showUnlit only — preserves texture/overlay state
    const cycleShading = () => {
      options.onToggleUnlit();
    };

    push({
      id: "shading",
      mode: "3d",
      group: "shading",
      kind: "popover",
      label: "Shading",
      iconId: "light",
      onRun: cycleShading,
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

    // Cycle: off → overlay → wireOnly → off
    const cycleWireframe = () => {
      if (!showWireframe) {
        // Go to overlay
        options.onToggleWireframe();
        if (!showTexture) options.onToggleTexture();
      } else if (showTexture) {
        // Go to wire only
        options.onToggleTexture();
      } else {
        // Go to off
        options.onToggleWireframe();
        if (!showTexture) options.onToggleTexture();
      }
    };

    push({
      id: "wireframe",
      mode: "3d",
      group: "wireframe",
      kind: "popover",
      label: "Wireframe",
      iconId: "wireframe",
      onRun: cycleWireframe,
      children,
    });
  }

  // ── Look ────────────────────────────────────────────────
  {
    groupSep("look");
    const children: ToolbarItem[] = [];

    const envOpts = options.environmentPresetOptions;
    if (envOpts.length > 0 && options.onSelectEnvironmentPreset) {
      for (const preset of envOpts) {
        children.push({
          id: `look-env-${preset.id}`,
          mode: "3d",
          group: "look",
          kind: "button",
          label: preset.label,
          active: options.environmentPreset === preset.id,
          onRun: () => options.onSelectEnvironmentPreset?.(preset.id),
        });
      }
    }

    children.push({ kind: "separator" });

    // Shadow toggle
    if (options.showShadows !== undefined && options.onToggleShadows) {
      children.push({
        id: "look-shadow",
        mode: "3d",
        group: "look",
        kind: "toggle",
        label: "Shadow",
        iconId: "shadow",
        active: options.showShadows,
        onRun: options.onToggleShadows,
      });
    }

    // Background toggle
    if (
      options.showEnvironmentBackground !== undefined &&
      options.onToggleEnvironmentBackground
    ) {
      children.push({
        id: "look-background",
        mode: "3d",
        group: "look",
        kind: "toggle",
        label: "Background",
        iconId: "environment",
        active: options.showEnvironmentBackground,
        onRun: options.onToggleEnvironmentBackground,
      });
    }

    // Cycle environment presets on click
    const cycleEnv = () => {
      if (envOpts.length === 0) return;
      const currentIdx = envOpts.findIndex(
        (p) => p.id === options.environmentPreset,
      );
      const nextIdx = (currentIdx + 1) % envOpts.length;
      options.onSelectEnvironmentPreset?.(envOpts[nextIdx].id);
    };

    push({
      id: "look",
      mode: "3d",
      group: "look",
      kind: "popover",
      label: "Look",
      iconId: "look",
      onRun: cycleEnv,
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
        kind: "toggle",
        label: "Bounding Box",
        iconId: "bbox",
        active: options.showBoundingBoxes,
        onRun: options.onToggleBoundingBoxes,
      });
    }

    if (options.showSkeleton !== undefined && options.onToggleSkeleton) {
      if (!hasOverlay) groupSep("overlay");
      push({
        id: "skeleton",
        mode: "3d",
        group: "overlay",
        kind: "toggle",
        label: "Skeleton",
        iconId: "skeleton",
        active: options.showSkeleton,
        onRun: options.onToggleSkeleton,
      });
    }
  }

  return items;
}
