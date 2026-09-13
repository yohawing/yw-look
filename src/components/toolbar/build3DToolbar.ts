import { t } from "../../lib/i18n";
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
      label: t("camera"),
      iconId: "camera",
      children: cameraChildren,
    });
  }

  // ── Display ─────────────────────────────────────────────
  {
    groupSep("display");
    const children: ToolbarItem[] = [];

    const surfaceModes: Array<{
      id: ViewportSurfaceDisplay;
      label: string;
      available: boolean;
    }> = [
      { id: "shaded", label: t("shaded"), available: true },
      { id: "unlit", label: t("unlit"), available: true },
      {
        id: "normals",
        label: t("normals"),
        available: options.onToggleNormals !== undefined,
      },
      {
        id: "vertexColor",
        label: t("vertex_color"),
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

    if (activeDisplayState.surface === "vertexColor") {
      children.push({
        id: "vertex-color-status",
        mode: "3d",
        group: "display",
        kind: "status",
        label:
          options.vertexColorMeshCount === 0
            ? t("toolbar.noVertexColors")
            : t("toolbar.partialVertexColors"),
      });
    }

    push({
      id: "display",
      mode: "3d",
      group: "display",
      kind: "popover",
      label: t("shading"),
      iconId: "shading",
      children,
    });
  }

  // ── Lighting ────────────────────────────────────────────
  {
    groupSep("lighting");
    const hasEnvironment = options.environmentPreset !== "none";
    const rotationDegrees =
      ((options.environmentRotation ?? 0) * 180) / Math.PI;
    const rotation =
      rotationDegrees >= 0 && rotationDegrees <= 360
        ? rotationDegrees
        : ((rotationDegrees % 360) + 360) % 360;
    const children: ToolbarItem[] = [
      {
        id: "environment-heading",
        mode: "3d",
        group: "lighting",
        kind: "status",
        label: t("environment_map_ibl"),
      },
      ...options.environmentPresetOptions.map((preset): ToolbarAction => ({
        id: `environment-${preset.id}`,
        mode: "3d",
        group: "lighting",
        kind: "button",
        label: preset.label,
        active: options.environmentPreset === preset.id,
        disabled: !options.onSelectEnvironmentPreset,
        onRun: () => options.onSelectEnvironmentPreset?.(preset.id),
      })),
      { kind: "separator" },
      {
        id: "environment-rotation",
        mode: "3d",
        group: "lighting",
        kind: "slider",
        label: t("rotation"),
        value: rotation,
        valueLabel: `${Math.round(rotation)}°`,
        min: 0,
        max: 360,
        step: 1,
        disabled: !hasEnvironment || !options.onChangeEnvironmentRotation,
        onValueChange: (degrees) =>
          options.onChangeEnvironmentRotation?.((degrees * Math.PI) / 180),
      },
      {
        id: "environment-background",
        mode: "3d",
        group: "lighting",
        kind: "toggle",
        label: t("show_as_background"),
        active: hasEnvironment && options.showEnvironmentBackground,
        disabled: !hasEnvironment || !options.onToggleEnvironmentBackground,
        onRun: options.onToggleEnvironmentBackground,
      },
      { kind: "separator" },
      {
        id: "lighting-shadows",
        mode: "3d",
        group: "lighting",
        kind: "toggle",
        label: t("shadows"),
        active: options.showShadows,
        disabled: !options.onToggleShadows,
        onRun: options.onToggleShadows,
      },
    ];
    if (activeDisplayState.surface !== "shaded") {
      children.push({
        id: "lighting-surface-status",
        mode: "3d",
        group: "lighting",
        kind: "status",
        label: t("lighting_applies_to_shaded_surfaces"),
      });
    }
    push({
      id: "lighting",
      mode: "3d",
      group: "lighting",
      kind: "popover",
      label: t("lighting"),
      iconId: "light",
      children,
    });
  }

  // ── Wireframe ───────────────────────────────────────────
  {
    groupSep("wireframe");
    const wireframeModes: Array<{
      id: ViewportWireframeMode;
      label: string;
    }> = [
      { id: "off", label: t("off") },
      { id: "overlay", label: t("overlay") },
      { id: "only", label: t("only") },
    ];

    push({
      id: "wireframe",
      mode: "3d",
      group: "wireframe",
      kind: "popover",
      label: t("wireframe"),
      iconId: "wireframe",
      active: activeDisplayState.wireframe !== "off",
      children: wireframeModes.map((mode) => ({
        id: `wireframe-${mode.id}`,
        mode: "3d" as const,
        group: "wireframe" as const,
        kind: "button" as const,
        label: mode.label,
        active: activeDisplayState.wireframe === mode.id,
        onRun: () => applyWireframeMode(mode.id, options),
      })),
    });
  }

  // ── Overlays ────────────────────────────────────────────
  {
    if (
      options.showBoundingBoxes !== undefined &&
      options.onToggleBoundingBoxes
    ) {
      groupSep("overlay");
      push({
        id: "overlays",
        mode: "3d",
        group: "overlay",
        kind: "popover",
        label: t("overlays"),
        iconId: "overlay",
        active: options.showBoundingBoxes,
        children: [
          {
            id: "bounding-boxes-toggle",
            mode: "3d",
            group: "overlay",
            kind: "toggle",
            label: t("bounding_box"),
            active: options.showBoundingBoxes,
            onRun: options.onToggleBoundingBoxes,
          },
        ],
      });
    }
  }

  // ── Skeleton ────────────────────────────────────────────
  {
    if (options.showSkeleton !== undefined && options.onToggleSkeleton) {
      groupSep("overlay");
      const children: ToolbarItem[] = [
        {
          id: "skeleton-bones",
          mode: "3d",
          group: "overlay",
          kind: "toggle",
          label: t("bone"),
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
          label: t("local_axis"),
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
          label: t("bone_name"),
          active: options.showJointNames,
          onRun: options.onToggleJointNames,
        });
      }
      push({
        id: "skeleton",
        mode: "3d",
        group: "overlay",
        kind: "popover",
        label: t("skeleton"),
        iconId: "skeleton",
        active: Boolean(
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
