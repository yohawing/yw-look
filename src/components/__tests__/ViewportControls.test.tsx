import { act, fireEvent, render } from "@testing-library/react";
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

  it("does not render visible separators between viewport tools", () => {
    const items: ToolbarItem[] = [
      {
        id: "camera",
        mode: "3d",
        group: "camera",
        kind: "button",
        label: "Camera",
        iconId: "camera",
        onRun: vi.fn(),
      },
      { kind: "separator" },
      {
        id: "shading",
        mode: "3d",
        group: "shading",
        kind: "button",
        label: "Shading",
        iconId: "light",
        onRun: vi.fn(),
      },
    ];

    const { container, getByRole } = render(<ViewportControls items={items} />);

    expect(getByRole("button", { name: "Camera" })).toBeTruthy();
    expect(getByRole("button", { name: "Shading" })).toBeTruthy();
    expect(container.querySelector(".viewport-tool-separator")).toBeNull();
    expect(container.querySelectorAll(".viewport-tool-group")).toHaveLength(1);
  });

  it("keeps the collapsed viewport tools button without a tooltip", () => {
    const { getByRole, queryByRole, queryByText } = render(
      <ViewportControls items={[]} isOpen={false} onToggleOpen={vi.fn()} />,
    );

    expect(getByRole("button", { name: "Open viewport tools" })).toBeTruthy();
    expect(queryByRole("tooltip")).toBeNull();
    expect(queryByText("Viewport tools")).toBeNull();
  });

  it("keeps viewport submenus open after choosing a submenu item", () => {
    const selectFront = vi.fn();
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
            onRun: selectFront,
          },
        ],
      },
    ];

    const { getByRole } = render(<ViewportControls items={items} />);

    fireEvent.click(getByRole("button", { name: "Camera" }));
    expect(getByRole("menu")).toBeTruthy();

    fireEvent.click(getByRole("button", { name: "Front" }));

    expect(selectFront).toHaveBeenCalledOnce();
    expect(getByRole("menu")).toBeTruthy();
    expect(getByRole("button", { name: "Front" })).toBeTruthy();
  });

  it("does not run parent actions when a viewport submenu trigger is clicked", () => {
    const parentRun = vi.fn();
    const childRun = vi.fn();
    const items: ToolbarItem[] = [
      {
        id: "skeleton",
        mode: "3d",
        group: "overlay",
        kind: "toggle",
        label: "Skeleton",
        iconId: "skeleton",
        onRun: parentRun,
        children: [
          {
            id: "skeleton-bones",
            mode: "3d",
            group: "overlay",
            kind: "toggle",
            label: "Bone",
            onRun: childRun,
          },
        ],
      },
    ];

    const { getByRole } = render(<ViewportControls items={items} />);

    fireEvent.click(getByRole("button", { name: "Skeleton" }));

    expect(parentRun).not.toHaveBeenCalled();
    expect(getByRole("menu")).toBeTruthy();

    fireEvent.click(getByRole("button", { name: "Bone" }));

    expect(childRun).toHaveBeenCalledOnce();
    expect(parentRun).not.toHaveBeenCalled();
    expect(getByRole("menu")).toBeTruthy();
  });

  it("keeps clicked viewport submenus open after the trigger pointer leaves", () => {
    vi.useFakeTimers();
    try {
      const items: ToolbarItem[] = [
        {
          id: "display",
          mode: "3d",
          group: "display",
          kind: "popover",
          label: "Display",
          iconId: "light",
          children: [
            {
              id: "display-shaded",
              mode: "3d",
              group: "display",
              kind: "button",
              label: "Shaded",
              onRun: vi.fn(),
            },
          ],
        },
      ];

      const { getByRole } = render(<ViewportControls items={items} />);
      const trigger = getByRole("button", { name: "Display" });

      fireEvent.click(trigger);
      expect(getByRole("menu")).toBeTruthy();

      fireEvent.pointerLeave(trigger, { relatedTarget: document.body });
      act(() => {
        vi.advanceTimersByTime(180);
      });

      expect(getByRole("menu")).toBeTruthy();
      expect(getByRole("button", { name: "Shaded" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the Display popover title only once", () => {
    const items: ToolbarItem[] = [
      {
        id: "display",
        mode: "3d",
        group: "display",
        kind: "popover",
        label: "Display",
        iconId: "light",
        children: [
          {
            id: "display-shaded",
            mode: "3d",
            group: "display",
            kind: "button",
            label: "Shaded",
            active: true,
            onRun: vi.fn(),
          },
          { kind: "separator" },
          {
            id: "wireframe-section-label",
            mode: "3d",
            group: "wireframe",
            kind: "status",
            label: "Wireframe",
          },
          {
            id: "display-wireframe-overlay",
            mode: "3d",
            group: "wireframe",
            kind: "button",
            label: "Overlay",
            onRun: vi.fn(),
          },
        ],
      },
    ];

    const { getAllByText, getByRole, getByText } = render(
      <ViewportControls items={items} />,
    );

    fireEvent.click(getByRole("button", { name: "Display" }));

    expect(getAllByText("Display")).toHaveLength(1);
    expect(getByText("Wireframe")).toBeTruthy();
  });

  it("does not render icons on viewport submenu items", () => {
    const items: ToolbarItem[] = [
      {
        id: "skeleton",
        mode: "3d",
        group: "overlay",
        kind: "popover",
        label: "Skeleton",
        iconId: "skeleton",
        children: [
          {
            id: "local-axis",
            mode: "3d",
            group: "overlay",
            kind: "toggle",
            label: "Local Axis",
            iconId: "axis",
            onRun: vi.fn(),
          },
        ],
      },
    ];

    const { getByRole } = render(<ViewportControls items={items} />);

    fireEvent.click(getByRole("button", { name: "Skeleton" }));

    expect(
      getByRole("button", { name: "Local Axis" }).querySelector("svg"),
    ).toBeNull();
  });

  it("opens viewport submenus on hover and closes after leaving them", () => {
    vi.useFakeTimers();
    try {
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
        <ViewportControls items={items} />,
      );

      fireEvent.pointerEnter(getByRole("button", { name: "Camera" }));
      act(() => {
        vi.advanceTimersByTime(120);
      });

      expect(getByRole("menu")).toBeTruthy();

      fireEvent.pointerLeave(getByRole("button", { name: "Camera" }), {
        relatedTarget: document.body,
      });
      act(() => {
        vi.advanceTimersByTime(180);
      });

      expect(queryByRole("menu")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps hover-opened viewport submenus transient after choosing an item", () => {
    vi.useFakeTimers();
    try {
      const selectFront = vi.fn();
      const items: ToolbarItem[] = [
        {
          id: "camera",
          mode: "3d",
          group: "camera",
          kind: "popover",
          label: "Camera",
          iconId: "camera",
          children: [
            {
              id: "front",
              mode: "3d",
              group: "camera",
              kind: "button",
              label: "Front",
              onRun: selectFront,
            },
          ],
        },
      ];

      const { getByRole, queryByRole } = render(
        <ViewportControls items={items} />,
      );

      fireEvent.pointerEnter(getByRole("button", { name: "Camera" }));
      act(() => {
        vi.advanceTimersByTime(120);
      });

      fireEvent.click(getByRole("button", { name: "Front" }));

      expect(selectFront).toHaveBeenCalledOnce();
      expect(getByRole("menu")).toBeTruthy();

      fireEvent.pointerLeave(getByRole("menu"), {
        relatedTarget: document.body,
      });
      act(() => {
        vi.advanceTimersByTime(180);
      });

      expect(queryByRole("menu")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("switches viewport submenus while hovering between toolbar triggers", () => {
    vi.useFakeTimers();
    try {
      const items: ToolbarItem[] = [
        {
          id: "camera",
          mode: "3d",
          group: "camera",
          kind: "popover",
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
        {
          id: "skeleton",
          mode: "3d",
          group: "overlay",
          kind: "popover",
          label: "Skeleton",
          iconId: "skeleton",
          children: [
            {
              id: "bone",
              mode: "3d",
              group: "overlay",
              kind: "toggle",
              label: "Bone",
              onRun: vi.fn(),
            },
          ],
        },
      ];

      const { getByRole, queryByRole } = render(
        <ViewportControls items={items} />,
      );

      fireEvent.pointerEnter(getByRole("button", { name: "Camera" }));
      act(() => {
        vi.advanceTimersByTime(120);
      });

      expect(getByRole("button", { name: "Front" })).toBeTruthy();

      fireEvent.pointerEnter(getByRole("button", { name: "Skeleton" }));

      expect(queryByRole("button", { name: "Front" })).toBeNull();

      act(() => {
        vi.advanceTimersByTime(120);
      });

      expect(getByRole("button", { name: "Bone" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders toolbar submenu action row state, classes, and shortcuts", () => {
    const items: ToolbarItem[] = [
      {
        id: "camera",
        mode: "3d",
        group: "camera",
        kind: "popover",
        label: "Camera",
        iconId: "camera",
        children: [
          {
            id: "front",
            mode: "3d",
            group: "camera",
            kind: "button",
            label: "Front",
            active: true,
            shortcut: "Numpad 1",
            onRun: vi.fn(),
          },
          {
            id: "top",
            mode: "3d",
            group: "camera",
            kind: "button",
            label: "Top",
            disabled: true,
            onRun: vi.fn(),
          },
        ],
      },
    ];

    const { getByRole } = render(<ViewportControls items={items} />);

    fireEvent.click(getByRole("button", { name: "Camera" }));

    const activeRow = getByRole("button", { name: "Front" });
    expect(activeRow.classList.contains("toolbar-popover-item")).toBe(true);
    expect(activeRow.classList.contains("is-active")).toBe(true);
    expect(activeRow.querySelector(".toolbar-popover-item-check")).toBeTruthy();
    expect(
      getByRole("button", { name: "Front" }).querySelector(
        ".toolbar-popover-item-shortcut",
      )?.textContent,
    ).toBe("Numpad 1");

    const disabledRow = getByRole("button", { name: "Top" });
    expect(disabledRow.classList.contains("toolbar-popover-item")).toBe(true);
    expect(disabledRow.classList.contains("is-active")).toBe(false);
    expect(disabledRow).toHaveProperty("disabled", true);
    expect(disabledRow.querySelector(".toolbar-popover-item-check")).toBeNull();
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
