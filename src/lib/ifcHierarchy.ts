import type { IfcElement } from "../types/ifc";
import type { HierarchyNode } from "../types/viewer";

/** Adapt semantic IFC elements to the shared Outliner; never expose render batches. */
export function buildIfcHierarchy(
  elements: readonly IfcElement[],
): HierarchyNode[] {
  const buildings = new Map<
    string,
    { node: HierarchyNode; storeys: Map<string, HierarchyNode> }
  >();
  const groupNodes = new Map<HierarchyNode, Map<number, HierarchyNode>>();
  for (const element of elements) {
    let building = buildings.get(element.building);
    if (!building) {
      building = {
        node: {
          name: `ifc-building:${JSON.stringify(element.building)}`,
          displayName: element.building,
          kind: "IFCBUILDING",
          children: [],
        },
        storeys: new Map(),
      };
      buildings.set(element.building, building);
    }
    let storey = building.storeys.get(element.storey);
    if (!storey) {
      storey = {
        name: `ifc-storey:${JSON.stringify([element.building, element.storey])}`,
        displayName: element.storey,
        kind: "IFCBUILDINGSTOREY",
        children: [],
      };
      building.storeys.set(element.storey, storey);
      building.node.children.push(storey);
    }
    const node: HierarchyNode = {
      name: `ifc:${element.id}`,
      displayName: element.name,
      kind: element.category,
      children: [],
    };
    if (!element.groups?.length) {
      storey.children.push(node);
      continue;
    }
    let byId = groupNodes.get(storey);
    if (!byId) {
      byId = new Map();
      groupNodes.set(storey, byId);
    }
    for (const group of element.groups) {
      let parent = byId.get(group.id);
      if (!parent) {
        parent = {
          name: `ifc-group:${group.id}`,
          displayName: group.name,
          kind: "IFCGROUP",
          children: [],
        };
        byId.set(group.id, parent);
        storey.children.push(parent);
      }
      parent.children.push(node);
    }
  }
  return [...buildings.values()].map((building) => building.node);
}
