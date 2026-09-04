import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { PlaybackTimeline } from "../PlaybackTimeline";

type TimelineMockProps = {
  autoReRender?: boolean;
  disableDrag?: boolean;
  editorData: Array<{
    actions: Array<Record<string, unknown>>;
  }>;
  enableRowDrag?: boolean;
  onChange: (editorData: unknown[]) => boolean | void;
  onClickActionOnly?: (event: unknown, params: { time: number }) => void;
  onClickTimeArea?: (time: number) => boolean | void;
  onCursorDrag?: (time: number) => void;
  onCursorDragEnd?: (time: number) => void;
};

type TimelineMockRef = {
  setScrollLeft: (value: number) => void;
  setTime: (time: number) => void;
  target: null;
};

const timelineMock = vi.hoisted(() => ({
  props: [] as Array<TimelineMockProps>,
  setTime: vi.fn(),
  setScrollLeft: vi.fn(),
}));

vi.mock("@xzdarcy/react-timeline-editor", async () => {
  const React = await import("react");
  return {
    Timeline: React.forwardRef<TimelineMockRef, TimelineMockProps>(
      (props, ref) => {
        timelineMock.props.push(props);
        React.useImperativeHandle(ref, () => ({
          setTime: timelineMock.setTime,
          setScrollLeft: timelineMock.setScrollLeft,
          target: null,
        }));
        return <div data-testid="timeline-mock" />;
      },
    ),
  };
});

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  timelineMock.props.length = 0;
  timelineMock.setTime.mockClear();
  timelineMock.setScrollLeft.mockClear();
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
  it("exposes a fixed frame timeline and syncs the cursor from props", () => {
    const onSeek = vi.fn();
    const { getByRole } = renderTimeline({ onSeek });
    const slider = getByRole("slider", { name: "Animation seek" });
    const props = timelineMock.props.at(-1)!;
    const action = props.editorData[0].actions[0];

    expect(slider.getAttribute("aria-valuemax")).toBe("60");
    expect(slider.getAttribute("aria-valuenow")).toBe("30");
    expect(action).toMatchObject({
      start: 0,
      end: 60,
      movable: false,
      flexible: false,
    });
    expect(props.enableRowDrag).toBe(false);
    expect(props.disableDrag).toBe(true);
    expect(props.autoReRender).toBe(false);
    expect(props.onChange([])).toBe(false);
    expect(timelineMock.setTime).toHaveBeenCalledWith(30);
    expect(onSeek).not.toHaveBeenCalled();
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

    const left = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowLeft",
    });
    slider.dispatchEvent(left);
    expect(left.defaultPrevented).toBe(true);
    expect(onSeek).toHaveBeenLastCalledWith(1.9666666666666666);
    expect(parentKeyDown).not.toHaveBeenCalled();

    fireEvent.keyDown(slider, { key: "End" });
    expect(onSeek).toHaveBeenLastCalledWith(2.05);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onSeek).toHaveBeenLastCalledWith(0);
  });

  it("rounds and clamps ruler and cursor callbacks, including fractional ends", () => {
    const onSeek = vi.fn();
    renderTimeline({ duration: 2.05, onSeek });
    const props = timelineMock.props.at(-1)!;

    props.onClickTimeArea!(40.6);
    props.onClickActionOnly!(null, { time: 900.4 });
    props.onCursorDrag!(-2.4);
    props.onCursorDragEnd!(62.4);

    expect(onSeek.mock.calls).toEqual([[41 / 30], [2.05], [0], [2.05]]);
    expect(timelineMock.setTime).toHaveBeenLastCalledWith(62);
    expect(props.onClickTimeArea!(0)).toBe(false);
  });

  it("resets the library timeline when the active clip identity changes", () => {
    const { getByTestId, rerender } = renderTimeline();
    const previousTimeline = getByTestId("timeline-mock");

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
    expect(getByTestId("timeline-mock")).not.toBe(previousTimeline);
    expect(timelineMock.props.at(-1)!.editorData[0].actions[0].end).toBe(900);
    expect(timelineMock.setTime).toHaveBeenLastCalledWith(0);
    expect(timelineMock.setScrollLeft).toHaveBeenLastCalledWith(0);
  });
});
