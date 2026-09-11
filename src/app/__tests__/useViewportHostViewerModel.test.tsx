import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveViewportMaterialNavigation,
  useViewportHostViewerModel,
} from "../useViewportHostViewerModel";
import { useViewerStore } from "../../stores/viewerStore";
import type { SelectedFile } from "../../lib/files";
import type {
  AssetMetadata,
  MaterialEntry,
  ObjectInfo,
} from "../../types/viewer";

const usdFile: SelectedFile = {
  path: "C:/assets/scene.usda",
  fileName: "scene.usda",
  extension: "usda",
  kind: "model",
  parentDirectory: "C:/assets",
};

const usdMaterial: MaterialEntry = {
  id: "mat-usd",
  name: "Paint",
  type: "UsdPreviewSurface",
  color: null,
  opacity: 1,
  transparent: false,
  textureCount: 0,
  boundMeshes: ["/World/Mesh"],
  baseColorFactor: null,
  metallicFactor: null,
  roughnessFactor: null,
  emissiveFactor: null,
  baseColorTexture: null,
  metallicRoughnessTexture: null,
  normalTexture: null,
  emissiveTexture: null,
  alphaMode: "OPAQUE",
  usdPrimPath: "/World/Looks/Paint",
  mmd: null,
};

function objectInfo(materialIds: string[]): ObjectInfo {
  return {
    name: "Mesh",
    kind: "Mesh",
    visible: true,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    boundingBox: null,
    vertexCount: 3,
    triangleCount: 1,
    materialNames: [],
    materialIds,
    morphTargets: [],
    childCount: 0,
    animatesWithClips: [],
    userData: null,
    mmdBone: null,
  };
}

function metadata(
  materialIds: string[],
  material = usdMaterial,
): AssetMetadata {
  return {
    formatLabel: "USD",
    formatVersion: null,
    nodeCount: 1,
    meshCount: 1,
    materialCount: 1,
    textureCount: 0,
    hasAnimation: false,
    hierarchy: [],
    textures: [],
    materials: [material],
    lights: [],
    cameras: [],
    objectInfo: { "/World/Mesh": objectInfo(materialIds) },
  };
}

beforeEach(() => {
  useViewerStore.setState({
    materialNavigationRequest: null,
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
  it("resolves only an authored USD material from an unambiguous viewport selection", () => {
    expect(
      resolveViewportMaterialNavigation(
        usdFile,
        metadata(["mat-usd"]),
        "/World/Mesh",
      ),
    ).toBe("mat-usd");

    const glbFile = { ...usdFile, extension: "glb", fileName: "scene.glb" };
    expect(
      resolveViewportMaterialNavigation(
        glbFile,
        metadata(["mat-usd"]),
        "/World/Mesh",
      ),
    ).toBeNull();
    expect(
      resolveViewportMaterialNavigation(
        usdFile,
        metadata(["mat-usd", "other"]),
        "/World/Mesh",
      ),
    ).toBeNull();
    expect(
      resolveViewportMaterialNavigation(
        usdFile,
        metadata(["unknown"]),
        "/World/Mesh",
      ),
    ).toBeNull();
    expect(
      resolveViewportMaterialNavigation(
        usdFile,
        metadata(["mat-usd"], { ...usdMaterial, usdPrimPath: null }),
        "/World/Mesh",
      ),
    ).toBeNull();
    expect(
      resolveViewportMaterialNavigation(
        usdFile,
        metadata(["mat-usd"]),
        "/World/Missing",
      ),
    ).toBeNull();
  });

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

  it("increments material navigation revisions for repeated requests", () => {
    const { result } = renderHook(() => useViewportHostViewerModel());

    act(() => {
      result.current.actions.requestMaterialNavigation("mat-usd");
      result.current.actions.requestMaterialNavigation("mat-usd");
    });

    expect(useViewerStore.getState().materialNavigationRequest).toEqual({
      materialId: "mat-usd",
      revision: 2,
    });
  });
});
