import { describe, expect, it } from "vitest";
import type { HierarchyNode } from "../assetMetadata";
import { mergeKnownPayloadRoots } from "../usdPayloadHierarchy";

function findByPrimPath(
  nodes: HierarchyNode[],
  primPath: string,
): HierarchyNode | undefined {
  for (const node of nodes) {
    if (node.primPath === primPath) return node;
    const child = findByPrimPath(node.children, primPath);
    if (child) return child;
  }
  return undefined;
}

function countByPrimPath(nodes: HierarchyNode[], primPath: string): number {
  return nodes.reduce(
    (count, node) =>
      count +
      (node.primPath === primPath ? 1 : 0) +
      countByPrimPath(node.children, primPath),
    0,
  );
}

describe("mergeKnownPayloadRoots", () => {
  it("merges nested roots through missing ancestors by primPath", () => {
    const hierarchy: HierarchyNode[] = [
      {
        name: "Existing",
        kind: "Xform",
        primPath: "/Existing",
        children: [],
      },
    ];
    const payloadPrimPaths = new Set([
      "/World/Shared",
      "/World/Shared/Thing",
      "/Other/Shared/Thing",
    ]);

    const merged = mergeKnownPayloadRoots(hierarchy, payloadPrimPaths);

    expect(findByPrimPath(merged, "/World")).toBeTruthy();
    expect(findByPrimPath(merged, "/World/Shared")).toMatchObject({
      name: "Shared",
      kind: "object3d",
      primPath: "/World/Shared",
    });
    expect(findByPrimPath(merged, "/World/Shared/Thing")).toBeTruthy();
    expect(findByPrimPath(merged, "/Other/Shared/Thing")).toBeTruthy();
    expect(countByPrimPath(merged, "/World/Shared")).toBe(1);
    expect(countByPrimPath(merged, "/World/Shared/Thing")).toBe(1);
    expect(countByPrimPath(merged, "/Other/Shared")).toBe(1);
    expect(countByPrimPath(merged, "/Other/Shared/Thing")).toBe(1);
  });

  it("preserves metadata and avoids duplicating loaded roots already in GLB", () => {
    const hierarchy: HierarchyNode[] = [
      {
        name: "Root",
        kind: "Xform",
        primPath: "/Root",
        children: [
          {
            name: "Asset",
            kind: "Mesh",
            primPath: "/Root/Asset",
            children: [],
          },
        ],
      },
    ];
    const original = structuredClone(hierarchy);

    const merged = mergeKnownPayloadRoots(hierarchy, new Set(["/Root/Asset"]));

    expect(merged).toBe(hierarchy);
    expect(countByPrimPath(merged, "/Root/Asset")).toBe(1);
    expect(hierarchy).toEqual(original);

    const withPlaceholder = mergeKnownPayloadRoots(
      hierarchy,
      new Set(["/Root/Payload"]),
    );
    expect(hierarchy).toEqual(original);
    expect(withPlaceholder).not.toBe(hierarchy);

    const flattenedPayload: HierarchyNode[] = [
      {
        name: "Payload",
        kind: "object3d",
        primPath: "/Missing/Ancestor/Payload",
        children: [],
      },
    ];
    const flattenedResult = mergeKnownPayloadRoots(
      flattenedPayload,
      new Set(["/Missing/Ancestor/Payload"]),
    );
    expect(flattenedResult).toBe(flattenedPayload);
    expect(findByPrimPath(flattenedResult, "/Missing")).toBeUndefined();
  });

  it("drops roots removed from the current known path snapshot", () => {
    const oldPath = "/World/OldRoot";
    const currentPath = "/World/CurrentRoot";

    const merged = mergeKnownPayloadRoots([], new Set([currentPath]));

    expect(findByPrimPath(merged, oldPath)).toBeUndefined();
    expect(findByPrimPath(merged, currentPath)).toBeTruthy();
  });
});
