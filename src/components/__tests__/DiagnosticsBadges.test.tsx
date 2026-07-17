import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AppStatusBar } from "../AppStatusBar";
import { SidebarTabs, type SidebarTabItem } from "../SidebarTabs";
import { TooltipProvider } from "../ui";

type TestTabId = "properties" | "warnings";

const tabs: SidebarTabItem<TestTabId>[] = [
  {
    id: "properties",
    label: "Properties",
    icon: <span>p</span>,
  },
  {
    id: "warnings",
    label: "Diagnostics",
    icon: <span>d</span>,
    badge: { label: "Active diagnostics", tone: "danger" },
  },
];

describe("diagnostics badges", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a dot badge on the diagnostics tab", () => {
    const { getByLabelText } = render(
      <TooltipProvider delayDuration={0}>
        <SidebarTabs
          activeTab="properties"
          onTabChange={() => undefined}
          tabs={tabs}
        />
      </TooltipProvider>,
    );

    expect(getByLabelText("Diagnostics")).toBeTruthy();
    expect(getByLabelText("Active diagnostics").className).toContain(
      "is-danger",
    );
  });

  it("shows the tab label on pointer hover", async () => {
    const { findByRole, getByRole } = render(
      <TooltipProvider delayDuration={0}>
        <SidebarTabs
          activeTab="properties"
          onTabChange={() => undefined}
          tabs={tabs}
        />
      </TooltipProvider>,
    );

    fireEvent.pointerMove(getByRole("tab", { name: "Diagnostics" }), {
      pointerType: "mouse",
    });

    expect((await findByRole("tooltip")).textContent).toBe("Diagnostics");
  });

  it("calls the footer diagnostics action when clicked", () => {
    const onClick = vi.fn();
    const { getByRole } = render(
      <AppStatusBar
        leftItems={[
          { id: "viewer", content: "Viewer: ready" },
          {
            id: "diagnostics",
            content: "Diagnostics: 2 errors",
            onClick,
            tone: "danger",
          },
        ]}
      />,
    );

    fireEvent.click(getByRole("button", { name: "Diagnostics: 2 errors" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
