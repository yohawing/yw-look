import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { HierarchySidebarPanel } from "../HierarchySidebarPanel";
import { useFileStore } from "../../stores/fileStore";
import { useViewerStore } from "../../stores/viewerStore";
import type { SelectedFile } from "../../lib/files";
import type {
  AssetMetadata,
  HierarchyNode,
  ObjectInfo,
} from "../assetMetadata";

vi.mock("../UsdPrimPropertyPanel", () => ({
  UsdPrimPropertyPanel: ({ path }: { path: string | null }) => (
    <div data-testid="usd-prim-panel">{path}</div>
  ),
}));

const usdFile: SelectedFile = {
  path: "F:\\assets\\scene.usda",
  fileName: "scene.usda",
  extension: "usda",
  kind: "model",
  parentDirectory: "F:\\assets",
};

const faceInfo: ObjectInfo = {
  name: "Face",
  kind: "mesh",
  visible: true,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  boundingBox: null,
  vertexCount: null,
  triangleCount: null,
  materialNames: [],
  materialIds: [],
  morphTargets: [{ index: 0, name: "blink_L", value: 0, mmd: null }],
  childCount: null,
  animatesWithClips: [],
  userData: null,
  mmdBone: null,
};

beforeEach(() => {
  useFileStore.setState({
    currentFile: null,
    directoryListing: null,
    assetInspection: null,
    assetMetadata: null,
    packFileRequest: null,
    openError: null,
  });
  useViewerStore.setState({
    selectedMeshName: null,
    selectedUsdPrimPath: null,
    morphTargetValues: {},
  });
});

afterEach(() => {
  cleanup();
});

function makeMetadata({
  hierarchy,
  objectInfo = {},
}: {
  hierarchy: HierarchyNode[];
  objectInfo?: AssetMetadata["objectInfo"];
}): AssetMetadata {
  return {
    formatLabel: "Test",
    formatVersion: null,
    nodeCount: hierarchy.length,
    meshCount: 0,
    materialCount: 0,
    textureCount: 0,
    hasAnimation: false,
    hierarchy,
    textures: [],
    materials: [],
    lights: [],
    cameras: [],
    objectInfo,
  };
}

