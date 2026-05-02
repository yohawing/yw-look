import { describe, expect, it } from "vitest";
import {
  applyViewerShortcutAction,
  isEditableShortcutTarget,
  resolveViewerShortcutAction,
  type ViewerShortcutState,
} from "../viewerShortcuts";
import type { DisplayMode } from "../../viewer";

function event(
  key: string,
  modifiers: Partial<KeyboardEvent> = {},
): Pick<
  KeyboardEvent,
  "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
> {
  return {
    key,
    altKey: Boolean(modifiers.altKey),
    ctrlKey: Boolean(modifiers.ctrlKey),
    metaKey: Boolean(modifiers.metaKey),
    shiftKey: Boolean(modifiers.shiftKey),
  };
}

function baseState(
  overrides: Partial<ViewerShortcutState> = {},
): ViewerShortcutState {
  return {
    showTexture: true,
    showWireframe: false,
    showGrid: true,
    selectedMeshName: "/World/Cube",
    selectedUsdPrimPath: "/World/Cube",
    viewportCommand: null,
    ...overrides,
  };
}

function applyKey(
  key: string,
  displayMode: DisplayMode = "textured",
  state = baseState(),
  modifiers: Partial<KeyboardEvent> = {},
) {
  const action = resolveViewerShortcutAction(event(key, modifiers));
  if (!action) {
    throw new Error(`Expected ${key} to resolve to a viewer shortcut action.`);
  }
  return applyViewerShortcutAction(state, action, displayMode);
}

describe("viewer shortcuts", () => {
  it("maps F to focus selected", () => {
    const next = applyKey("f");
    expect(next.viewportCommand).toMatchObject({
      kind: "focusSelected",
      selectionKey: "/World/Cube",
      version: 1,
    });
  });

  it("maps Home to frame all", () => {
    const next = applyKey("Home");
    expect(next.viewportCommand).toMatchObject({
      kind: "frameAll",
      version: 1,
    });
  });

  it("maps R to reset view", () => {
    const next = applyKey("r");
    expect(next.viewportCommand).toMatchObject({
      kind: "resetView",
      version: 1,
    });
  });

  it("maps Esc to clear selection", () => {
    const next = applyKey("Escape");
    expect(next.selectedMeshName).toBeNull();
    expect(next.selectedUsdPrimPath).toBeNull();
  });

  it("maps H to hide selected", () => {
    const next = applyKey("h");
    expect(next.viewportCommand).toMatchObject({
      kind: "hideSelected",
      selectionKey: "/World/Cube",
      version: 1,
    });
  });

  it("maps Shift+H to isolate selected", () => {
    const next = applyKey("h", "textured", baseState(), { shiftKey: true });
    expect(next.viewportCommand).toMatchObject({
      kind: "isolateSelected",
      selectionKey: "/World/Cube",
      version: 1,
    });
  });

  it("maps Alt+H to unhide all", () => {
    const next = applyKey("h", "textured", baseState(), { altKey: true });
    expect(next.viewportCommand).toMatchObject({
      kind: "unhideAll",
      version: 1,
    });
  });

  it("maps Z to cycle display mode", () => {
    const next = applyKey("z");
    expect(next.showTexture).toBe(false);
    expect(next.showWireframe).toBe(false);
  });

  it("maps G to toggle grid", () => {
    const next = applyKey("g");
    expect(next.showGrid).toBe(false);
  });

  it("ignores editable shortcut targets", () => {
    expect(isEditableShortcutTarget(document.createElement("input"))).toBe(
      true,
    );
    expect(isEditableShortcutTarget(document.createElement("textarea"))).toBe(
      true,
    );

    const editable = document.createElement("div");
    editable.contentEditable = "true";
    expect(isEditableShortcutTarget(editable)).toBe(true);
  });

  it("does not steal modified editing shortcuts", () => {
    expect(resolveViewerShortcutAction(event("f", { ctrlKey: true }))).toBe(
      null,
    );
    expect(resolveViewerShortcutAction(event("z", { metaKey: true }))).toBe(
      null,
    );
  });
});
