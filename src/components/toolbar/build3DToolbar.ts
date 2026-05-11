import type { ToolbarAction, ToolbarItem } from "./types";

export type Build3DToolbarOptions = {
  showTexture: boolean;
  onToggleTexture: () => void;
  showWireframe: boolean;
  onToggleWireframe: () => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  showAxes?: boolean;
  onToggleAxes?: () => void;
  showEnvironmentBackground?: boolean;
  onToggleEnvironmentBackground?: () => void;
  showShadows?: boolean;
  onToggleShadows?: () => void;
  backfaceCulling?: boolean;
  onToggleBackfaceCulling?: () => void;
  showSkeleton?: boolean;
  onToggleSkeleton?: () => void;
  showBoundingBoxes?: boolean;
  onToggleBoundingBoxes?: () => void;
  showVertexColors?: boolean;
  onToggleVertexColors?: () => void;
  showNormals?: boolean;
  onToggleNormals?: () => void;
  purposeModes?: {
    render: boolean;
    proxy: boolean;
    guide: boolean;
  };
  onTogglePurposeMode?: (mode: "render" | "proxy" | "guide") => void;
  backgroundCycleLabel: string | null;
  onCycleBackground?: () => void;
  environmentCycleLabel: string | null;
  onCycleEnvironment?: () => void;
  cameraCycleLabel: string | null;
  onCycleCamera?: () => void;
  cameraPreset: string | null;
  cameraPresetOptions: Array<{ id: string; label: string }>;
  onSelectCameraPreset?: (preset: string) => void;
  environmentPreset: string;
  environmentPresetOptions: Array<{ id: string; label: string }>;
  onSelectEnvironmentPreset?: (preset: string) => void;
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

  const cameraLabel = options.cameraCycleLabel;
  if (cameraLabel !== null && options.onCycleCamera) {
    groupSep("camera");
    push({
      id: "camera",
      mode: "common",
      group: "camera",
      kind: "popover",
      label: cameraLabel,
      iconId: "camera",
      onRun: options.onCycleCamera,
      children: options.cameraPresetOptions.map((preset) => ({
        id: `camera-${preset.id}`,
        mode: "common",
        group: "camera",
        kind: "button",
        label: preset.label,
        active: options.cameraPreset === preset.id,
        onRun: () => options.onSelectCameraPreset?.(preset.id),
      })),
    });
  }

  if (options.backgroundCycleLabel !== null && options.onCycleBackground) {
    groupSep("background");
    push({
      id: "background",
      mode: "common",
      group: "background",
      kind: "cycle",
      label: "Background",
      iconId: "palette",
      onRun: options.onCycleBackground,
    });
  }

  groupSep("overlay");
  push({
    id: "grid",
    mode: "3d",
    group: "overlay",
    kind: "toggle",
    label: "Grid",
    iconId: "grid",
    active: options.showGrid,
    onRun: options.onToggleGrid,
  });

  if (options.showAxes !== undefined && options.onToggleAxes) {
    push({
      id: "axes",
      mode: "3d",
      group: "overlay",
      kind: "toggle",
      label: "Axes",
      iconId: "axis",
      active: options.showAxes,
      onRun: options.onToggleAxes,
    });
  }

  if (
    options.showEnvironmentBackground !== undefined &&
    options.onToggleEnvironmentBackground
  ) {
    groupSep("look");
    push({
      id: "environment-background",
      mode: "3d",
      group: "look",
      kind: "toggle",
      label: "Environment background",
      iconId: "environment",
      active: options.showEnvironmentBackground,
      onRun: options.onToggleEnvironmentBackground,
    });
  }

  {
    const hasEnv =
      options.environmentCycleLabel !== null && options.onCycleEnvironment;
    const hasShadows =
      options.showShadows !== undefined && options.onToggleShadows;
    if (hasEnv || hasShadows) {
      groupSep("shading");
      const children: ToolbarItem[] = [];
      if (hasEnv) {
        for (const preset of options.environmentPresetOptions) {
          children.push({
            id: `env-${preset.id}`,
            mode: "3d",
            group: "shading",
            kind: "button",
            label: preset.label,
            active: options.environmentPreset === preset.id,
            onRun: () => options.onSelectEnvironmentPreset?.(preset.id),
          });
        }
      }
      if (hasEnv && hasShadows) {
        children.push({ kind: "separator" });
      }
      if (hasShadows) {
        children.push({
          id: "shadows",
          mode: "3d",
          group: "shading",
          kind: "toggle",
          label: "Shadows",
          iconId: "light",
          active: options.showShadows ?? false,
          onRun: options.onToggleShadows,
        });
      }
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
  }

  groupSep("look");
  push({
    id: "texture",
    mode: "3d",
    group: "look",
    kind: "toggle",
    label: options.showTexture ? "Hide textures" : "Show textures",
    iconId: "texture",
    active: !options.showTexture,
    onRun: options.onToggleTexture,
  });

  groupSep("shading");
  push({
    id: "wireframe",
    mode: "3d",
    group: "shading",
    kind: "toggle",
    label: "Wireframe",
    iconId: "wireframe",
    active: options.showWireframe,
    onRun: options.onToggleWireframe,
  });

  if (
    options.backfaceCulling !== undefined &&
    options.onToggleBackfaceCulling
  ) {
    push({
      id: "backface-culling",
      mode: "3d",
      group: "shading",
      kind: "toggle",
      label: "Backface culling",
      iconId: "backface",
      active: options.backfaceCulling,
      onRun: options.onToggleBackfaceCulling,
    });
  }

  if (options.showNormals !== undefined && options.onToggleNormals) {
    groupSep("inspect");
    push({
      id: "normals",
      mode: "3d",
      group: "inspect",
      kind: "toggle",
      label: "Normals",
      iconId: "normals",
      active: options.showNormals,
      onRun: options.onToggleNormals,
    });
  }

  if (options.showVertexColors !== undefined && options.onToggleVertexColors) {
    push({
      id: "vertex-colors",
      mode: "3d",
      group: "inspect",
      kind: "toggle",
      label: "Vertex colors",
      iconId: "vertex",
      active: options.showVertexColors,
      onRun: options.onToggleVertexColors,
    });
  }

  if (options.showSkeleton !== undefined && options.onToggleSkeleton) {
    push({
      id: "skeleton",
      mode: "3d",
      group: "inspect",
      kind: "toggle",
      label: "Skeleton",
      iconId: "skeleton",
      active: options.showSkeleton,
      onRun: options.onToggleSkeleton,
    });
  }

  if (
    options.showBoundingBoxes !== undefined &&
    options.onToggleBoundingBoxes
  ) {
    push({
      id: "bounding-boxes",
      mode: "3d",
      group: "inspect",
      kind: "toggle",
      label: "Bounding boxes",
      iconId: "bbox",
      active: options.showBoundingBoxes,
      onRun: options.onToggleBoundingBoxes,
    });
  }

  if (options.purposeModes && options.onTogglePurposeMode) {
    groupSep("overlay");
    const modes: Array<"render" | "proxy" | "guide"> = [
      "render",
      "proxy",
      "guide",
    ];
    for (const mode of modes) {
      push({
        id: `purpose-${mode}`,
        mode: "3d",
        group: "overlay",
        kind: "toggle",
        label: `USD purpose: ${mode}`,
        iconId: "palette",
        active: options.purposeModes[mode],
        onRun: () => options.onTogglePurposeMode!(mode),
      });
    }
  }

  return items;
}