describe("HierarchySidebarPanel", () => {
  it("selects a hierarchy row through the viewer store", () => {
    const hierarchy: HierarchyNode[] = [
      { name: "Face", kind: "mesh", children: [] },
    ];
    useFileStore.setState({
      assetMetadata: makeMetadata({
        hierarchy,
        objectInfo: { Face: faceInfo },
      }),
    });
    const { container } = render(
      <HierarchySidebarPanel
        stageSessionHandle={null}
        payloadPrimPaths={new Set()}
        unloadedPayloadPaths={new Set()}
        onLoadPayload={vi.fn()}
        onUnloadPayload={vi.fn()}
      />,
    );

    fireEvent.click(container.querySelector(".tree-row")!);

    expect(useViewerStore.getState().selectedMeshName).toBe("Face");
  });

  it("updates selected USD prim path only for USD files", () => {
    const hierarchy: HierarchyNode[] = [
      {
        name: "Hero",
        kind: "mesh",
        primPath: "/World/Hero",
        children: [],
      },
    ];
    useFileStore.setState({
      currentFile: usdFile,
      assetMetadata: makeMetadata({
        hierarchy,
        objectInfo: { "/World/Hero": faceInfo },
      }),
    });
    const { container } = render(
      <HierarchySidebarPanel
        stageSessionHandle={null}
        payloadPrimPaths={new Set()}
        unloadedPayloadPaths={new Set()}
        onLoadPayload={vi.fn()}
        onUnloadPayload={vi.fn()}
      />,
    );

    fireEvent.click(container.querySelector(".tree-row")!);

    expect(useViewerStore.getState().selectedUsdPrimPath).toBe("/World/Hero");
  });

  it("stores clamped morph target values through the viewer store", () => {
    useViewerStore.setState({ selectedMeshName: "Face" });
    const hierarchy: HierarchyNode[] = [
      { name: "Face", kind: "mesh", children: [] },
    ];
    useFileStore.setState({
      assetMetadata: makeMetadata({
        hierarchy,
        objectInfo: { Face: faceInfo },
      }),
    });
    const { getByLabelText } = render(
      <HierarchySidebarPanel
        stageSessionHandle={null}
        payloadPrimPaths={new Set()}
        unloadedPayloadPaths={new Set()}
        onLoadPayload={vi.fn()}
        onUnloadPayload={vi.fn()}
      />,
    );

    fireEvent.change(getByLabelText("Shape key blink_L"), {
      target: { value: "1.4" },
    });

    expect(useViewerStore.getState().morphTargetValues.Face?.[0]).toBe(1);
  });

  it("retains an unloaded USD payload root row after GLB metadata drops it", () => {
    const onLoadPayload = vi.fn();
    const onUnloadPayload = vi.fn();
    const hierarchy: HierarchyNode[] = [
      {
        name: "World",
        kind: "Xform",
        primPath: "/World",
        children: [
          {
            name: "Visible",
            kind: "Mesh",
            primPath: "/World/Visible",
            children: [],
          },
        ],
      },
    ];
    useFileStore.setState({
      currentFile: usdFile,
      assetMetadata: makeMetadata({ hierarchy }),
    });

    const { getByLabelText, getByText, rerender } = render(
      <HierarchySidebarPanel
        stageSessionHandle={42}
        payloadPrimPaths={new Set(["/World/PayloadRoot"])}
        unloadedPayloadPaths={new Set(["/World/PayloadRoot"])}
        onLoadPayload={onLoadPayload}
        onUnloadPayload={onUnloadPayload}
      />,
    );

    expect(getByText("PayloadRoot")).toBeTruthy();
    fireEvent.click(getByLabelText("Load payload"));
    expect(onLoadPayload).toHaveBeenCalledWith("/World/PayloadRoot");

    // Keep the known row while a successful Load has re-extracted the GLB but
    // metadata has not yet published the loaded root.
    rerender(
      <HierarchySidebarPanel
        stageSessionHandle={42}
        payloadPrimPaths={new Set(["/World/PayloadRoot"])}
        unloadedPayloadPaths={new Set()}
        onLoadPayload={onLoadPayload}
        onUnloadPayload={onUnloadPayload}
      />,
    );
    expect(getByText("PayloadRoot")).toBeTruthy();
    fireEvent.click(getByLabelText("Unload payload"));
    expect(onUnloadPayload).toHaveBeenCalledWith("/World/PayloadRoot");

    rerender(
      <HierarchySidebarPanel
        stageSessionHandle={42}
        payloadPrimPaths={new Set(["/World/PayloadRoot"])}
        unloadedPayloadPaths={new Set(["/World/PayloadRoot"])}
        onLoadPayload={onLoadPayload}
        onUnloadPayload={onUnloadPayload}
      />,
    );
  });

  it("drops obsolete payload rows when the current path snapshot or session changes", () => {
    const hierarchy: HierarchyNode[] = [];
    useFileStore.setState({
      currentFile: usdFile,
      assetMetadata: makeMetadata({ hierarchy }),
    });
    const { queryByLabelText, queryByText, rerender } = render(
      <HierarchySidebarPanel
        stageSessionHandle={42}
        payloadPrimPaths={new Set(["/World/OldRoot"])}
        unloadedPayloadPaths={new Set(["/World/OldRoot"])}
        onLoadPayload={vi.fn()}
        onUnloadPayload={vi.fn()}
      />,
    );

    expect(queryByText("OldRoot")).toBeTruthy();

    rerender(
      <HierarchySidebarPanel
        stageSessionHandle={42}
        payloadPrimPaths={new Set(["/World/CurrentRoot"])}
        unloadedPayloadPaths={new Set(["/World/CurrentRoot"])}
        onLoadPayload={vi.fn()}
        onUnloadPayload={vi.fn()}
      />,
    );
    expect(queryByText("OldRoot")).toBeNull();
    expect(queryByText("CurrentRoot")).toBeTruthy();

    rerender(
      <HierarchySidebarPanel
        stageSessionHandle={null}
        payloadPrimPaths={new Set(["/World/CurrentRoot"])}
        unloadedPayloadPaths={new Set(["/World/CurrentRoot"])}
        onLoadPayload={vi.fn()}
        onUnloadPayload={vi.fn()}
      />,
    );
    expect(queryByText("CurrentRoot")).toBeNull();
    expect(queryByLabelText("Load payload")).toBeNull();

    act(() => {
      useFileStore.setState({
        currentFile: {
          ...usdFile,
          path: "F:\\assets\\scene.glb",
          fileName: "scene.glb",
          extension: "glb",
        },
        assetMetadata: makeMetadata({ hierarchy }),
      });
    });
    rerender(
      <HierarchySidebarPanel
        stageSessionHandle={42}
        payloadPrimPaths={new Set(["/World/CurrentRoot"])}
        unloadedPayloadPaths={new Set(["/World/CurrentRoot"])}
        onLoadPayload={vi.fn()}
        onUnloadPayload={vi.fn()}
      />,
    );
    expect(queryByText("CurrentRoot")).toBeNull();
    expect(queryByLabelText("Load payload")).toBeNull();
  });
});
