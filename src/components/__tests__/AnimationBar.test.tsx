import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AnimationBar } from "../AnimationBar";
import { TooltipProvider } from "../ui";

afterEach(() => {
  cleanup();
});

function renderAnimationBar(
  overrides: Partial<React.ComponentProps<typeof AnimationBar>> = {},
) {
  return render(
    <TooltipProvider>
      <AnimationBar
        activeClipIndex={0}
        clipNames={["Motion"]}
        currentTime={1}
        duration={2}
        isPlaying={false}
        looping={false}
        loopRange={null}
        onSeek={vi.fn()}
        onSelectClip={vi.fn()}
        onSetLooping={vi.fn()}
        onSetLoopRange={vi.fn()}
        onSetPlaybackRate={vi.fn()}
        onTogglePlayback={vi.fn()}
        playbackRate={1}
        {...overrides}
      />
    </TooltipProvider>,
  );
}

describe("AnimationBar", () => {
  it("uses the package standard timeline toolbar and shows the clip name", () => {
    const { container, getByRole, queryByText } = renderAnimationBar();

    expect(queryByText("Timeline")).toBeNull();
    expect(getByRole("group", { name: "Playback controls" })).toBeTruthy();
    expect(getByRole("button", { name: "Play" })).toBeTruthy();
    expect(
      getByRole("application", { name: "Timeline scrubber" }),
    ).toBeTruthy();
    const clipSelect = getByRole("combobox", { name: "Animation clip" });
    expect((clipSelect as HTMLSelectElement).value).toBe("0");
    expect((clipSelect as HTMLSelectElement).disabled).toBe(false);
    expect(container.querySelector(".animation-primary-controls")).toBeNull();
    expect(container.querySelector(".animation-time-readout")).toBeNull();
  });

  it("connects standard play and pause to the host callback", () => {
    const onTogglePlayback = vi.fn();
    const view = renderAnimationBar({ onTogglePlayback });

    fireEvent.click(view.getByRole("button", { name: "Play" }));
    expect(onTogglePlayback).toHaveBeenCalledTimes(1);

    view.rerender(
      <TooltipProvider>
        <AnimationBar
          activeClipIndex={0}
          clipNames={["Motion"]}
          currentTime={1}
          duration={2}
          isPlaying
          looping={false}
          loopRange={null}
          onSeek={vi.fn()}
          onSelectClip={vi.fn()}
          onSetLooping={vi.fn()}
          onSetLoopRange={vi.fn()}
          onSetPlaybackRate={vi.fn()}
          onTogglePlayback={onTogglePlayback}
          playbackRate={1}
        />
      </TooltipProvider>,
    );
    fireEvent.click(view.getByRole("button", { name: "Pause" }));
    expect(onTogglePlayback).toHaveBeenCalledTimes(2);
  });

  it("keeps clip selection as a small external toolbar control", () => {
    const onSelectClip = vi.fn();
    const { getByRole } = renderAnimationBar({
      clipNames: ["Motion", "Walk"],
      onSelectClip,
    });

    fireEvent.change(getByRole("combobox", { name: "Animation clip" }), {
      target: { value: "1" },
    });
    expect(onSelectClip).toHaveBeenCalledWith(1);
  });

  it("connects standard loop and rate controls to host callbacks", () => {
    const onSetLooping = vi.fn();
    const onSetPlaybackRate = vi.fn();
    const { getByRole } = renderAnimationBar({
      looping: false,
      onSetLooping,
      onSetPlaybackRate,
      playbackRate: 1,
    });

    fireEvent.click(getByRole("button", { name: "Loop" }));
    fireEvent.click(getByRole("button", { name: "Playback rate" }));

    expect(onSetLooping).toHaveBeenCalledWith(true);
    expect(onSetPlaybackRate).toHaveBeenCalledWith(2);
  });
});
