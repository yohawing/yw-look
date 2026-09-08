import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useViewportToolbarModel } from "../useViewportToolbarModel";
import { useViewerStore } from "../../stores/viewerStore";
import { useFileStore } from "../../stores/fileStore";
import { Group, PerspectiveCamera } from "three";
import { collectAssetMetadata } from "../../viewer/metadata";
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
  useFileStore.setState({ assetMetadata: null });
  useViewerStore.setState({
    activeCameraId: null,
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
  it("selects distinct authored cameras, returns to free view, and removes options on file change", () => {
    const root = new Group();
    const first = new PerspectiveCamera();
    const second = new PerspectiveCamera();
    first.name = second.name = "Shot";
    root.add(first, second);
    const metadata = collectAssetMetadata(
      root,
      {
        path: "/camera.glb",
        fileName: "camera.glb",
        extension: "glb",
        kind: "model",
        parentDirectory: "/",
      },
      [],
      null,
    ).metadata;
    useFileStore.setState({ assetMetadata: metadata });
    const { result } = renderHook(() => useViewportToolbarModel());
    const action = (id: string) =>
      findAction(result.current.viewportToolbarItems, id);
    const [a, b] = metadata.cameras;
    expect(a.id).not.toBe(b.id);
    act(() => action(`camera-asset:${a.id}`).onRun?.());
    expect(useViewerStore.getState().activeCameraId).toBe(a.id);
    expect(action(`camera-asset:${a.id}`).active).toBe(true);
    act(() => action(`camera-asset:${b.id}`).onRun?.());
    expect(useViewerStore.getState().activeCameraId).toBe(b.id);
    expect(requestViewportCameraPreset).not.toHaveBeenCalled();
    act(() => action("camera-free").onRun?.());
    expect(useViewerStore.getState().activeCameraId).toBeNull();
    expect(action("camera-free").active).toBe(true);
    act(() => action(`camera-asset:${a.id}`).onRun?.());
    act(() => action("camera-front").onRun?.());
    expect(useViewerStore.getState().activeCameraId).toBeNull();
    expect(requestViewportCameraPreset).toHaveBeenCalledWith("front");
    expect(action("camera-front").active).toBe(true);
    act(() => useFileStore.setState({ assetMetadata: null }));
    expect(() => action(`camera-asset:${a.id}`)).toThrow(
      "Toolbar action not found",
    );
    expect(() => action("camera-free")).toThrow("Toolbar action not found");
  });
  it("connects Lighting controls to persistent viewer settings and reflects None", () => {
    useViewerStore.setState({
      environmentPreset: "studio",
      environmentRotation: 0,
      showEnvironmentBackground: false,
      showShadows: false,
    });
    const { result } = renderHook(() => useViewportToolbarModel());
    const action = (id: string) =>
      findAction(result.current.viewportToolbarItems, id);
    act(() => action("environment-outdoor").onRun?.());
    act(() => {
      const rotation = action("environment-rotation");
      if (rotation.kind !== "slider")
        throw new Error("Expected rotation slider");
      rotation.onValueChange(90);
      action("environment-background").onRun?.();
      action("lighting-shadows").onRun?.();
    });
    expect(useViewerStore.getState()).toMatchObject({
      environmentPreset: "outdoor",
      environmentRotation: Math.PI / 2,
      showEnvironmentBackground: true,
      showShadows: true,
    });
    expect(action("environment-rotation")).toMatchObject({
      value: 90,
      disabled: false,
    });
    act(() => action("environment-none").onRun?.());
    expect(action("environment-none").active).toBe(true);
    expect(action("environment-background")).toMatchObject({
      active: false,
      disabled: true,
    });
    expect(action("environment-rotation").disabled).toBe(true);
    expect(useViewerStore.getState().showEnvironmentBackground).toBe(true);
    act(() => action("environment-studio").onRun?.());
    expect(action("environment-background")).toMatchObject({
      active: true,
      disabled: false,
    });
    expect(action("environment-rotation")).toMatchObject({ value: 90 });
    act(() => {
      const rotation = action("environment-rotation");
      if (rotation.kind === "slider") rotation.onValueChange(360);
    });
    expect(action("environment-rotation")).toMatchObject({
      value: 360,
      valueLabel: "360°",
    });
  });
  it("updates the vertex color status when files change while the mode stays active", () => {
    const metadata = collectAssetMetadata(
      new Group(),
      {
        path: "/test.glb",
        fileName: "test.glb",
        extension: "glb",
        kind: "model",
        parentDirectory: "/",
      },
      [],
      null,
    ).metadata;
    useFileStore.setState({ assetMetadata: metadata });
    useViewerStore.setState({
      showVertexColors: true,
      showNormals: false,
      showUnlit: false,
    });
    const { result } = renderHook(() => useViewportToolbarModel());
    const status = () =>
      findAction(result.current.viewportToolbarItems, "display").children?.find(
        (item) => item.kind === "status" && item.id === "vertex-color-status",
      );
    expect(status()).toMatchObject({
      label: "No vertex colors. Meshes are shown gray.",
    });
    act(() =>
      useFileStore.setState({
        assetMetadata: { ...metadata, vertexColorMeshCount: 1 },
      }),
    );
    expect(status()).toMatchObject({
      label: "Meshes without vertex colors are shown gray.",
    });
    expect(
      findAction(result.current.viewportToolbarItems, "display-vertexColor")
        .active,
    ).toBe(true);
    act(() =>
      findAction(
        result.current.viewportToolbarItems,
        "display-shaded",
      ).onRun?.(),
    );
    expect(status()).toBeUndefined();
  });
  it("derives display mode and updates 3D toolbar state through selectors", () => {
    const { result } = renderHook(() => useViewportToolbarModel());

    expect(result.current.displayMode).toBe("untextured");
    act(() => {
      findAction(
        result.current.viewportToolbarItems,
        "display-shaded",
      ).onRun?.();
    });

    expect(useViewerStore.getState().showTexture).toBe(true);
    expect(useViewerStore.getState().showUnlit).toBe(false);
    expect(useViewerStore.getState().showNormals).toBe(false);
    expect(useViewerStore.getState().showVertexColors).toBe(false);
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
