import { useEffect } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarPanels } from "../SidebarPanels";
import type { SidebarTabId } from "../../types/ui";

afterEach(cleanup);

describe("visited sidebar panels", () => {
  it("keeps DOM state and fresh props while stopping hidden effects", async () => {
    const start = vi.fn();
    const stop = vi.fn();
    function Content({ tab, label }: { tab: string; label: string }) {
      useEffect(() => {
        start(tab);
        return () => {
          stop(tab);
        };
      }, [tab]);
      return (
        <>
          <span>{label}</span>
          <input aria-label={tab} defaultValue="" />
        </>
      );
    }
    const content = (label: string) => (tab: SidebarTabId) => (
      <Content tab={tab} label={label} />
    );
    const view = render(
      <SidebarPanels
        activeTab="hierarchy"
        fileIdentity="a"
        renderPanel={content("old")}
      />,
    );
    expect(start.mock.calls).toEqual([["hierarchy"]]);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Hero" },
    });
    const input = screen.getByRole("textbox");
    view.rerender(
      <SidebarPanels
        activeTab="settings"
        fileIdentity="a"
        renderPanel={content("new")}
      />,
    );
    await waitFor(() => expect(stop).toHaveBeenCalledWith("hierarchy"));
    expect(screen.getByRole("textbox").getAttribute("aria-label")).toBe(
      "settings",
    );
    view.rerender(
      <SidebarPanels
        activeTab="hierarchy"
        fileIdentity="a"
        renderPanel={content("new")}
      />,
    );
    expect(screen.getByRole("textbox")).toBe(input);
    expect((input as HTMLInputElement).value).toBe("Hero");
    expect(input.previousSibling?.textContent).toBe("new");
    expect(
      start.mock.calls.filter(([tab]) => tab === "hierarchy"),
    ).toHaveLength(2);
    expect(start.mock.calls.some(([tab]) => tab === "materials")).toBe(false);
  });

  it("resets asset UI on a hidden file change while retaining Settings", () => {
    const renderPanel = (tab: SidebarTabId) => (
      <input aria-label={tab} defaultValue="" />
    );
    const view = render(
      <SidebarPanels
        activeTab="hierarchy"
        fileIdentity="a"
        renderPanel={renderPanel}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "old asset" },
    });
    view.rerender(
      <SidebarPanels
        activeTab="settings"
        fileIdentity="a"
        renderPanel={renderPanel}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "settings UI" },
    });
    view.rerender(
      <SidebarPanels
        activeTab="settings"
        fileIdentity="b"
        renderPanel={renderPanel}
      />,
    );
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "settings UI",
    );
    view.rerender(
      <SidebarPanels
        activeTab="hierarchy"
        fileIdentity="b"
        renderPanel={renderPanel}
      />,
    );
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });
});
