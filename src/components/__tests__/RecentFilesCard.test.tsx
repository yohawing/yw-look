import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecentFilesCard } from "../RecentFilesCard";
import type { RecentFilesPayload } from "../../lib/recentFiles";

describe("RecentFilesCard", () => {
  const makePayload = (
    entries: RecentFilesPayload["entries"],
  ): RecentFilesPayload => ({
    recentFilesPath: "/path/to/recent.json",
    entries,
  });

  it("renders an error before loaded recent files", () => {
    const payload = makePayload([
      {
        path: "/projects/demo/scene.usd",
        kind: "usd",
        lastAccessedAt: "2m ago",
      },
    ]);

    render(
      <RecentFilesCard
        recentFilesPayload={payload}
        recentFilesError="Failed to load recent files."
        onOpenPath={vi.fn()}
      />,
    );

    expect(screen.getByText("Failed to load recent files.")).toBeTruthy();
    expect(screen.queryByText("scene.usd")).toBeNull();
  });

  it("renders a loading state while payload is absent", () => {
    render(
      <RecentFilesCard
        recentFilesPayload={null}
        recentFilesError={null}
        onOpenPath={vi.fn()}
      />,
    );

    expect(screen.getByText("Loading recent files.")).toBeTruthy();
  });

  it("renders the loaded empty state inside the card body", () => {
    render(
      <RecentFilesCard
        recentFilesPayload={makePayload([])}
        recentFilesError={null}
        onOpenPath={vi.fn()}
      />,
    );

    expect(screen.getByText("No recent files recorded yet.")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("renders basename for each recent file entry", () => {
    const payload = makePayload([
      {
        path: "/projects/demo/scene.usd",
        kind: "usd",
        lastAccessedAt: "2m ago",
      },
      {
        path: "C:\\Users\\test\\model.abc",
        kind: "abc",
        lastAccessedAt: "1h ago",
      },
    ]);

    render(
      <RecentFilesCard
        recentFilesPayload={payload}
        recentFilesError={null}
        onOpenPath={vi.fn()}
      />,
    );

    // basename rendering (getByText throws if absent; also verify query form)
    expect(screen.queryByText("scene.usd")).not.toBeNull();
    expect(screen.queryByText("model.abc")).not.toBeNull();

    // full paths still shown
    expect(screen.queryByText("/projects/demo/scene.usd")).not.toBeNull();
    expect(screen.queryByText("C:\\Users\\test\\model.abc")).not.toBeNull();
  });

  it("calls onOpenPath with full path when a recent file row is clicked", () => {
    const onOpenPath = vi.fn();
    const payload = makePayload([
      {
        path: "/projects/demo/scene.usd",
        kind: "usd",
        lastAccessedAt: "2m ago",
      },
    ]);

    render(
      <RecentFilesCard
        recentFilesPayload={payload}
        recentFilesError={null}
        onOpenPath={onOpenPath}
      />,
    );

    const row = screen.getByRole("button");
    fireEvent.click(row);

    expect(onOpenPath).toHaveBeenCalledTimes(1);
    expect(onOpenPath).toHaveBeenCalledWith("/projects/demo/scene.usd");
  });

  it("renders multiple rows as buttons preserving ul > li > button", () => {
    const payload = makePayload([
      { path: "/a/one.usd", kind: "usd", lastAccessedAt: "now" },
      { path: "/b/two.usd", kind: "usd", lastAccessedAt: "now" },
    ]);

    render(
      <RecentFilesCard
        recentFilesPayload={payload}
        recentFilesError={null}
        onOpenPath={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.parentElement?.tagName).toBe("LI");
      expect(button.parentElement?.parentElement?.tagName).toBe("UL");
      expect(button.classList.contains("yl-selectable-list-item")).toBe(true);
      expect(button.classList.contains("recent-entry")).toBe(true);
    }
  });
});
