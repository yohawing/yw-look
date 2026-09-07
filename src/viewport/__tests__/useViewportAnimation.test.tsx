import { act, cleanup, renderHook } from "@testing-library/react";
import {
  AnimationClip,
  AnimationMixer,
  Group,
  LoopOnce,
  NumberKeyframeTrack,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState, type MutableRefObject } from "react";
import type {
  PackRuntimeAnimation,
  PackRuntimeAnimationSnapshot,
} from "../../types/format-pack";
import type { AnimationState, SceneContext } from "../../types/viewer";
import { useViewportAnimation } from "../useViewportAnimation";

type AnimationHarnessOptions = {
  initialAnimationState: AnimationState;
  sceneContextRef: MutableRefObject<SceneContext | null>;
};

function useAnimationHarness({
  initialAnimationState,
  sceneContextRef,
}: AnimationHarnessOptions) {
  const [animationState, setAnimationState] = useState(initialAnimationState);

  return useViewportAnimation({
    animationState,
    setAnimationState,
    sceneContextRef,
    morphTargetValuesRef: { current: undefined },
    viewerSurfaceMode: "asset",
  });
}

function createRafDriver() {
  let callback: FrameRequestCallback | null = null;

  vi.spyOn(window, "requestAnimationFrame").mockImplementation((next) => {
    callback = next;
    return 1;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

  return {
    tick(timestamp: number) {
      if (!callback) {
        throw new Error("requestAnimationFrame callback was not scheduled");
      }
      act(() => callback?.(timestamp));
    },
  };
}

function createBaseContext(): SceneContext {
  return {
    renderer: null,
    scene: null,
    camera: null,
    controls: null,
    pmremGenerator: null,
    mountedObject: null,
    sourceObject: null,
    previewObject: null,
    boneOnlyPreview: false,
    cleanupUrls: [],
    cleanupCallbacks: [],
    animationRoot: null,
    mixer: null,
    clips: [],
    activeAction: null,
    packRuntime: null,
    mmdModel: null,
    mmdMotion: null,
    mmdLightSync: null,
    textureRegistry: new Map(),
    rawMaxDimension: 0,
  } as unknown as SceneContext;
}

function createAnimationState(duration: number): AnimationState {
  return {
    clipNames: ["clip"],
    activeClipIndex: 0,
    currentTime: 0,
    duration,
    isPlaying: true,
  };
}

function createMixerContext() {
  const object = new Group();
  const clip = new AnimationClip("clip", 1, [
    new NumberKeyframeTrack(".position[x]", [0, 1], [0, 1]),
  ]);
  const mixer = new AnimationMixer(object);
  const activeAction = mixer.clipAction(clip).play();
  const context = createBaseContext();
  context.animationRoot = object;
  context.mixer = mixer;
  context.clips = [clip];
  context.activeAction = activeAction;
  return { context, activeAction };
}

function createPackContext(initialTime = 0) {
  let currentTime = initialTime;
  const duration = 1;
  const snapshot = (): PackRuntimeAnimationSnapshot => ({
    currentTime,
    duration,
  });
  const animation: PackRuntimeAnimation = {
    hasAnimation: () => true,
    update: vi.fn((deltaSeconds: number) => {
      currentTime = (currentTime + deltaSeconds) % duration;
    }),
    getSnapshot: vi.fn(snapshot),
    seek: vi.fn((time: number) => {
      currentTime = Math.min(Math.max(time, 0), duration);
      return snapshot();
    }),
    step: vi.fn(() => snapshot()),
  };
  const context = createBaseContext();
  context.packRuntime = { animation, dispose: vi.fn() };
  return { context, animation };
}

describe("useViewportAnimation", () => {
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("scales a real Three.js mixer and stops at the clip end when looping is disabled", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const { context, activeAction } = createMixerContext();
    const object = context.animationRoot as Group;
    const sceneContextRef = { current: context };
    const raf = createRafDriver();
    const { result } = renderHook(() =>
      useAnimationHarness({
        initialAnimationState: createAnimationState(1),
        sceneContextRef,
      }),
    );

    act(() => result.current.handleSetPlaybackRate(2));
    expect(result.current.playbackRate).toBe(2);
    raf.tick(250);
    expect(activeAction.time).toBeCloseTo(0.5, 5);

    act(() => result.current.handleSetLooping(false));
    expect(activeAction.loop).toBe(LoopOnce);
    raf.tick(1_500);

    expect(activeAction.time).toBeCloseTo(1, 5);
    expect(object.position.x).toBeCloseTo(1, 5);
    expect(result.current.animationState).toMatchObject({
      currentTime: 1,
      duration: 1,
      isPlaying: false,
    });

    act(() => result.current.handleSeek(0.4));
    expect(activeAction.time).toBeCloseTo(0.4, 5);
    expect(object.position.x).toBeCloseTo(0.4, 5);
    act(() => result.current.handleTogglePlayback());
    expect(activeAction.time).toBeCloseTo(0.4, 5);
    expect(result.current.animationState.isPlaying).toBe(true);

    act(() => result.current.handleTogglePlayback());
    act(() => result.current.handleSeek(1));
    act(() => result.current.handleTogglePlayback());
    expect(activeAction.time).toBe(0);
    expect(result.current.animationState.isPlaying).toBe(true);
    raf.tick(250);
    expect(activeAction.time).toBeCloseTo(0.5, 5);
  });

  it("applies rate and non-loop end handling to a pack runtime without wrapping", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const { context, animation } = createPackContext();
    const sceneContextRef = { current: context };
    const raf = createRafDriver();
    const { result } = renderHook(() =>
      useAnimationHarness({
        initialAnimationState: createAnimationState(1),
        sceneContextRef,
      }),
    );

    act(() => result.current.handleSetPlaybackRate(2));
    raf.tick(250);
    expect(animation.update).toHaveBeenLastCalledWith(0.5);
    expect(result.current.animationState.currentTime).toBeCloseTo(0.5, 5);

    act(() => result.current.handleSetLooping(false));
    raf.tick(600);
    expect(animation.seek).toHaveBeenLastCalledWith(1);
    expect(animation.update).toHaveBeenCalledTimes(1);
    expect(result.current.animationState).toMatchObject({
      currentTime: 1,
      isPlaying: false,
    });

    act(() => result.current.handleTogglePlayback());
    expect(animation.seek).toHaveBeenLastCalledWith(0);
    expect(result.current.animationState).toMatchObject({
      currentTime: 0,
      isPlaying: true,
    });
  });

  it("keeps a looping pack runtime playing through its existing wrap", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const { context, animation } = createPackContext(0.9);
    const sceneContextRef = { current: context };
    const raf = createRafDriver();
    const { result } = renderHook(() =>
      useAnimationHarness({
        initialAnimationState: {
          ...createAnimationState(1),
          currentTime: 0.9,
        },
        sceneContextRef,
      }),
    );

    raf.tick(200);
    expect(animation.update).toHaveBeenLastCalledWith(0.2);
    expect(result.current.animationState.currentTime).toBeCloseTo(0.1, 5);
    expect(result.current.animationState.isPlaying).toBe(true);
  });

  it("repeats a normalized loop range with rate overshoot for the pack runtime", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const { context, animation } = createPackContext(0.7);
    const sceneContextRef = { current: context };
    const raf = createRafDriver();
    const { result } = renderHook(() =>
      useAnimationHarness({
        initialAnimationState: {
          ...createAnimationState(1),
          currentTime: 0.7,
        },
        sceneContextRef,
      }),
    );

    act(() => result.current.handleSetLoopRange({ start: -1, end: 2 }));
    expect(result.current.loopRange).toEqual({ start: 0, end: 1 });
    act(() => result.current.handleSetLoopRange(null));
    expect(result.current.loopRange).toBeNull();
    act(() => result.current.handleSetLoopRange({ start: 0.75, end: 0.25 }));
    act(() => result.current.handleSetPlaybackRate(2));
    expect(result.current.loopRange).toEqual({ start: 0.25, end: 0.75 });

    raf.tick(300);

    expect(animation.update).not.toHaveBeenCalled();
    expect(animation.seek).toHaveBeenLastCalledWith(expect.closeTo(0.3, 5));
    expect(result.current.animationState.currentTime).toBeCloseTo(0.3, 5);
    expect(result.current.animationState.isPlaying).toBe(true);

    animation.seek(0.3);
    raf.tick(400);
    expect(animation.update).toHaveBeenLastCalledWith(0.2);
    expect(animation.seek).toHaveBeenLastCalledWith(0.3);
    expect(result.current.animationState.currentTime).toBeCloseTo(0.5, 5);
  });

  it("applies a loop range to a real Three.js action and clears it on animation replacement", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const { context, activeAction } = createMixerContext();
    activeAction.time = 0.7;
    context.mixer?.update(0);
    const object = context.animationRoot as Group;
    const mixerUpdate = vi.spyOn(context.mixer!, "update");
    const sceneContextRef = { current: context };
    const raf = createRafDriver();
    const { result } = renderHook(() =>
      useAnimationHarness({
        initialAnimationState: {
          ...createAnimationState(1),
          currentTime: 0.7,
        },
        sceneContextRef,
      }),
    );

    act(() => result.current.handleSetLoopRange({ start: 0.25, end: 0.75 }));
    act(() => result.current.handleSetPlaybackRate(2));
    raf.tick(300);

    expect(activeAction.time).toBeCloseTo(0.3, 5);
    expect(object.position.x).toBeCloseTo(0.3, 5);
    expect(result.current.animationState.isPlaying).toBe(true);

    activeAction.time = 0.3;
    context.mixer?.update(0);
    mixerUpdate.mockClear();
    raf.tick(400);
    expect(mixerUpdate).toHaveBeenLastCalledWith(0.1);
    expect(object.position.x).toBeCloseTo(0.5, 5);

    const replacement = createMixerContext();
    sceneContextRef.current = replacement.context;
    act(() => result.current.handleSetLooping(false));
    expect(result.current.loopRange).toBeNull();
  });

  it("handles Space and frame-step keys without stealing form controls or repeating Space", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const { context, activeAction } = createMixerContext();
    const sceneContextRef = { current: context };
    const { result } = renderHook(() =>
      useAnimationHarness({
        initialAnimationState: createAnimationState(1),
        sceneContextRef,
      }),
    );

    const dispatchKey = (
      target: EventTarget,
      init: KeyboardEventInit,
    ): KeyboardEvent => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      target.dispatchEvent(event);
      return event;
    };

    let event: KeyboardEvent;
    act(() => {
      event = dispatchKey(document.body, { key: " ", code: "Space" });
    });
    expect(event!.defaultPrevented).toBe(true);
    expect(result.current.animationState.isPlaying).toBe(false);

    act(() => {
      event = dispatchKey(document.body, { key: "ArrowRight" });
    });
    expect(event!.defaultPrevented).toBe(true);
    expect(activeAction.time).toBeCloseTo(1 / 30, 5);
    expect(result.current.animationState.isPlaying).toBe(false);

    act(() => {
      event = dispatchKey(document.body, {
        key: " ",
        code: "Space",
        repeat: true,
      });
    });
    expect(event!.defaultPrevented).toBe(false);
    expect(result.current.animationState.isPlaying).toBe(false);

    act(() => {
      result.current.handleTogglePlayback();
    });
    act(() => {
      event = dispatchKey(document.body, { key: "ArrowRight", ctrlKey: true });
    });
    expect(event!.defaultPrevented).toBe(true);
    expect(activeAction.time).toBe(result.current.animationState.duration);
    expect(result.current.animationState.isPlaying).toBe(false);

    act(() => {
      event = dispatchKey(document.body, { key: "ArrowLeft", ctrlKey: true });
    });
    expect(event!.defaultPrevented).toBe(true);
    expect(activeAction.time).toBe(0);

    const input = document.createElement("input");
    document.body.append(input);
    act(() => {
      event = dispatchKey(input, { key: " ", code: "Space" });
    });
    expect(event!.defaultPrevented).toBe(false);
    expect(result.current.animationState.isPlaying).toBe(false);
    act(() => {
      event = dispatchKey(input, { key: "ArrowRight", ctrlKey: true });
    });
    expect(event!.defaultPrevented).toBe(false);
    expect(activeAction.time).toBe(0);
  });
});
