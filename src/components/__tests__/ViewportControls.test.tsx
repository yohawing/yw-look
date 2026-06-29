import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ViewportControls } from "../ViewportControls";
import type { ToolbarItem } from "../toolbar/types";

describe("ViewportControls", () => {
  it("does not render viewport tooltips", () => {
    const items: ToolbarItem[] = [
      {
        id: "texture",
        mode: "3d",
        group: "shading",
        kind: "toggle",
        label: "Texture",
        description: "Toggle textured shading",
        iconId: "palette",
        active: true,
        onRun: vi.fn(),
      },
      {
        id: "camera",
        mode: "3d",
        group: "camera",
        kind: "button",
        label: "Camera",
        description: "Change camera preset",
        iconId: "camera",
        children: [
          {
            id: "front",
            mode: "3d",
            group: "camera",
            kind: "button",
            label: "Front",
            onRun: vi.fn(),
          },
        ],
      },
    ];

    const { getByRole, queryByRole, queryByText } = render(
      <ViewportControls items={items} />,
    );

    expect(getByRole("button", { name: "Texture" })).toBeTruthy();
    expect(getByRole("button", { name: "Camera" })).toBeTruthy();
    expect(queryByRole("tooltip")).toBeNull();
    expect(queryByText("Toggle textured shading")).toBeNull();
    expect(queryByText("Change camera preset")).toBeNull();
  });

  it("keeps the collapsed viewport tools button without a tooltip", () => {
    const { getByRole, queryByRole, queryByText } = render(
      <ViewportControls items={[]} isOpen={false} onToggleOpen={vi.fn()} />,
    );

    expect(getByRole("button", { name: "Open viewport tools" })).toBeTruthy();
    expect(queryByRole("tooltip")).toBeNull();
    expect(queryByText("Viewport tools")).toBeNull();
  });

  it("keeps viewport submenus open while clicking the sidebar", () => {
    const items: ToolbarItem[] = [
      {
        id: "camera",
        mode: "3d",
        group: "camera",
        kind: "button",
        label: "Camera",
        iconId: "camera",
        children: [
          {
            id: "front",
            mode: "3d",
            group: "camera",
            kind: "button",
            label: "Front",
            onRun: vi.fn(),
          },
        ],
      },
    ];

    const { getByRole } = render(
      <>
        <ViewportControls items={items} />
        <aside className="sidebar">
          <button type="button">View</button>
        </aside>
      </>,
    );

    fireEvent.click(getByRole("button", { name: "Camera" }));
    expect(getByRole("menu")).toBeTruthy();
    expect(getByRole("button", { name: "Front" })).toBeTruthy();

    fireEvent.pointerDown(getByRole("button", { name: "View" }));

    expect(getByRole("menu")).toBeTruthy();
    expect(getByRole("button", { name: "Front" })).toBeTruthy();
  });

  it("closes viewport submenus for ordinary outside clicks", () => {
    const items: ToolbarItem[] = [
      {
        id: "camera",
        mode: "3d",
        group: "camera",
        kind: "button",
        label: "Camera",
        iconId: "camera",
        children: [
          {
            id: "front",
            mode: "3d",
            group: "camera",
            kind: "button",
            label: "Front",
            onRun: vi.fn(),
          },
        ],
      },
    ];

    const { getByRole, queryByRole } = render(
      <>
        <ViewportControls items={items} />
        <button type="button">Outside</button>
      </>,
    );

    fireEvent.click(getByRole("button", { name: "Camera" }));
    expect(getByRole("menu")).toBeTruthy();

    fireEvent.pointerDown(getByRole("button", { name: "Outside" }));
    fireEvent.click(getByRole("button", { name: "Outside" }));

    expect(queryByRole("menu")).toBeNull();
  });
});
