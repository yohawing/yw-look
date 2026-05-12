import type { ToolbarAction, ToolbarItem } from "./types";

export type TextureColorSpace = "srgb" | "linear" | "raw";

export type BuildImageToolbarOptions = {
  // Channel
  channelMode: string | null;
  channelOptions: Array<{ id: string; label: string }>;
  onSelectChannel?: (mode: string) => void;

  // Color
  colorSpace: TextureColorSpace;
  onSelectColorSpace?: (mode: TextureColorSpace) => void;
  exposure: number;

  // Background (placeholder — not yet wired to shader)
  bgMode: string;
  onSelectBgMode?: (mode: string) => void;

  // Tiling (placeholder — not yet wired to texture wrap)
  tilingMode: string;
  onSelectTilingMode?: (mode: string) => void;
  tileCount: number;
};

export function buildImageToolbar(
  options: BuildImageToolbarOptions,
): ToolbarItem[] {
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

  // ── Channel ─────────────────────────────────────────────
  {
    groupSep("channel");
    const channelOpts = options.channelOptions;
    if (channelOpts.length > 0 && options.onSelectChannel) {
      const children: ToolbarItem[] = channelOpts.map((mode) => ({
        id: `channel-${mode.id}`,
        mode: "image" as const,
        group: "channel" as const,
        kind: "button" as const,
        label: mode.label,
        active: options.channelMode === mode.id,
        onRun: () => options.onSelectChannel?.(mode.id),
      }));

      // Cycle channels on trigger click
      const cycleChannel = () => {
        const currentIdx = channelOpts.findIndex(
          (c) => c.id === options.channelMode,
        );
        const nextIdx = (currentIdx + 1) % channelOpts.length;
        options.onSelectChannel?.(channelOpts[nextIdx].id);
      };

      push({
        id: "channel",
        mode: "image",
        group: "channel",
        kind: "popover",
        label: "Channel",
        iconId: "channel",
        onRun: cycleChannel,
        children,
      });
    }
  }

  // ── Color ───────────────────────────────────────────────
  {
    groupSep("color");
    const colorSpaces: Array<{ id: TextureColorSpace; label: string }> = [
      { id: "srgb", label: "sRGB" },
      { id: "linear", label: "Linear" },
      { id: "raw", label: "Raw" },
    ];
    const children: ToolbarItem[] = colorSpaces.map((cs) => ({
      id: `colorspace-${cs.id}`,
      mode: "image" as const,
      group: "color" as const,
      kind: "button" as const,
      label: cs.label,
      active: options.colorSpace === cs.id,
      onRun: () => options.onSelectColorSpace?.(cs.id),
    }));

    // Exposure info label
    children.push({ kind: "separator" });
    children.push({
      id: "color-exposure",
      mode: "image",
      group: "color",
      kind: "button",
      label: `Exposure: ${options.exposure.toFixed(1)}`,
      disabled: true,
    });

    // Cycle color spaces on trigger click
    const cycleColor = () => {
      const currentIdx = colorSpaces.findIndex(
        (cs) => cs.id === options.colorSpace,
      );
      const nextIdx = (currentIdx + 1) % colorSpaces.length;
      options.onSelectColorSpace?.(colorSpaces[nextIdx].id);
    };

    push({
      id: "color",
      mode: "image",
      group: "color",
      kind: "popover",
      label: "Color",
      iconId: "colorspace",
      onRun: cycleColor,
      children,
    });
  }

  // ── Background (placeholder — not yet wired to shader) ──
  {
    groupSep("background");
    const bgModes: Array<{ id: string; label: string }> = [
      { id: "checker", label: "Checker" },
      { id: "black", label: "Black" },
      { id: "white", label: "White" },
      { id: "transparent", label: "Transparent" },
    ];
    const children: ToolbarItem[] = bgModes.map((mode) => ({
      id: `bg-${mode.id}`,
      mode: "image" as const,
      group: "background" as const,
      kind: "button" as const,
      label: mode.label,
      active: options.bgMode === mode.id,
      disabled: true,
      onRun: () => options.onSelectBgMode?.(mode.id),
    }));

    push({
      id: "background",
      mode: "image",
      group: "background",
      kind: "popover",
      label: "Background",
      iconId: "checker",
      children,
    });
  }

  // ── Inspect (placeholders) ──────────────────────────────
  {
    groupSep("inspect");
    const children: ToolbarItem[] = [
      {
        id: "inspect-uv",
        mode: "image",
        group: "inspect",
        kind: "toggle",
        label: "UV Overlay",
        iconId: "uv",
        active: false,
        disabled: true,
      },
      {
        id: "inspect-pixel",
        mode: "image",
        group: "inspect",
        kind: "toggle",
        label: "Pixel Inspect",
        iconId: "inspect",
        active: false,
        disabled: true,
      },
    ];

    push({
      id: "inspect",
      mode: "image",
      group: "inspect",
      kind: "popover",
      label: "Inspect",
      iconId: "inspect",
      children,
    });
  }

  // ── Tiling (placeholder — not yet wired to texture wrap) ─
  {
    groupSep("tiling");
    const tilingModes: Array<{ id: string; label: string }> = [
      { id: "clamp", label: "Clamp" },
      { id: "repeat", label: "Repeat" },
      { id: "mirror", label: "Mirror" },
    ];
    const children: ToolbarItem[] = tilingModes.map((mode) => ({
      id: `tiling-${mode.id}`,
      mode: "image" as const,
      group: "tiling" as const,
      kind: "button" as const,
      label: mode.label,
      active: options.tilingMode === mode.id,
      disabled: true,
      onRun: () => options.onSelectTilingMode?.(mode.id),
    }));

    // Tile count info label
    children.push({ kind: "separator" });
    children.push({
      id: "tiling-count",
      mode: "image",
      group: "tiling",
      kind: "button",
      label: `Tile Preview: ${options.tileCount}x`,
      disabled: true,
    });

    push({
      id: "tiling",
      mode: "image",
      group: "tiling",
      kind: "popover",
      label: "Tiling",
      iconId: "tiling",
      children,
    });
  }

  return items;
}
