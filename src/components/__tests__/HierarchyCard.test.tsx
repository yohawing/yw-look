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
import type { HierarchyNode } from "../assetMetadata";

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
});
