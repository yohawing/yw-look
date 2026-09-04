import type { HierarchyNode } from "./assetMetadata";

const USD_PRIM_PATH_PATTERN = /^\/(?:[^/]+(?:\/[^/]+)*)?$/;

function cloneHierarchyNode(node: HierarchyNode): HierarchyNode {
  return {
    ...node,
    children: node.children.map(cloneHierarchyNode),
  };
}

function primPathAncestors(primPath: string): string[] | null {
  if (!USD_PRIM_PATH_PATTERN.test(primPath) || primPath === "/") {
    return null;
  }

  const segments = primPath.slice(1).split("/");
  return segments.map(
    (_, index) => `/${segments.slice(0, index + 1).join("/")}`,
  );
}

/**
 * Restores rows for known payload roots that are absent from the latest
 * extracted GLB hierarchy. The input hierarchy is copied only when a
 * placeholder must be inserted; existing node fields and children are kept.
 */
export function mergeKnownPayloadRoots(
  hierarchy: HierarchyNode[],
  payloadPrimPaths: ReadonlySet<string>,
): HierarchyNode[] {
  const existingPrimPaths = new Set<string>();
  const visitExisting = (nodes: HierarchyNode[]) => {
    for (const node of nodes) {
      if (node.primPath) existingPrimPaths.add(node.primPath);
      visitExisting(node.children);
    }
  };
  visitExisting(hierarchy);

  const paths = Array.from(payloadPrimPaths)
    .filter((path) => !existingPrimPaths.has(path))
    .map((path) => ({ path, ancestors: primPathAncestors(path) }))
    .filter(
      (entry): entry is { path: string; ancestors: string[] } =>
        entry.ancestors !== null,
    )
    .sort((left, right) => {
      const depthDelta = left.ancestors.length - right.ancestors.length;
      return depthDelta !== 0
        ? depthDelta
        : left.path.localeCompare(right.path);
    });

  if (paths.length === 0) return hierarchy;

  const nextHierarchy = hierarchy.map(cloneHierarchyNode);
  const nodesByPrimPath = new Map<string, HierarchyNode>();
  const visit = (nodes: HierarchyNode[]) => {
    for (const node of nodes) {
      if (node.primPath && !nodesByPrimPath.has(node.primPath)) {
        nodesByPrimPath.set(node.primPath, node);
      }
      visit(node.children);
    }
  };
  visit(nextHierarchy);

  let inserted = false;
  for (const { ancestors } of paths) {
    let parent: HierarchyNode | null = null;
    for (const primPath of ancestors) {
      let node = nodesByPrimPath.get(primPath);
      if (!node) {
        const name = primPath.slice(primPath.lastIndexOf("/") + 1);
        node = {
          name,
          kind: "object3d",
          children: [],
          primPath,
        };
        if (parent) {
          parent.children.push(node);
        } else {
          nextHierarchy.push(node);
        }
        nodesByPrimPath.set(primPath, node);
        inserted = true;
      }
      parent = node;
    }
  }

  return inserted ? nextHierarchy : hierarchy;
}
