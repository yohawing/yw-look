import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useViewportHostViewerModel } from "../useViewportHostViewerModel";
import { useViewerStore } from "../../stores/viewerStore";

beforeEach(() => {
  useViewerStore.setState({
    selectedUsdPrimPath: null,
    showGrid: true,
    viewerFeedback: {
      mode: "ready",
      message: "Preview ready.",
      warning: null,
      canResetCamera: true,
    },
    viewerSurfaceMode: "asset",
  });
});

afterEach(() => {
  cleanup();
});

describe("useViewportHostViewerModel", () => {
  it("returns the viewer state required by ViewportHost", () => {
    const { result } = renderHook(() => useViewportHostViewerModel());

    expect(result.current.showGrid).toBe(true);
    expect(result.current.viewerSurfaceMode).toBe("asset");
    expect(result.current.usdLoadPolicy).toBe("loadAll");
    expect(result.current.actions).toBeDefined();
  });

  it("updates when a subscribed viewport field changes", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useViewportHostViewerModel();
    });

    act(() => {
      useViewerStore.setState({ showGrid: false });
    });

    expect(result.current.showGrid).toBe(false);
    expect(renders).toBe(2);
  });

  it("does not update for viewer fields outside the host viewport slice", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useViewportHostViewerModel();
    });
    const previous = result.current;

    act(() => {
      useViewerStore.setState({ selectedUsdPrimPath: "/World/Cube" });
    });

    expect(result.current).toBe(previous);
    expect(renders).toBe(1);
  });

  it("writes through stable actions without subscribing to action fields", () => {
    const { result } = renderHook(() => useViewportHostViewerModel());
    const actions = result.current.actions;

    act(() => {
      result.current.actions.setViewerSurfaceMode("texture");
    });

    expect(useViewerStore.getState().viewerSurfaceMode).toBe("texture");
    expect(result.current.actions).toBe(actions);
  });
});
