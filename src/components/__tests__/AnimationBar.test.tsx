import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AnimationBar } from "../AnimationBar";
import { TooltipProvider } from "../ui";

afterEach(() => {
  cleanup();
});

function renderAnimationBar() {
  return render(
    <TooltipProvider>
      <AnimationBar
        activeClipIndex={0}
        clipNames={["Motion"]}
        currentTime={1}
        duration={2}
        isPlaying={false}
        onSeek={vi.fn()}
        onSelectClip={vi.fn()}
        onStep={vi.fn()}
        onTogglePlayback={vi.fn()}
      />
    </TooltipProvider>,
  );
}

describe("AnimationBar", () => {
  it("uses a 30 fps frame readout and frame-aligned seek step by default", () => {
    const { getByRole, getByText } = renderAnimationBar();

    expect(getByText("30f")).toBeTruthy();
    expect(getByText("60f")).toBeTruthy();
    expect(
      document.querySelector(".animation-frame-rate")?.textContent,
    ).toContain("30 fps");
    const timeline = getByRole("slider", { name: "Animation seek" });
    expect(timeline.getAttribute("aria-valuemax")).toBe("60");
    expect(timeline.getAttribute("aria-valuenow")).toBe("30");
    expect(timeline.getAttribute("data-frame-rate")).toBe("30");
  });

  it("toggles from frames to clock time when the readout is clicked", () => {
    const { getByRole, getByText } = renderAnimationBar();

    fireEvent.click(
      getByRole("button", {
        name: /time display: frames at 30 fps/i,
      }),
    );

    expect(getByText("0:01.00")).toBeTruthy();
    expect(getByText("0:02.00")).toBeTruthy();
    expect(
      document.querySelector(".animation-time-readout")?.textContent,
    ).not.toContain("fps");
  });
});
