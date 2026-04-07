import type { RecentFileEntry } from "./recentFiles";
import sharedMenuDefinition from "./menu-definition.json";

const menuActionIds = [
  "file.open",
  "file.exit",
  "view.toggleTexture",
  "view.toggleWireframe",
  "view.toggleGrid",
  "view.resetCamera",
  "view.toggleSidebar",
  "window.toggleFullscreen",
  "app.openSettings",
  "help.shortcuts",
  "help.about",
] as const;
const menuActionIdSet = new Set<string>(menuActionIds);

export type MenuActionId = (typeof menuActionIds)[number];

export type ShortcutDefinition = {
  key: string;
  ctrlOrMeta?: boolean;
  shift?: boolean;
  alt?: boolean;
};

type SharedMenuItemEntry = {
  type: "item";
  id: string;
  label: string;
  shortcut?: ShortcutDefinition;
};

type SharedMenuSeparatorEntry = {
  type: "separator";
};

type SharedMenuRecentFilesEntry = {
  type: "recentFiles";
  label: string;
};

type SharedMenuEntry =
  | SharedMenuItemEntry
  | SharedMenuSeparatorEntry
  | SharedMenuRecentFilesEntry;

type SharedMenuSection = {
  id: string;
  label: string;
  entries: SharedMenuEntry[];
};

type SharedMenuDefinition = {
  sections: SharedMenuSection[];
};

export function isMenuActionId(value: string): value is MenuActionId {
  return menuActionIdSet.has(value);
}

export type MenuLeafDefinition = {
  type: "item";
  id: MenuActionId;
  label: string;
};

export type MenuSeparatorDefinition = {
  type: "separator";
};

export type MenuRecentFilesDefinition = {
  type: "recentFiles";
  label: string;
};

export type MenuEntryDefinition =
  | MenuLeafDefinition
  | MenuSeparatorDefinition
  | MenuRecentFilesDefinition;

export type MenuSectionDefinition = {
  id: string;
  label: string;
  entries: MenuEntryDefinition[];
};

const definition = sharedMenuDefinition as SharedMenuDefinition;

export const menuSections: MenuSectionDefinition[] = definition.sections.map(
  (section) => ({
    id: section.id,
    label: section.label,
    entries: section.entries.map((entry) => {
      if (entry.type !== "item") {
        return entry;
      }

      if (!isMenuActionId(entry.id)) {
        throw new Error(
          `Unknown menu action id: ${entry.id}. Valid ids: ${menuActionIds.join(", ")}`,
        );
      }

      return {
        type: "item",
        id: entry.id,
        label: entry.label,
      };
    }),
  }),
);

export const menuShortcuts: Partial<Record<MenuActionId, ShortcutDefinition>> =
  definition.sections.reduce<Partial<Record<MenuActionId, ShortcutDefinition>>>(
    (shortcuts, section) => {
      for (const entry of section.entries) {
        if (
          entry.type === "item" &&
          entry.shortcut &&
          isMenuActionId(entry.id)
        ) {
          shortcuts[entry.id] = entry.shortcut;
        }
      }
      return shortcuts;
    },
    {},
  );

function usesMacLabels() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const navigatorData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const platform =
    typeof navigatorData?.platform === "string"
      ? navigatorData.platform
      : navigator.userAgent;
  return /Mac|iPhone|iPad|iPod/.test(platform);
}

export function formatShortcut(definition: ShortcutDefinition) {
  const useMac = usesMacLabels();
  const keys: string[] = [];

  if (definition.ctrlOrMeta) {
    keys.push(useMac ? "⌘" : "Ctrl");
  }
  if (definition.shift) {
    keys.push(useMac ? "⇧" : "Shift");
  }
  if (definition.alt) {
    keys.push(useMac ? "⌥" : "Alt");
  }

  const keyLabel = definition.key.toUpperCase();
  keys.push(keyLabel);
  return useMac ? keys.join("") : keys.join("+");
}

export function getShortcutLabel(actionId: MenuActionId) {
  const definition = menuShortcuts[actionId];
  return definition ? formatShortcut(definition) : null;
}

function normalizeKey(key: string) {
  const lowered = key.toLowerCase();
  if (lowered === "esc") {
    return "escape";
  }
  return lowered;
}

export function resolveShortcutAction(
  event: KeyboardEvent,
): MenuActionId | null {
  const eventKey = normalizeKey(event.key);

  for (const [actionId, shortcut] of Object.entries(menuShortcuts) as [
    MenuActionId,
    ShortcutDefinition,
  ][]) {
    if (normalizeKey(shortcut.key) !== eventKey) {
      continue;
    }

    if (Boolean(shortcut.ctrlOrMeta) !== (event.ctrlKey || event.metaKey)) {
      continue;
    }

    if (Boolean(shortcut.shift) !== event.shiftKey) {
      continue;
    }

    if (Boolean(shortcut.alt) !== event.altKey) {
      continue;
    }

    return actionId;
  }

  return null;
}

export function formatRecentFileLabel(entry: RecentFileEntry) {
  return entry.path;
}
