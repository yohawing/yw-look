import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useViewportToolbarModel } from "../useViewportToolbarModel";
import { useViewerStore } from "../../stores/viewerStore";
import type { ToolbarAction, ToolbarItem } from "../../types/ui";
import { requestViewportCameraPreset } from "../../viewport/viewportCommands";

vi.mock("../../viewport/viewportCommands", () => ({
  requestViewportCameraPreset: vi.fn(() => true),
}));

function findAction(items: ToolbarItem[], id: string): ToolbarAction {
  for (const item of items) {
    if (item.kind === "separator" || item.kind === "status") continue;
    if (item.id === id) return item;
    if (item.children) {
      try {
        return findAction(item.children, id);
      } catch {
        // Keep searching siblings.
      }
    }
  }
  throw new Error(`Toolbar action not found: ${id}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  useViewerStore.setState({
    viewerSurfaceMode: "asset",
    showTexture: false,
    showWireframe: false,
    textureViewMode: "rgb",
    textureColorSpace: "srgb",
    textureGamma: 2.2,
  });
});

afterEach(() => {
  cleanup();
});

describe("useViewportToolbarModel", () => {
  it("derives display mode and updates 3D toolbar state through selectors", () => {
    const { result } = renderHook(() => useViewportToolbarModel());

    expect(result.current.displayMode).toBe("untextured");
    act(() => {
      findAction(
        result.current.viewportToolbarItems,
        "shading-texture",
      ).onRun?.();
    });

    expect(useViewerStore.getState().showTexture).toBe(true);
  });

  it("updates image toolbar state through viewer store actions", () => {
    useViewerStore.setState({ viewerSurfaceMode: "texture" });
    const { result } = renderHook(() => useViewportToolbarModel());

    act(() => {
      findAction(result.current.viewportToolbarItems, "channel-a").onRun?.();
      findAction(
        result.current.viewportToolbarItems,
        "colorspace-linear",
      ).onRun?.();
    });

    const state = useViewerStore.getState();
    expect(state.textureViewMode).toBe("alpha");
    expect(state.textureColorSpace).toBe("linear");
    expect(state.textureGamma).toBe(1);
  });

  it("tracks the active camera preset and requests runtime application every time", () => {
    const { result } = renderHook(() => useViewportToolbarModel());

    act(() => {
      findAction(result.current.viewportToolbarItems, "camera-front").onRun?.();
    });
    act(() => {
      findAction(result.current.viewportToolbarItems, "camera-front").onRun?.();
    });

    expect(requestViewportCameraPreset).toHaveBeenCalledTimes(2);
    expect(requestViewportCameraPreset).toHaveBeenNthCalledWith(1, "front");
    expect(requestViewportCameraPreset).toHaveBeenNthCalledWith(2, "front");
    expect(
      findAction(result.current.viewportToolbarItems, "camera-front").active,
    ).toBe(true);
  });

  it("does not mark a camera preset active when runtime application fails", () => {
    vi.mocked(requestViewportCameraPreset).mockReturnValueOnce(false);
    const { result } = renderHook(() => useViewportToolbarModel());

    act(() => {
      findAction(result.current.viewportToolbarItems, "camera-top").onRun?.();
    });

    expect(requestViewportCameraPreset).toHaveBeenCalledWith("top");
    expect(
      findAction(result.current.viewportToolbarItems, "camera-top").active,
    ).toBe(false);
  });
});
