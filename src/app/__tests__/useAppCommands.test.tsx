import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAppCommands } from "../useAppCommands";
import { useViewerStore } from "../../stores/viewerStore";
import type { DirectoryListing, SelectedFile } from "../../types/file";
import {
  requestViewportCameraReset,
  requestViewportShortcutCommand,
} from "../../viewport/viewportCommands";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    close: vi.fn(() => Promise.resolve()),
    isFullscreen: vi.fn(() => Promise.resolve(false)),
    setFullscreen: vi.fn(() => Promise.resolve()),
  })),
}));

vi.mock("../../viewport/viewportCommands", () => ({
  requestViewportCameraReset: vi.fn(() => true),
  requestViewportShortcutCommand: vi.fn(() => true),
}));

function selected(path: string): SelectedFile {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  return {
    path,
    fileName,
    extension: fileName.split(".").pop()?.toLowerCase() ?? "",
    kind: "model",
    parentDirectory: "C:\\assets",
  };
}

type CommandOverrides = Partial<
  Pick<
    Parameters<typeof useAppCommands>[0],
    "canNavigateNext" | "canNavigatePrev" | "directoryListing"
  >
> & {
  performSelectFilePath?: (path: string, reason: "navigation") => Promise<void>;
};

function renderCommands(overrides: CommandOverrides = {}) {
  const performSelectFilePath =
    overrides.performSelectFilePath ?? vi.fn(() => Promise.resolve());
  return {
    ...renderHook(() =>
      useAppCommands({
        canNavigateNext: overrides.canNavigateNext ?? false,
        canNavigatePrev: overrides.canNavigatePrev ?? false,
        directoryListing: overrides.directoryListing ?? null,
        handleOpenFile: vi.fn(() => Promise.resolve()),
        isTauri: false,
        performSelectFilePath,
      }),
    ),
    performSelectFilePath,
  };
}

function pressKey(
  key: string,
  init: KeyboardEventInit = {},
  target: EventTarget = window,
) {
  let event!: KeyboardEvent;
  act(() => {
    event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  useViewerStore.setState({
    activeCameraId: "camera-a",
    selectedMeshName: "MeshA",
    selectedUsdPrimPath: "/Root/MeshA",
    showGrid: true,
    showTexture: true,
    showWireframe: false,
  });
});

afterEach(() => {
  cleanup();
});

describe("useAppCommands", () => {
  it("dispatches repeated viewer shortcuts directly to the viewport command registry", () => {
    renderCommands();

    pressKey("f");
    pressKey("f");

    expect(requestViewportShortcutCommand).toHaveBeenCalledTimes(2);
    expect(requestViewportShortcutCommand).toHaveBeenNthCalledWith(1, {
      kind: "focusSelected",
      selectionKey: "MeshA",
    });
    expect(requestViewportShortcutCommand).toHaveBeenNthCalledWith(2, {
      kind: "focusSelected",
      selectionKey: "MeshA",
    });
    expect(useViewerStore.getState().activeCameraId).toBeNull();
  });

  it("routes menu camera reset through the viewport command registry", () => {
    renderCommands();

    pressKey("r", { ctrlKey: true });
    pressKey("r", { ctrlKey: true });

    expect(requestViewportCameraReset).toHaveBeenCalledTimes(2);
    expect(requestViewportShortcutCommand).not.toHaveBeenCalled();
  });

  it("uses unmodified PageUp and PageDown for sibling file navigation", () => {
    const performSelectFilePath = vi.fn(() => Promise.resolve());
    const directoryListing: DirectoryListing = {
      files: [
        selected("C:\\assets\\previous.glb"),
        selected("C:\\assets\\current.glb"),
        selected("C:\\assets\\next.glb"),
      ],
      currentIndex: 1,
    };
    renderCommands({
      canNavigatePrev: true,
      canNavigateNext: true,
      directoryListing,
      performSelectFilePath,
    });

    const previousEvent = pressKey("PageUp");
    const nextEvent = pressKey("PageDown");
    pressKey("ArrowLeft");
    pressKey("ArrowRight");

    expect(performSelectFilePath).toHaveBeenNthCalledWith(
      1,
      "C:\\assets\\previous.glb",
      "navigation",
    );
    expect(performSelectFilePath).toHaveBeenNthCalledWith(
      2,
      "C:\\assets\\next.glb",
      "navigation",
    );
    expect(performSelectFilePath).toHaveBeenCalledTimes(2);
    expect(previousEvent.defaultPrevented).toBe(true);
    expect(nextEvent.defaultPrevented).toBe(true);
  });

  it("ignores modified, composing, and already-consumed file navigation keys", () => {
    const performSelectFilePath = vi.fn(() => Promise.resolve());
    renderCommands({
      canNavigatePrev: false,
      canNavigateNext: true,
      directoryListing: {
        files: [
          selected("C:\\assets\\previous.glb"),
          selected("C:\\assets\\next.glb"),
        ],
        currentIndex: 0,
      },
      performSelectFilePath,
    });

    for (const modifier of [
      { shiftKey: true },
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
    ]) {
      pressKey("PageUp", modifier);
    }
    pressKey("PageUp", { isComposing: true });

    const alreadyConsumed = new KeyboardEvent("keydown", {
      key: "PageDown",
      cancelable: true,
    });
    alreadyConsumed.preventDefault();
    act(() => {
      window.dispatchEvent(alreadyConsumed);
    });

    expect(performSelectFilePath).not.toHaveBeenCalled();
    expect(alreadyConsumed.defaultPrevented).toBe(true);
  });

  it("does not steal Page navigation from editable or interactive targets", () => {
    const performSelectFilePath = vi.fn(() => Promise.resolve());
    renderCommands({
      canNavigatePrev: false,
      canNavigateNext: true,
      directoryListing: {
        files: [
          selected("C:\\assets\\previous.glb"),
          selected("C:\\assets\\next.glb"),
        ],
        currentIndex: 0,
      },
      performSelectFilePath,
    });

    const targets: HTMLElement[] = [
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("select"),
      document.createElement("button"),
    ];
    const link = document.createElement("a");
    link.href = "#details";
    targets.push(link);
    const contentEditable = document.createElement("div");
    contentEditable.setAttribute("contenteditable", "true");
    targets.push(contentEditable);
    const combobox = document.createElement("div");
    combobox.setAttribute("role", "combobox");
    targets.push(combobox);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    targets.push(dialog);

    for (const target of targets) {
      document.body.appendChild(target);
      const event = pressKey("PageDown", {}, target);
      expect(event.defaultPrevented).toBe(false);
      target.remove();
    }

    expect(performSelectFilePath).not.toHaveBeenCalled();

    const readonlyInput = document.createElement("input");
    readonlyInput.readOnly = true;
    document.body.appendChild(readonlyInput);
    const readonlyEvent = pressKey("PageDown", {}, readonlyInput);
    readonlyInput.remove();

    expect(readonlyEvent.defaultPrevented).toBe(false);
    expect(performSelectFilePath).not.toHaveBeenCalled();
  });
});
