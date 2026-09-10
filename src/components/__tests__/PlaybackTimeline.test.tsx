import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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
      isPlaying={false}
      looping={false}
      loopRange={null}
      onSeek={vi.fn()}
      onSetLooping={vi.fn()}
      onSetLoopRange={vi.fn()}
      onSetPlaybackRate={vi.fn()}
      onTogglePlayback={vi.fn()}
      playbackRate={1}
      {...overrides}
    />,
  );
}

describe("PlaybackTimeline", () => {
  it("shows absolute negative frames while seeking in runtime local time", () => {
    const onSeek = vi.fn();
    const view = renderTimeline({
      rangeStart: -2,
      duration: 5,
      currentTime: 1,
      onSeek,
    });
    expect(view.getByText("-0030 / 0090")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Skip to start" }));
    expect(onSeek).toHaveBeenLastCalledWith(0);
    fireEvent.click(view.getByRole("button", { name: "Skip to end" }));
    expect(onSeek).toHaveBeenLastCalledWith(5);
    fireEvent.click(view.getByRole("button", { name: "Next frame" }));
    expect(onSeek.mock.lastCall?.[0]).toBeCloseTo(1 + 1 / 30);
  });
  it("renders the package standard toolbar and measurable timeline viewport", () => {
    const { container, getByRole, getByText, queryByText } = renderTimeline();

    expect(container.querySelector(".timeline-editor--full")).toBeTruthy();
    expect(queryByText("Timeline")).toBeNull();
    expect(getByRole("group", { name: "Playback controls" })).toBeTruthy();
    expect(
      getByRole("application", { name: "Timeline scrubber" }),
    ).toBeTruthy();
    expect(container.querySelector(".timeline-editor__ruler")).toBeTruthy();
    expect(container.querySelector(".timeline-editor__viewport")).toBeTruthy();
    expect(getByText("No timeline tracks")).toBeTruthy();
  });

  it("routes standard play and pause controls to the host", () => {
    const onTogglePlayback = vi.fn();
    const view = renderTimeline({ onTogglePlayback });

    fireEvent.click(view.getByRole("button", { name: "Play" }));
    expect(onTogglePlayback).toHaveBeenCalledTimes(1);

    view.rerender(
      <PlaybackTimeline
        activeClipIndex={0}
        clipName="Motion"
        currentTime={1}
        duration={2}
        isPlaying
        looping={false}
        loopRange={null}
        onSeek={vi.fn()}
        onSetLooping={vi.fn()}
        onSetLoopRange={vi.fn()}
        onSetPlaybackRate={vi.fn()}
        onTogglePlayback={onTogglePlayback}
        playbackRate={1}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Pause" }));
    expect(onTogglePlayback).toHaveBeenCalledTimes(2);
  });

  it("routes standard transport seeks to the host", () => {
    const onSeek = vi.fn();
    const { getByRole } = renderTimeline({ onSeek });

    fireEvent.click(getByRole("button", { name: "Skip to start" }));
    expect(onSeek).toHaveBeenLastCalledWith(0);
    fireEvent.click(getByRole("button", { name: "Skip to end" }));
    expect(onSeek).toHaveBeenLastCalledWith(2);
    fireEvent.click(getByRole("button", { name: "Next frame" }));
    expect(onSeek).toHaveBeenLastCalledWith(31 / 30);
  });

  it("routes standard loop and rate controls to the host", () => {
    const onSetLooping = vi.fn();
    const onSetPlaybackRate = vi.fn();
    const { getByRole } = renderTimeline({
      onSetLooping,
      onSetPlaybackRate,
    });

    fireEvent.click(getByRole("button", { name: "Loop" }));
    fireEvent.click(getByRole("button", { name: "Playback rate" }));

    expect(onSetLooping).toHaveBeenCalledWith(true);
    expect(onSetPlaybackRate).toHaveBeenCalledWith(2);
  });

  it.each([0, -2])(
    "routes loop range creation, redefinition, and clear with start %s",
    async (rangeStart) => {
      const onSetLoopRange = vi.fn();
      const view = renderTimeline({ onSetLoopRange, rangeStart });
      const viewport = view.container.querySelector(
        ".timeline-editor__viewport",
      ) as HTMLDivElement;
      const loopLane = view.container.querySelector(
        ".timeline-editor__loop-lane",
      ) as HTMLDivElement;
      Object.defineProperty(viewport, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ left: 0, top: 0, width: 300, height: 100 }),
      });

      const dragLoopRange = (startX: number, endX: number) => {
        fireEvent.pointerDown(loopLane, {
          button: 0,
          clientX: startX,
          pointerId: 1,
        });
        fireEvent.pointerMove(loopLane, { clientX: endX, pointerId: 1 });
        fireEvent.pointerUp(loopLane, { clientX: endX, pointerId: 1 });
      };

      dragLoopRange(30, 150);
      await waitFor(() => expect(onSetLoopRange).toHaveBeenCalledTimes(1));
      const firstRange = onSetLoopRange.mock.calls[0]?.[0] as {
        start: number;
        end: number;
      };
      expect(firstRange.end).toBeGreaterThan(firstRange.start);

      dragLoopRange(60, 210);
      await waitFor(() => expect(onSetLoopRange).toHaveBeenCalledTimes(2));
      const secondRange = onSetLoopRange.mock.calls[1]?.[0] as {
        start: number;
        end: number;
      };
      expect(secondRange.end).toBeGreaterThan(secondRange.start);
      expect(secondRange).not.toEqual(firstRange);

      view.rerender(
        <PlaybackTimeline
          activeClipIndex={0}
          clipName="Motion"
          currentTime={1}
          duration={2}
          isPlaying={false}
          looping={false}
          loopRange={secondRange}
          onSeek={vi.fn()}
          onSetLooping={vi.fn()}
          onSetLoopRange={onSetLoopRange}
          onSetPlaybackRate={vi.fn()}
          onTogglePlayback={vi.fn()}
          playbackRate={1}
        />,
      );
      fireEvent.click(view.getByRole("button", { name: "Clear loop range" }));
      await waitFor(() =>
        expect(onSetLoopRange).toHaveBeenLastCalledWith(null),
      );
    },
  );

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
      value: () => ({ left: 0, top: 0, width: 300, height: 100 }),
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

  it("disables standard transport when the clip duration is invalid", () => {
    const { getByRole } = renderTimeline({ duration: Number.NaN });

    expect(
      (getByRole("button", { name: "Play" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (getByRole("button", { name: "Skip to start" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
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
        isPlaying={false}
        looping={false}
        loopRange={null}
        onSeek={vi.fn()}
        onSetLooping={vi.fn()}
        onSetLoopRange={vi.fn()}
        onSetPlaybackRate={vi.fn()}
        onTogglePlayback={vi.fn()}
        playbackRate={1}
      />,
    );

    expect(
      (container.querySelector(".timeline-editor__playhead") as HTMLElement)
        .style.transform,
    ).not.toBe(initialTransform);
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
        isPlaying={false}
        looping={false}
        loopRange={null}
        onSeek={vi.fn()}
        onSetLooping={vi.fn()}
        onSetLoopRange={vi.fn()}
        onSetPlaybackRate={vi.fn()}
        onTogglePlayback={vi.fn()}
        playbackRate={1}
      />,
    );

    expect(previousTimeline.isConnected).toBe(false);
    expect(container.querySelector(".timeline-editor")).not.toBe(
      previousTimeline,
    );
  });
});
