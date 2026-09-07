import { deriveDisplayFlags, type DisplayMode } from "../types/viewer";

import type {
  ViewerShortcutAction,
  ViewerShortcutResult,
  ViewerShortcutState,
} from "../types/ui";

export type {
  ViewerShortcutAction,
  ViewportShortcutCommand,
  ViewerShortcutResult,
  ViewerShortcutState,
} from "../types/ui";

export const viewerShortcutHelpLines = [
  "PageUp  File > Previous file",
  "PageDown  File > Next file",
  "Space  Playback > Play / pause",
  "ArrowLeft / ArrowRight  Playback > Step frame",
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
  const contentEditable = target.contentEditable?.toLowerCase();

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable ||
    contentEditable === "true" ||
    contentEditable === "" ||
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

export function cycleDisplayMode(current: DisplayMode): DisplayMode {
  const index = displayModeCycle.indexOf(current);
  return displayModeCycle[(index + 1) % displayModeCycle.length] ?? "textured";
}

export function applyViewerShortcutAction(
  state: ViewerShortcutState,
  action: ViewerShortcutAction,
  displayMode: DisplayMode,
): ViewerShortcutResult {
  switch (action) {
    case "focusSelected":
      if (!state.selectedMeshName) {
        return { ...state, viewportCommand: null };
      }
      return {
        ...state,
        viewportCommand: {
          kind: "focusSelected",
          selectionKey: state.selectedMeshName,
        },
      };
    case "frameAll":
      return {
        ...state,
        viewportCommand: {
          kind: "frameAll",
        },
      };
    case "resetView":
      return {
        ...state,
        viewportCommand: {
          kind: "resetView",
        },
      };
    case "clearSelection":
      return {
        ...state,
        selectedMeshName: null,
        selectedUsdPrimPath: null,
        viewportCommand: null,
      };
    case "hideSelected":
      if (!state.selectedMeshName) {
        return { ...state, viewportCommand: null };
      }
      return {
        ...state,
        viewportCommand: {
          kind: "hideSelected",
          selectionKey: state.selectedMeshName,
        },
      };
    case "isolateSelected":
      if (!state.selectedMeshName) {
        return { ...state, viewportCommand: null };
      }
      return {
        ...state,
        viewportCommand: {
          kind: "isolateSelected",
          selectionKey: state.selectedMeshName,
        },
      };
    case "unhideAll":
      return {
        ...state,
        viewportCommand: {
          kind: "unhideAll",
        },
      };
    case "cycleDisplayMode": {
      const next = deriveDisplayFlags(cycleDisplayMode(displayMode));
      return {
        ...state,
        showTexture: next.showTexture,
        showWireframe: next.showWireframe,
        viewportCommand: null,
      };
    }
    case "toggleGrid":
      return {
        ...state,
        showGrid: !state.showGrid,
        viewportCommand: null,
      };
  }
}
