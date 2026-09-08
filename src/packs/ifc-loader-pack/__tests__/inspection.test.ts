import { describe, expect, it, vi } from "vitest";
import type { FragmentsModel, ItemData } from "@thatopen/fragments";
import {
  createIfcInspection,
  ifcElementColor,
  loadIfcDetails,
} from "../inspection";

function fixture() {
  const data: Record<number, ItemData> = {
    1: {
      _localId: { value: 1 },
      _category: { value: "IFCWALL" },
      Name: { value: "Wall A" },
    },
    2: {
      _localId: { value: 2 },
      _category: { value: "IFCDOOR" },
      Name: { value: "Door B" },
    },
    3: {
      _localId: { value: 3 },
      _category: { value: "IFCBUILDINGSTOREY" },
      Name: { value: "2F" },
    },
    4: {
      _localId: { value: 4 },
      _category: { value: "IFCPROPERTYSET" },
      Name: { value: "Wall properties" },
    },
    5: {
      _localId: { value: 5 },
      _category: { value: "IFCPROPERTYSINGLEVALUE" },
      Name: { value: "LoadBearing" },
      NominalValue: { value: false },
    },
  };
  const relations: Record<number, { data: Record<string, number[]> }> = {
    1: { data: { IsDefinedBy: [4] } },
    4: { data: { HasProperties: [5], DefinesOccurrence: [1, 2, 999] } },
  };
  const model = {
    getSpatialStructure: vi.fn().mockResolvedValue({
      category: "IFCBUILDINGSTOREY",
      localId: null,
      children: [
        {
          category: null,
          localId: 3,
          children: [
            { category: "IFCWALL", localId: 1 },
            { category: "IFCDOOR", localId: 2 },
          ],
        },
      ],
    }),
    getItemsIdsWithGeometry: vi.fn().mockResolvedValue([1, 2]),
    getItemsData: vi.fn(async (ids: number[]) =>
      ids.map((id) => data[id]).filter(Boolean),
    ),
    getRelations: vi.fn(
      async (ids: number[]) =>
        new Map(
          ids.filter((id) => relations[id]).map((id) => [id, relations[id]]),
        ),
    ),
    setColor: vi.fn().mockResolvedValue(undefined),
    resetHighlight: vi.fn().mockResolvedValue(undefined),
  };
  return { model, typed: model as unknown as FragmentsModel };
}

describe("IFC element inspection", () => {
  it("uses repeatable element colors and restores category color after deselection", async () => {
    const { model, typed } = fixture();
    const inspection = await createIfcInspection(typed);
    const element = inspection.getSnapshot().elements[0];
    expect(ifcElementColor(element, "element")).toBe(
      ifcElementColor({ ...element }, "element"),
    );
    expect(ifcElementColor(element, "category")).toBe(
      ifcElementColor({ ...element, id: 999 }, "category"),
    );
    await inspection.setColorMode("category");
    await inspection.select("ifc:1");
    await inspection.select(null);
    const material = model.setColor.mock.calls.at(-1)?.[1];
    expect(material.getHexString()).toBe(
      ifcElementColor(element, "category").slice(1),
    );
    await inspection.setColorMode("original");
    expect(model.resetHighlight).toHaveBeenLastCalledWith();
  });
  it("follows property links without expanding reverse links to other elements", async () => {
    const { model, typed } = fixture();
    const detail = await loadIfcDetails(typed, 1, () => false);
    expect(
      detail.sections.find((section) =>
        section.name.includes("Wall properties"),
      )?.rows,
    ).toEqual([{ name: "LoadBearing", value: "false" }]);
    expect(model.getItemsData.mock.calls.flatMap((call) => call[0])).toEqual([
      1, 4, 5,
    ]);
    expect(detail.limited).toBe(false);
  });
  it("selects complete element IDs and retains storey names", async () => {
    const { model, typed } = fixture();
    const inspection = await createIfcInspection(typed);
    await inspection.select("ifc:1");
    expect(inspection.getSnapshot().selected).toMatchObject({
      id: 1,
      name: "Wall A",
      storey: "2F",
    });
    expect(model.setColor).toHaveBeenCalledWith([1], expect.anything());
    await inspection.select(null);
    expect(inspection.getSnapshot()).toMatchObject({
      selected: null,
      sections: [],
      loading: false,
    });
  });
  it("does not publish old details after a later selection", async () => {
    const { model, typed } = fixture();
    const inspection = await createIfcInspection(typed);
    let finish!: () => void;
    const original = model.getItemsData.getMockImplementation()!;
    model.getItemsData.mockImplementationOnce(
      (ids) =>
        new Promise((resolve) => {
          finish = () => {
            void original(ids).then(resolve);
          };
        }),
    );
    const first = inspection.select("ifc:1");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await inspection.select("ifc:2");
    finish();
    await first;
    expect(inspection.getSnapshot().selected?.id).toBe(2);
    expect(
      inspection
        .getSnapshot()
        .sections.some((section) => section.name.includes("Wall properties")),
    ).toBe(false);
  });
  it("waits for in-flight work on dispose and suppresses later notifications", async () => {
    const { model, typed } = fixture();
    const inspection = await createIfcInspection(typed);
    let finish!: () => void;
    model.setColor.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(undefined);
        }),
    );
    const listener = vi.fn();
    inspection.subscribe(listener);
    const selection = inspection.select("ifc:1");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    listener.mockClear();
    let done = false;
    const disposal = inspection.dispose().then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    finish();
    await selection;
    await disposal;
    expect(model.setColor).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
  });
});
