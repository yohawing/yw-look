/**
 * Regression tests for the HierarchyCard selection sync (#33).
 *
 * The viewport-picker pushes a mesh name into `selectedName`, and the
 * tree must:
 *   - apply the `is-selected` class to the matching row
 *   - force-open every ancestor branch so the row is visible
 *   - call `onSelectName(null)` when the user clicks the active row
 *     a second time (used by the App-level state to clear the pick)
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { HierarchyCard } from "../HierarchyCard";
import type { HierarchyNode, ObjectInfo } from "../assetMetadata";

const tree: HierarchyNode[] = [
  {
    name: "Root",
    kind: "group",
    children: [
      {
        name: "Body",
        kind: "group",
        children: [
          { name: "Torso", kind: "mesh", children: [] },
          { name: "Arm", kind: "mesh", children: [] },
        ],
      },
    ],
  },
];

const faceInfo: ObjectInfo = {
  name: "Face",
  kind: "mesh",
  visible: true,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  boundingBox: null,
  vertexCount: 12340,
  triangleCount: null,
  materialNames: ["Face_Mat"],
  materialIds: [],
  morphTargets: [
    { index: 0, name: "blink_L", value: 0, mmd: null },
    { index: 1, name: "mouth_A", value: 0.65, mmd: null },
  ],
  childCount: null,
  animatesWithClips: [],
  userData: null,
  mmdBone: null,
};

describe("HierarchyCard selection sync (#33)", () => {
  afterEach(() => {
    cleanup();
  });

  it("highlights the row whose name matches selectedName", () => {
    const { container } = render(
      <HierarchyCard hierarchy={tree} selectedName="Arm" />,
    );
    const selectedRows = container.querySelectorAll(".tree-row.is-selected");
    expect(selectedRows).toHaveLength(1);
    expect(selectedRows[0].textContent).toContain("Arm");
  });

  it("renders hierarchy displayName without changing the selection key", () => {
    const boneTree: HierarchyNode[] = [
      { name: "Arm_EN", displayName: "腕", kind: "bone", children: [] },
    ];
    const onSelect = vi.fn();
    const { container, getAllByText } = render(
      <HierarchyCard
        hierarchy={boneTree}
        selectedName="Arm_EN"
        onSelectName={onSelect}
      />,
    );

    expect(getAllByText("腕")).toHaveLength(2);
    expect(container.querySelector(".tree-row.is-selected")).toBeTruthy();
    fireEvent.click(container.querySelector(".tree-row.is-selected")!);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("force-opens ancestor branches so the selected row is visible", () => {
    // The tree's default expansion stops at depth < 2, so without the
    // force-open path the leaf "Arm" (depth 3) would stay collapsed
    // when something deep is selected and the user reopens the tab.
    const { container } = render(
      <HierarchyCard hierarchy={tree} selectedName="Arm" />,
    );
    expect(container.textContent).toContain("Arm");
  });

  it("toggles selection off when the active row is clicked again", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <HierarchyCard
        hierarchy={tree}
        selectedName="Arm"
        onSelectName={onSelect}
      />,
    );
    const selectedRow = container.querySelector(".tree-row.is-selected");
    expect(selectedRow).not.toBeNull();
    fireEvent.click(selectedRow!);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("does not force-open sibling branches of the selected ancestor", () => {
    // Codex P2 regression: an earlier version OR'd parent forceExpanded
    // into every child, so selecting a deep node would also unfold
    // every sibling subtree below the closest ancestor of the
    // selection. We construct a tree deep enough that the default
    // `depth < 2` expansion does NOT reach the leaves, so the only
    // way to see a leaf is via force-open or a manual click.
    const treeWithSibling: HierarchyNode[] = [
      {
        name: "Root",
        kind: "group",
        children: [
          {
            name: "Body",
            kind: "group",
            children: [
              {
                name: "Hand",
                kind: "group",
                children: [{ name: "Finger", kind: "mesh", children: [] }],
              },
              {
                name: "Foot",
                kind: "group",
                children: [{ name: "Toe", kind: "mesh", children: [] }],
              },
            ],
          },
        ],
      },
    ];
    const { container } = render(
      <HierarchyCard hierarchy={treeWithSibling} selectedName="Finger" />,
    );
    // Force-open chain: Hand opens to expose Finger.
    expect(container.textContent).toContain("Finger");
    // Sibling chain: Foot does NOT contain the selection, so its
    // child Toe stays collapsed and is not in the rendered text.
    expect(container.textContent).not.toContain("Toe");
  });

  it("forwards a fresh name when an unselected row is clicked", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <HierarchyCard
        hierarchy={tree}
        selectedName={null}
        onSelectName={onSelect}
      />,
    );
    const arm = Array.from(container.querySelectorAll(".tree-row")).find((el) =>
      el.textContent?.includes("Arm"),
    );
    expect(arm).toBeTruthy();
    fireEvent.click(arm!);
    expect(onSelect).toHaveBeenCalledWith("Arm");
  });

  it("renders morph target sliders for the selected mesh and forwards changes", () => {
    const onMorphTargetChange = vi.fn();
    const faceTree: HierarchyNode[] = [
      { name: "Face", kind: "mesh", children: [] },
    ];
    const { getByLabelText, getByText } = render(
      <HierarchyCard
        hierarchy={faceTree}
        objectInfo={{ Face: faceInfo }}
        selectedName="Face"
        morphTargetValues={{ Face: { 1: 0.2 } }}
        onMorphTargetChange={onMorphTargetChange}
      />,
    );

    expect(getByText("12,340")).toBeTruthy();
    expect(getByText("Face_Mat")).toBeTruthy();
    const mouth = getByLabelText("Shape key mouth_A") as HTMLInputElement;
    expect(mouth.value).toBe("0.2");

    fireEvent.change(mouth, { target: { value: "0.42" } });
    expect(onMorphTargetChange).toHaveBeenCalledWith("Face", 1, 0.42);
  });

  it("renders MMD morph metadata in the selected shape key list", () => {
    const mmdFaceInfo: ObjectInfo = {
      ...faceInfo,
      morphTargets: [
        {
          index: 0,
          name: "笑い",
          value: 0.25,
          mmd: {
            name: "笑い",
            englishName: "smile",
            type: "group",
            boneOffsetCount: 0,
            groupOffsetCount: 2,
            flipOffsetCount: 1,
            impulseOffsetCount: 0,
          },
        },
      ],
    };
    const faceTree: HierarchyNode[] = [
      { name: "Face", kind: "mesh", children: [] },
    ];

    const { getByText } = render(
      <HierarchyCard
        hierarchy={faceTree}
        objectInfo={{ Face: mmdFaceInfo }}
        selectedName="Face"
      />,
    );

    expect(getByText("笑い")).toBeTruthy();
    expect(getByText("group · smile · group:2 flip:1")).toBeTruthy();
  });

  it("resets every morph target to zero", () => {
    const onMorphTargetChange = vi.fn();
    const faceTree: HierarchyNode[] = [
      { name: "Face", kind: "mesh", children: [] },
    ];
    const { getByRole } = render(
      <HierarchyCard
        hierarchy={faceTree}
        objectInfo={{ Face: faceInfo }}
        selectedName="Face"
        onMorphTargetChange={onMorphTargetChange}
      />,
    );

    fireEvent.click(getByRole("button", { name: "Reset All" }));
    expect(onMorphTargetChange).toHaveBeenCalledWith("Face", 0, 0);
    expect(onMorphTargetChange).toHaveBeenCalledWith("Face", 1, 0);
  });

  it("uses primPath as the morph target key for USD-sourced meshes", () => {
    const onMorphTargetChange = vi.fn();
    const faceTree: HierarchyNode[] = [
      {
        name: "Face",
        kind: "mesh",
        primPath: "/World/Face",
        children: [],
      },
    ];
    const { getByLabelText } = render(
      <HierarchyCard
        hierarchy={faceTree}
        objectInfo={{ "/World/Face": faceInfo }}
        selectedName="/World/Face"
        morphTargetValues={{ "/World/Face": { 0: 0.25 } }}
        onMorphTargetChange={onMorphTargetChange}
      />,
    );

    const blink = getByLabelText("Shape key blink_L") as HTMLInputElement;
    expect(blink.value).toBe("0.25");
    fireEvent.change(blink, { target: { value: "0.75" } });
    expect(onMorphTargetChange).toHaveBeenCalledWith("/World/Face", 0, 0.75);
  });

  it("renders MMD bone parameters for the selected bone", () => {
    const boneTree: HierarchyNode[] = [
      { name: "Arm_EN", kind: "bone", children: [] },
    ];
    const boneInfo: ObjectInfo = {
      ...faceInfo,
      name: "Arm_EN",
      kind: "bone",
      vertexCount: null,
      materialNames: [],
      morphTargets: [],
      mmdBone: {
        boneIndex: 1,
        parentIndex: 0,
        parentName: "センター",
        name: "腕",
        englishName: "Arm_EN",
        restPosition: [1, 12, 0],
        layer: 1,
        appendTransform: {
          parentIndex: 0,
          parentName: "センター",
          weight: 0.5,
        },
        flags: { appendRotate: true, appendTranslate: false },
        ik: {
          roles: ["goal", "link"],
          goalBoneIndex: 1,
          effectorBoneIndex: 0,
          iterationCount: 8,
          maxAnglePerIteration: 0.25,
          linkCount: 1,
          limitKinds: ["pmxLinkLimit"],
        },
      },
    };

    const { getByText } = render(
      <HierarchyCard
        hierarchy={boneTree}
        objectInfo={{ Arm_EN: boneInfo }}
        selectedName="Arm_EN"
      />,
    );

    expect(getByText("MMD Bone")).toBeTruthy();
    expect(getByText("腕")).toBeTruthy();
    expect(getByText("1, 12, 0")).toBeTruthy();
    expect(getByText("appendRotate")).toBeTruthy();
    expect(getByText("goal, link")).toBeTruthy();
    expect(getByText("pmxLinkLimit")).toBeTruthy();
  });
});
