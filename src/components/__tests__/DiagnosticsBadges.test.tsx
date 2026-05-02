import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AppStatusBar } from "../AppStatusBar";
import { SidebarTabs, type SidebarTabItem } from "../SidebarTabs";

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
    badge: { count: 3, tone: "danger" },
  },
];

describe("diagnostics badges", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a count badge on the diagnostics tab", () => {
    const { getByLabelText, getByText } = render(
      <SidebarTabs
        activeTab="properties"
        onTabChange={() => undefined}
        tabs={tabs}
      />,
    );

    expect(getByLabelText("Diagnostics")).toBeTruthy();
    expect(getByText("3").className).toContain("is-danger");
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
