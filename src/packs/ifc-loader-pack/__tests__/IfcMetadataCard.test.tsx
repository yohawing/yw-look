import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { IfcInspectionSnapshot } from "../../../types/ifc";
import { IfcMetadataCard } from "../IfcMetadataCard";

describe("IFC inspector", () => {
  it("switches display modes in Properties", () => {
    const state: IfcInspectionSnapshot = {
      elements: [
        {
          id: 20,
          name: "Wall A",
          category: "IFCWALL",
          storey: "2F",
          building: "Building A",
        },
        {
          id: 24,
          name: "Door B",
          category: "IFCDOOR",
          storey: "1F",
          building: "Building A",
        },
      ],
      selected: null,
      sections: [],
      loading: false,
      error: null,
      limited: false,
      colorMode: "category",
    };
    const inspection = {
      getSnapshot: () => state,
      subscribe: () => () => {},
      select: vi.fn(),
      setColorMode: vi.fn(),
      dispose: vi.fn(),
    };
    const onSelect = vi.fn();
    render(
      <IfcMetadataCard
        metadata={{ kind: "ifc", inspection }}
        onSelect={onSelect}
      />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "IFC color mode" }), {
      target: { value: "original" },
    });
    expect(inspection.setColorMode).toHaveBeenCalledWith("original");
  });
  it("groups details under short headings and clears the selected element", () => {
    const selected = {
      id: 20,
      name: "Wall A",
      category: "IFCWALL",
      storey: "2F",
      building: "A",
    };
    const state: IfcInspectionSnapshot = {
      elements: [selected],
      selected,
      colorMode: "category",
      loading: false,
      error: null,
      limited: false,
      sections: [
        {
          group: "Identity",
          name: "Element",
          rows: [{ name: "GlobalId", value: "abc" }],
        },
        {
          group: "Materials",
          name: "Concrete",
          rows: [{ name: "Thickness", value: "100" }],
        },
        {
          group: "Element properties",
          name: "Pset_WallCommon",
          rows: [{ name: "LoadBearing", value: "false" }],
        },
      ],
    };
    const onSelect = vi.fn();
    const { container } = render(
      <IfcMetadataCard
        metadata={{
          kind: "ifc",
          inspection: {
            getSnapshot: () => state,
            subscribe: () => () => {},
            select: vi.fn(),
            setColorMode: vi.fn(),
            dispose: vi.fn(),
          },
        }}
        view="selection"
        selectedKey="ifc:20"
        onSelect={onSelect}
      />,
    );
    const headings = [
      ...container.querySelectorAll(
        ".ifc-inspector > details > summary .yl-disclosure__title",
      ),
    ].map((node) => node.textContent);
    expect(headings).toEqual(["Identity", "Materials", "Element properties"]);
    const material = screen.getByText("Concrete").closest("details")!;
    expect(material.open).toBe(false);
    fireEvent.click(screen.getByText("Concrete"));
    expect(material.open).toBe(true);
    expect(screen.getByText("100")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
