import { describe, expect, it } from "vitest";
import { buildIfcHierarchy } from "../ifcHierarchy";

describe("IFC Outliner groups", () => {
  it("preserves group IDs, multiple memberships and ungrouped elements", () => {
    const base = {
      name: "Louver",
      category: "IFCBUILDINGELEMENTPROXY",
      storey: "2FL",
      building: "Museum",
    };
    const hierarchy = buildIfcHierarchy([
      {
        ...base,
        id: 1,
        groups: [
          { id: 10, name: "Louvers" },
          { id: 11, name: "Louvers" },
        ],
      },
      { ...base, id: 2, groups: [{ id: 10, name: "Louvers" }] },
      { ...base, id: 3 },
    ]);
    const nodes = hierarchy[0].children[0].children;
    expect(nodes.map((node) => node.name)).toEqual([
      "ifc-group:10",
      "ifc-group:11",
      "ifc:3",
    ]);
    expect(nodes[0].children.map((node) => node.name)).toEqual([
      "ifc:1",
      "ifc:2",
    ]);
    expect(nodes[1].children.map((node) => node.name)).toEqual(["ifc:1"]);
  });
});
