import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { RecentFilesCard } from "../RecentFilesCard";
import { TooltipProvider } from "../ui";
import type { RecentFilesPayload } from "../../lib/recentFiles";

function renderWithTooltipProvider(ui: ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

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

    renderWithTooltipProvider(
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
    renderWithTooltipProvider(
      <RecentFilesCard
        recentFilesPayload={null}
        recentFilesError={null}
        onOpenPath={vi.fn()}
      />,
    );

    expect(screen.getByText("Loading recent files.")).toBeTruthy();
  });

  it("renders the loaded empty state inside the card body", () => {
    renderWithTooltipProvider(
      <RecentFilesCard
        recentFilesPayload={makePayload([])}
        recentFilesError={null}
        onOpenPath={vi.fn()}
      />,
    );

    expect(screen.getByText("No recent files recorded yet.")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("renders basenames and reveals full paths only in tooltips", async () => {
    const payload = makePayload([
      {
        path: "/projects/demo/scene.usd",
        kind: "model",
        lastAccessedAt: "2m ago",
      },
      {
        path: "C:\\Users\\test\\model.abc",
        kind: "texture",
        lastAccessedAt: "1h ago",
      },
    ]);

    renderWithTooltipProvider(
      <RecentFilesCard
        recentFilesPayload={payload}
        recentFilesError={null}
        onOpenPath={vi.fn()}
      />,
    );

    // basename rendering (getByText throws if absent; also verify query form)
    expect(screen.queryByText("scene.usd")).not.toBeNull();
    expect(screen.queryByText("model.abc")).not.toBeNull();
    expect(screen.getByText("Model")).toBeTruthy();
    expect(screen.getByText("Texture")).toBeTruthy();

    // Full paths stay out of the rows and appear on demand.
    expect(screen.queryByText("/projects/demo/scene.usd")).toBeNull();
    expect(screen.queryByText("C:\\Users\\test\\model.abc")).toBeNull();
    expect(screen.queryByText("/path/to/recent.json")).toBeNull();

    fireEvent.pointerMove(screen.getAllByRole("button")[0], {
      pointerType: "mouse",
    });
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "/projects/demo/scene.usd",
    );

    // Last-access timestamps are metadata only and stay hidden from each row.
    expect(screen.queryByText("2m ago")).toBeNull();
    expect(screen.queryByText("1h ago")).toBeNull();
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

    renderWithTooltipProvider(
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

    renderWithTooltipProvider(
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
      expect(button.classList.contains("file-item-row")).toBe(true);
      expect(button.classList.contains("recent-entry")).toBe(true);
    }
  });
});
