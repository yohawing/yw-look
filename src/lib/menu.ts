import type { RecentFileEntry } from "./recentFiles";

export type MenuActionId =
  | "file.open"
  | "file.exit"
  | "view.toggleTexture"
  | "view.toggleWireframe"
  | "view.toggleGrid"
  | "view.resetCamera"
  | "view.toggleSidebar"
  | "window.toggleFullscreen"
  | "app.openSettings"
  | "help.shortcuts"
  | "help.about";

export type ShortcutDefinition = {
  key: string;
  ctrlOrMeta?: boolean;
  shift?: boolean;
  alt?: boolean;
};

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

export const menuSections: MenuSectionDefinition[] = [
  {
    id: "file",
    label: "File",
    entries: [
      { type: "item", id: "file.open", label: "Open" },
      { type: "recentFiles", label: "Recent Files" },
      { type: "separator" },
      { type: "item", id: "file.exit", label: "Exit" },
    ],
  },
  {
    id: "view",
    label: "View",
    entries: [
      { type: "item", id: "view.toggleTexture", label: "Toggle Texture" },
      { type: "item", id: "view.toggleWireframe", label: "Toggle Wireframe" },
      { type: "item", id: "view.toggleGrid", label: "Toggle Grid" },
      { type: "separator" },
      { type: "item", id: "view.resetCamera", label: "Reset Camera" },
      { type: "item", id: "view.toggleSidebar", label: "Toggle Sidebar" },
    ],
  },
  {
    id: "window",
    label: "Window",
    entries: [
      {
        type: "item",
        id: "window.toggleFullscreen",
        label: "Toggle Fullscreen",
      },
      { type: "item", id: "app.openSettings", label: "Open Settings" },
    ],
  },
  {
    id: "help",
    label: "Help",
    entries: [
      { type: "item", id: "help.shortcuts", label: "Shortcuts" },
      { type: "item", id: "help.about", label: "About" },
    ],
  },
];

export const menuShortcuts: Partial<Record<MenuActionId, ShortcutDefinition>> =
  {
    "file.open": { key: "o", ctrlOrMeta: true },
    "file.exit": { key: "q", ctrlOrMeta: true },
    "window.toggleFullscreen": { key: "f11" },
    "view.toggleTexture": { key: "1", ctrlOrMeta: true },
    "view.toggleWireframe": { key: "2", ctrlOrMeta: true },
    "view.toggleGrid": { key: "3", ctrlOrMeta: true },
    "view.resetCamera": { key: "r", ctrlOrMeta: true },
    "view.toggleSidebar": { key: "b", ctrlOrMeta: true },
    "app.openSettings": { key: ",", ctrlOrMeta: true },
  };

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
