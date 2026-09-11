import { describe, expect, it } from "vitest";
import * as IFC from "web-ifc";
import { collectIfcMaterials } from "../materialSource";
const ref = (value: number) => ({ type: 5, value });
const text = (value: unknown) => ({ type: 1, value });
function fixture() {
  const lines: Record<number, Record<string, unknown>> = {
    1: { type: IFC.IFCMATERIAL, Name: text("Concrete") },
    2: { type: IFC.IFCMATERIAL, Name: text("Glass") },
    3: { type: IFC.IFCMATERIALLAYER, Material: ref(1) },
    4: { type: IFC.IFCMATERIALLAYERSET, MaterialLayers: [ref(3), ref(3)] },
    5: { type: IFC.IFCMATERIALLAYERSETUSAGE, ForLayerSet: ref(4) },
    6: {
      type: IFC.IFCRELASSOCIATESMATERIAL,
      RelatedObjects: [ref(100)],
      RelatingMaterial: ref(5),
    },
    7: {
      type: IFC.IFCRELDEFINESBYTYPE,
      RelatedObjects: [ref(20), ref(21)],
      RelatingType: ref(100),
    },
    8: {
      type: IFC.IFCRELASSOCIATESMATERIAL,
      RelatedObjects: [ref(21)],
      RelatingMaterial: ref(2),
    },
    9: {
      type: IFC.IFCMATERIALPROPERTIES,
      Material: ref(1),
      Properties: [ref(10)],
    },
    10: {
      type: IFC.IFCPROPERTYSINGLEVALUE,
      Name: text("LoadBearing"),
      NominalValue: text(false),
    },
    30: {
      type: IFC.IFCSURFACESTYLE,
      Name: text("Concrete"),
      Styles: [ref(31)],
    },
    31: {
      type: IFC.IFCSURFACESTYLERENDERING,
      SurfaceColour: ref(32),
      Transparency: text(0),
    },
    32: { type: IFC.IFCCOLOURRGB, Red: text(1), Green: text(0), Blue: text(0) },
    20: { Representation: ref(50) },
    21: { Representation: ref(51) },
    50: { Representations: [ref(52)] },
    51: { Representations: [ref(53)] },
    52: { Items: [ref(54)] },
    53: { Items: [ref(55)] },
    54: { MappingSource: ref(56) },
    56: { MappedRepresentation: ref(57) },
    57: { Items: [ref(55)] },
    55: {},
  };
  return {
    lines,
    reader: {
      ids: (type: number) =>
        Object.keys(lines)
          .map(Number)
          .filter((id) => lines[id].type === type),
      get: (id: number) => lines[id] ?? {},
    },
  };
}
describe("IFC source materials", () => {
  it("deduplicates layer usage, honours occurrence overrides, and never links by name", () => {
    const { reader } = fixture();
    const catalog = collectIfcMaterials(reader, [20, 21]);
    expect(catalog.building[0].elementIds).toEqual([20]);
    expect(catalog.building[1].elementIds).toEqual([21]);
    expect(catalog.building[0].rows).toContainEqual({
      name: "LoadBearing",
      value: "false",
    });
    expect(catalog.display[0]).toMatchObject({
      elementIds: [],
      linkedIds: [],
      color: "#ff0000",
    });
    expect(catalog.display[0].rows).toContainEqual({
      name: "Transparency",
      value: "0",
    });
  });
  it("links material styles in both directions and maps styled/mapped items to owners", () => {
    const { reader, lines } = fixture();
    lines[60] = { type: IFC.IFCSTYLEDITEM, Item: ref(55), Styles: [ref(61)] };
    lines[61] = { type: IFC.IFCPRESENTATIONSTYLEASSIGNMENT, Styles: [ref(30)] };
    lines[62] = { type: IFC.IFCSTYLEDITEM, Item: null, Styles: [ref(30)] };
    lines[63] = { type: IFC.IFCSTYLEDREPRESENTATION, Items: [ref(62)] };
    lines[64] = {
      type: IFC.IFCMATERIALDEFINITIONREPRESENTATION,
      RepresentedMaterial: ref(1),
      Representations: [ref(63)],
    };
    const catalog = collectIfcMaterials(reader, [20, 21]);
    expect(catalog.building[0].linkedIds).toEqual(["display:30"]);
    expect(catalog.display[0].linkedIds).toEqual(["building:1"]);
    expect(catalog.display[0].elementIds).toEqual([20, 21]);
    expect(catalog.display[0].shapeIds).toEqual([55]);
  });
});
