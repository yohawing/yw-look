import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { HierarchySidebarPanel } from "../HierarchySidebarPanel";
import { useViewerStore } from "../../stores/viewerStore";
import type { SelectedFile } from "../../lib/files";
import type { HierarchyNode, ObjectInfo } from "../assetMetadata";

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
  useViewerStore.setState({
    selectedMeshName: null,
    selectedUsdPrimPath: null,
    morphTargetValues: {},
  });
});

afterEach(() => {
  cleanup();
});

describe("HierarchySidebarPanel", () => {
  it("selects a hierarchy row through the viewer store", () => {
    const hierarchy: HierarchyNode[] = [
      { name: "Face", kind: "mesh", children: [] },
    ];
    const { container } = render(
      <HierarchySidebarPanel
        currentFile={null}
        hierarchy={hierarchy}
        objectInfo={{ Face: faceInfo }}
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
    const { container } = render(
      <HierarchySidebarPanel
        currentFile={usdFile}
        hierarchy={hierarchy}
        objectInfo={{ "/World/Hero": faceInfo }}
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
    const { getByLabelText } = render(
      <HierarchySidebarPanel
        currentFile={null}
        hierarchy={hierarchy}
        objectInfo={{ Face: faceInfo }}
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
});
