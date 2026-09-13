import { t } from "../../lib/i18n";
import type { ToolbarAction, ToolbarItem } from "./types";
import type {
  TextureColorSpace,
  BuildImageToolbarOptions,
} from "../../types/viewer";

export type {
  TextureColorSpace,
  BuildImageToolbarOptions,
} from "../../types/viewer";

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

      push({
        id: "channel",
        mode: "image",
        group: "channel",
        kind: "popover",
        label: t("channel"),
        iconId: "channel",
        children,
      });
    }
  }

  // ── Color ───────────────────────────────────────────────
  {
    groupSep("color");
    const colorSpaces: Array<{ id: TextureColorSpace; label: string }> = [
      { id: "srgb", label: t("srgb") },
      { id: "linear", label: t("linear") },
      { id: "raw", label: t("raw") },
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
      kind: "status",
      label: t("toolbar.exposure", { value: options.exposure.toFixed(1) }),
    });

    push({
      id: "color",
      mode: "image",
      group: "color",
      kind: "popover",
      label: t("color"),
      iconId: "colorspace",
      children,
    });
  }

  return items;
}
