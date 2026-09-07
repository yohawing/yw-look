import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { PlaybackTimeline } from "../PlaybackTimeline";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  if (!HTMLElement.prototype.setPointerCapture) {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: () => undefined,
    });
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: () => undefined,
    });
  }
  if (!HTMLElement.prototype.hasPointerCapture) {
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: () => true,
    });
  }
});

function renderTimeline(
  overrides: Partial<React.ComponentProps<typeof PlaybackTimeline>> = {},
) {
  return render(
    <PlaybackTimeline
      activeClipIndex={0}
      clipName="Motion"
      currentTime={1}
      duration={2}
      onSeek={vi.fn()}
      {...overrides}
    />,
  );
}

describe("PlaybackTimeline", () => {
  it("uses the new timeline editor with a compact ruler-only projection", () => {
    const { getByRole, container } = renderTimeline();
    const slider = getByRole("slider", { name: "Animation seek" });

    expect(slider.getAttribute("aria-valuemax")).toBe("60");
    expect(slider.getAttribute("aria-valuenow")).toBe("30");
    expect(container.querySelector(".timeline-editor--compact")).toBeTruthy();
    expect(container.querySelector(".timeline-editor__ruler")).toBeTruthy();
    expect(
      container.querySelector(".timeline-editor__tree-viewport"),
    ).toBeTruthy();
    expect(container.querySelector(".timeline-editor__range-bar")).toBeTruthy();
  });

  it("seeks by frame with keyboard bounds while stopping global shortcuts", () => {
    const onSeek = vi.fn();
    const parentKeyDown = vi.fn();
    const { getByRole } = render(
      <div onKeyDown={parentKeyDown}>
        <PlaybackTimeline
          activeClipIndex={0}
          clipName="Fractional"
          currentTime={2}
          duration={2.05}
          onSeek={onSeek}
        />
      </div>,
    );
    const slider = getByRole("slider", { name: "Animation seek" });

    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(onSeek).toHaveBeenLastCalledWith(1.9666666666666666);
    expect(parentKeyDown).not.toHaveBeenCalled();

    fireEvent.keyDown(slider, { key: "End" });
    expect(onSeek).toHaveBeenLastCalledWith(2.05);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onSeek).toHaveBeenLastCalledWith(0);
  });

  it("disables seeking when the clip duration is invalid or empty", () => {
    const { getByRole } = renderTimeline({ duration: Number.NaN });
    const slider = getByRole("slider", { name: "Animation seek" });

    expect(slider.getAttribute("aria-disabled")).toBe("true");
    expect(slider.getAttribute("aria-valuemax")).toBe("0");
    expect(slider.getAttribute("tabindex")).toBe("-1");
  });

  it("syncs the playhead when the current time changes within one clip", () => {
    const { container, rerender } = renderTimeline({ currentTime: 0 });
    const initialPlayhead = container.querySelector(
      ".timeline-editor__playhead",
    ) as HTMLElement;
    const initialTransform = initialPlayhead.style.transform;

    rerender(
      <PlaybackTimeline
        activeClipIndex={0}
        clipName="Motion"
        currentTime={1}
        duration={2}
        onSeek={vi.fn()}
      />,
    );

    expect(
      (container.querySelector(".timeline-editor__playhead") as HTMLElement)
        .style.transform,
    ).not.toBe(initialTransform);
  });

  it("routes ruler scrubbing through the host seek callback", () => {
    const onSeek = vi.fn();
    const { container } = renderTimeline({ duration: 2.05, onSeek });
    const ruler = container.querySelector(
      ".timeline-editor__ruler",
    ) as HTMLDivElement;
    const viewport = container.querySelector(
      ".timeline-editor__viewport",
    ) as HTMLDivElement;
    Object.defineProperty(viewport, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 300, height: 0 }),
    });

    fireEvent.pointerDown(ruler, {
      button: 0,
      clientX: 40,
      pointerId: 1,
    });
    fireEvent.pointerMove(ruler, { clientX: 80, pointerId: 1 });
    fireEvent.pointerUp(ruler, { clientX: 80, pointerId: 1 });

    expect(onSeek).toHaveBeenCalled();
    expect(onSeek.mock.calls.every(([time]) => time >= 0 && time <= 2.05)).toBe(
      true,
    );
  });

  it("resets the library timeline when the active clip identity changes", () => {
    const { container, rerender } = renderTimeline();
    const previousTimeline = container.querySelector(
      ".timeline-editor",
    ) as HTMLElement;

    rerender(
      <PlaybackTimeline
        activeClipIndex={1}
        clipName="Long Motion"
        currentTime={0}
        duration={30}
        onSeek={vi.fn()}
      />,
    );

    expect(previousTimeline.isConnected).toBe(false);
    expect(container.querySelector(".timeline-editor")).not.toBe(
      previousTimeline,
    );
    expect(
      container.querySelector('[role="slider"]')?.getAttribute("aria-valuemax"),
    ).toBe("900");
  });
});
