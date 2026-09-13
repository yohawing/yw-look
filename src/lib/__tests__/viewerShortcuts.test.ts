import { afterEach, describe, expect, it } from "vitest";
import {
  applyViewerShortcutAction,
  getViewerShortcutHelpLines,
  isEditableShortcutTarget,
  resolveViewerShortcutAction,
  type ViewerShortcutState,
} from "../viewerShortcuts";
import { setLanguage } from "../i18n";
import type { DisplayMode } from "../../viewer";

function event(
  key: string,
  modifiers: Partial<KeyboardEvent> = {},
): Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"> {
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

afterEach(() => setLanguage("en"));

describe("viewer shortcut help", () => {
  it("resolves the current language on each opening while preserving physical keys", () => {
    setLanguage("en");
    const english = getViewerShortcutHelpLines();
    expect(english[0]).toBe("PageUp  File > Previous file");
    expect(english).toHaveLength(14);
    for (const [locale, expected] of [
      ["ja", "PageUp  ファイル > 前のファイル"],
      ["zh-Hans", "PageUp  文件 > 上一个文件"],
      ["ko", "PageUp  파일 > 이전 파일"],
    ]) {
      setLanguage(locale);
      const lines = getViewerShortcutHelpLines();
      expect(lines[0]).toBe(expected);
      expect(lines.map((line) => line.split("  ")[0])).toEqual(
        english.map((line) => line.split("  ")[0]),
      );
      expect(lines.every((line, index) => line !== english[index])).toBe(true);
      expect(lines.join("\n")).not.toContain("shortcuts.");
    }
  });
});

describe("viewer shortcuts", () => {
  it("maps F to focus selected", () => {
    const next = applyKey("f");
    expect(next.viewportCommand).toMatchObject({
      kind: "focusSelected",
      selectionKey: "/World/Cube",
    });
  });

  it("maps Home to frame all", () => {
    const next = applyKey("Home");
    expect(next.viewportCommand).toMatchObject({
      kind: "frameAll",
    });
  });

  it("maps R to reset view", () => {
    const next = applyKey("r");
    expect(next.viewportCommand).toMatchObject({
      kind: "resetView",
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
    });
  });

  it("maps Shift+H to isolate selected", () => {
    const next = applyKey("h", "textured", baseState(), { shiftKey: true });
    expect(next.viewportCommand).toMatchObject({
      kind: "isolateSelected",
      selectionKey: "/World/Cube",
    });
  });

  it("maps Alt+H to unhide all", () => {
    const next = applyKey("h", "textured", baseState(), { altKey: true });
    expect(next.viewportCommand).toMatchObject({
      kind: "unhideAll",
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
    editable.setAttribute("contenteditable", "true");
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
