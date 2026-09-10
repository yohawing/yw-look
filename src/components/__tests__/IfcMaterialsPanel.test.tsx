import { Activity } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { IfcMaterialsPanel } from "../IfcMaterialsPanel";
import type { IfcInspection, IfcMaterialRecord } from "../../types/ifc";
afterEach(cleanup);
function fixture() {
  const base = {
    origin: "source" as const,
    rows: [],
    elementIds: [20],
    shapeIds: [],
    color: null,
  };
  const building: IfcMaterialRecord = {
    ...base,
    id: "building:1",
    name: "Concrete",
    kind: "building",
    linkedIds: ["display:2"],
  };
  const style: IfcMaterialRecord = {
    ...base,
    id: "display:2",
    name: "Surface red",
    kind: "display",
    linkedIds: ["building:1"],
    color: "#ff0000",
  };
  const unassigned: IfcMaterialRecord = {
    ...style,
    id: "display:3",
    name: "Unused style",
    linkedIds: [],
    elementIds: [],
  };
  const snapshot = {
    elements: [
      {
        id: 20,
        name: "Wall A",
        category: "IFCWALL",
        storey: "2F",
        building: "Museum",
      },
    ],
    selected: null,
    sections: [],
    loading: false,
    error: null,
    limited: false,
    colorMode: "category" as const,
  };
  const inspection: IfcInspection = {
    materials: { building: [building], display: [style, unassigned] },
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    select: vi.fn(),
    setColorMode: vi.fn(),
    dispose: vi.fn(),
    highlightMaterials: vi.fn().mockResolvedValue(undefined),
  };
  return { inspection };
}
describe("IFC Materials in the shared browser", () => {
  it("clears hidden highlighting and restores the selected material on return", () => {
    const { inspection } = fixture();
    const view = render(
      <Activity mode="visible">
        <IfcMaterialsPanel inspection={inspection} />
      </Activity>,
    );
    fireEvent.click(view.container.querySelector(".material-row")!);
    expect(inspection.highlightMaterials).toHaveBeenLastCalledWith([20]);
    view.rerender(
      <Activity mode="hidden">
        <IfcMaterialsPanel inspection={inspection} />
      </Activity>,
    );
    expect(inspection.highlightMaterials).toHaveBeenLastCalledWith([]);
    view.rerender(
      <Activity mode="visible">
        <IfcMaterialsPanel inspection={inspection} />
      </Activity>,
    );
    expect(inspection.highlightMaterials).toHaveBeenLastCalledWith([20]);
    expect(
      view.container.querySelector(".material-row.is-selected")?.textContent,
    ).toContain("Concrete");
  });

  it("lists both kinds without a switch, follows explicit links, and cleans up highlighting", () => {
    const { inspection } = fixture();
    const { container, unmount } = render(
      <IfcMaterialsPanel inspection={inspection} />,
    );
    const rows = container.querySelectorAll(".material-row");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Building material");
    expect(rows[1].textContent).toContain("Display material");
    expect(container.querySelector(".yl-segmented-control")).toBeNull();
    fireEvent.click(rows[0]);
    expect(inspection.highlightMaterials).toHaveBeenLastCalledWith([20]);
    fireEvent.click(screen.getByRole("button", { name: "Surface red" }));
    expect(
      container.querySelector(".material-row.is-selected")?.textContent,
    ).toContain("Surface red");
    fireEvent.click(screen.getByRole("button", { name: "Concrete" }));
    expect(
      container.querySelector(".material-row.is-selected")?.textContent,
    ).toContain("Concrete");
    expect(
      screen.queryByRole("button", { name: "Clear selection" }),
    ).toBeNull();
    unmount();
    expect(inspection.highlightMaterials).toHaveBeenLastCalledWith([]);
  });
  it("excludes viewer colors, import defaults, and loader output from inspection", () => {
    const { inspection } = fixture();
    const template = inspection.materials!.display[0];
    for (const origin of [
      "category",
      "element",
      "fallback",
      "loader",
    ] as const) {
      inspection.materials!.display.push({
        ...template,
        id: origin,
        name: origin,
        origin,
      });
    }
    const { container } = render(<IfcMaterialsPanel inspection={inspection} />);
    expect(container.querySelectorAll(".material-row")).toHaveLength(3);
    expect(screen.queryByText("fallback")).toBeNull();
    expect(screen.queryByText("loader")).toBeNull();
  });
  it("does not mark unassigned definitions as used and keeps usage highlighting without a member list", () => {
    const { inspection } = fixture();
    const { container } = render(<IfcMaterialsPanel inspection={inspection} />);
    fireEvent.click(container.querySelectorAll(".material-row")[2]);
    expect(screen.getByText("Unassigned definition")).toBeTruthy();
    expect(inspection.highlightMaterials).toHaveBeenLastCalledWith([]);
    fireEvent.click(container.querySelectorAll(".material-row")[0]);
    expect(inspection.highlightMaterials).toHaveBeenLastCalledWith([20]);
    expect(screen.queryByText("Used by")).toBeNull();
    expect(screen.queryByRole("button", { name: "Wall A" })).toBeNull();
  });
});
