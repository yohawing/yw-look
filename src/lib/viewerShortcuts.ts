import type { DisplayMode } from "../viewer";

export type ViewerShortcutAction =
  | "focusSelected"
  | "frameAll"
  | "resetView"
  | "clearSelection"
  | "hideSelected"
  | "isolateSelected"
  | "unhideAll"
  | "cycleDisplayMode"
  | "toggleGrid";

export type ViewportShortcutCommand =
  | { kind: "focusSelected"; selectionKey: string; version: number }
  | { kind: "frameAll"; version: number }
  | { kind: "resetView"; version: number }
  | { kind: "hideSelected"; selectionKey: string; version: number }
  | { kind: "isolateSelected"; selectionKey: string; version: number }
  | { kind: "unhideAll"; version: number };

export type ViewerShortcutState = {
  showTexture: boolean;
  showWireframe: boolean;
  showGrid: boolean;
  selectedMeshName: string | null;
  selectedUsdPrimPath: string | null;
  viewportCommand: ViewportShortcutCommand | null;
};

export const viewerShortcutHelpLines = [
  "F  View > Focus selected",
  "Home  View > Frame all",
  "R  View > Reset view",
  "Esc  Selection > Clear selection",
  "H  Visibility > Hide selected",
  "Shift+H  Visibility > Isolate selected",
  "Alt+H  Visibility > Unhide all",
  "Z  Display > Cycle display mode",
  "G  Display > Toggle grid",
];

type KeyboardShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
>;

const displayModeCycle: DisplayMode[] = [
  "textured",
  "untextured",
  "wireframe",
  "texturedWireframe",
];

function shortcutKey(event: KeyboardShortcutEvent) {
  const key = event.key.toLowerCase();
  return key === "esc" ? "escape" : key;
}

function hasOnlyModifiers(
  event: KeyboardShortcutEvent,
  modifiers: { alt?: boolean; shift?: boolean } = {},
) {
  return (
    !event.ctrlKey &&
    !event.metaKey &&
    event.altKey === Boolean(modifiers.alt) &&
    event.shiftKey === Boolean(modifiers.shift)
  );
}

export function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const contentEditableHost = target.closest(
    "[contenteditable=''], [contenteditable='true']",
  );

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable ||
    contentEditableHost !== null
  );
}

export function resolveViewerShortcutAction(
  event: KeyboardShortcutEvent,
): ViewerShortcutAction | null {
  const key = shortcutKey(event);

  if (key === "h" && hasOnlyModifiers(event, { shift: true })) {
    return "isolateSelected";
  }

  if (key === "h" && hasOnlyModifiers(event, { alt: true })) {
    return "unhideAll";
  }

  if (!hasOnlyModifiers(event)) {
    return null;
  }

  switch (key) {
    case "f":
      return "focusSelected";
    case "home":
      return "frameAll";
    case "r":
      return "resetView";
    case "escape":
      return "clearSelection";
    case "h":
      return "hideSelected";
    case "z":
      return "cycleDisplayMode";
    case "g":
      return "toggleGrid";
    default:
      return null;
  }
}

export function deriveDisplayFlags(displayMode: DisplayMode) {
  return {
    showTexture:
      displayMode === "textured" || displayMode === "texturedWireframe",
    showWireframe:
      displayMode === "wireframe" || displayMode === "texturedWireframe",
  };
}

export function cycleDisplayMode(current: DisplayMode): DisplayMode {
  const index = displayModeCycle.indexOf(current);
  return displayModeCycle[(index + 1) % displayModeCycle.length] ?? "textured";
}

function nextCommandVersion(command: ViewportShortcutCommand | null) {
  return (command?.version ?? 0) + 1;
}

export function applyViewerShortcutAction(
  state: ViewerShortcutState,
  action: ViewerShortcutAction,
  displayMode: DisplayMode,
): ViewerShortcutState {
  switch (action) {
    case "focusSelected":
      if (!state.selectedMeshName) return state;
      return {
        ...state,
        viewportCommand: {
          kind: "focusSelected",
          selectionKey: state.selectedMeshName,
          version: nextCommandVersion(state.viewportCommand),
        },
      };
    case "frameAll":
      return {
        ...state,
        viewportCommand: {
          kind: "frameAll",
          version: nextCommandVersion(state.viewportCommand),
        },
      };
    case "resetView":
      return {
        ...state,
        viewportCommand: {
          kind: "resetView",
          version: nextCommandVersion(state.viewportCommand),
        },
      };
    case "clearSelection":
      return {
        ...state,
        selectedMeshName: null,
        selectedUsdPrimPath: null,
      };
    case "hideSelected":
      if (!state.selectedMeshName) return state;
      return {
        ...state,
        viewportCommand: {
          kind: "hideSelected",
          selectionKey: state.selectedMeshName,
          version: nextCommandVersion(state.viewportCommand),
        },
      };
    case "isolateSelected":
      if (!state.selectedMeshName) return state;
      return {
        ...state,
        viewportCommand: {
          kind: "isolateSelected",
          selectionKey: state.selectedMeshName,
          version: nextCommandVersion(state.viewportCommand),
        },
      };
    case "unhideAll":
      return {
        ...state,
        viewportCommand: {
          kind: "unhideAll",
          version: nextCommandVersion(state.viewportCommand),
        },
      };
    case "cycleDisplayMode": {
      const next = deriveDisplayFlags(cycleDisplayMode(displayMode));
      return {
        ...state,
        showTexture: next.showTexture,
        showWireframe: next.showWireframe,
      };
    }
    case "toggleGrid":
      return {
        ...state,
        showGrid: !state.showGrid,
      };
  }
}
