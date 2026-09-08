import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { IfcInspectionSnapshot } from "../../../types/ifc";
import { IfcMetadataCard } from "../IfcMetadataCard";

describe("IFC inspector", () => {
  it("filters elements, selects instance keys, and switches display modes", () => {
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
        view="hierarchy"
        onSelect={onSelect}
      />,
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Filter IFC elements" }),
      { target: { value: "2F" } },
    );
    expect(screen.queryByRole("button", { name: /Door B/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Wall A/ }));
    expect(onSelect).toHaveBeenCalledWith("ifc:20");
    fireEvent.change(screen.getByRole("combobox", { name: "IFC color mode" }), {
      target: { value: "original" },
    });
    expect(inspection.setColorMode).toHaveBeenCalledWith("original");
  });
});
