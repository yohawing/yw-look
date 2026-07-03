import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAppCommands } from "../useAppCommands";
import { useViewerStore } from "../../stores/viewerStore";
import {
  requestViewportCameraReset,
  requestViewportShortcutCommand,
} from "../../viewport/viewportCommands";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(() => Promise.resolve("0.0.0-test")),
}));

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

function renderCommands() {
  return renderHook(() =>
    useAppCommands({
      canNavigateNext: false,
      canNavigatePrev: false,
      directoryListing: null,
      handleOpenFile: vi.fn(() => Promise.resolve()),
      isTauri: false,
      performSelectFilePath: vi.fn(() => Promise.resolve()),
    }),
  );
}

function pressKey(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, ...init }));
  });
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
});
