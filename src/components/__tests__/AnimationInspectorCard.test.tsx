import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AnimationInspectorCard } from "../AnimationInspectorCard";
import type {
  AnimationClipMetadata,
  AnimationTrackMetadata,
  AssetMetadata,
} from "../../types/viewer";

afterEach(() => {
  cleanup();
});

const baseTrack: AnimationTrackMetadata = {
  name: "Armature/Hips.position",
  target: "Armature/Hips",
  propertyPath: "position",
  keyframeCount: 8,
  timeRange: [0, 1.25],
  interpolation: "linear",
};

function makeClip(
  overrides: Partial<AnimationClipMetadata> = {},
): AnimationClipMetadata {
  return {
    name: "Walk Cycle",
    duration: 1.25,
    trackCount: 2,
    keyframeCount: 15,
    estimatedFrameRate: 30,
    tracks: [
      baseTrack,
      {
        ...baseTrack,
        name: "Armature/Spine.quaternion",
        target: "Armature/Spine",
        propertyPath: "quaternion",
        keyframeCount: 7,
        timeRange: [0.1, 1.2],
        interpolation: "smooth",
      },
    ],
    ...overrides,
  };
}

function makeMetadata(animationClips?: AnimationClipMetadata[]): AssetMetadata {
  return {
    formatLabel: "FBX",
    formatVersion: null,
    nodeCount: 1,
    meshCount: 1,
    materialCount: 0,
    textureCount: 0,
    hasAnimation: (animationClips?.length ?? 0) > 0,
    animationClips,
    hierarchy: [],
    textures: [],
    materials: [],
    lights: [],
    cameras: [],
    objectInfo: {},
  };
}

function renderFromMetadata(metadata: AssetMetadata) {
  const clips = metadata.animationClips ?? [];

  return render(
    clips.length > 0 ? <AnimationInspectorCard clips={clips} /> : null,
  );
}

describe("AnimationInspectorCard", () => {
  it("renders clip summary for a model with animation metadata", () => {
    renderFromMetadata(makeMetadata([makeClip()]));

    expect(screen.getAllByText("Walk Cycle")).toHaveLength(2);
    expect(screen.getAllByText("1.250s").length).toBeGreaterThan(0);
    expect(screen.getByText(/2 tracks/)).toBeTruthy();
    expect(screen.getByText(/15 keys/)).toBeTruthy();
    expect(screen.getAllByText("30 fps").length).toBeGreaterThan(0);
  });

  it("shows track details when a clip is selected", () => {
    renderFromMetadata(
      makeMetadata([
        makeClip({ name: "Idle", tracks: [] }),
        makeClip({ name: "Jump" }),
      ]),
    );

    fireEvent.click(screen.getByRole("button", { name: /Jump/ }));

    expect(screen.getByText("Armature/Hips.position")).toBeTruthy();
    expect(screen.getAllByText("Target").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Armature/Hips")).toBeTruthy();
    expect(screen.getAllByText("Property").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("position")).toBeTruthy();
    expect(screen.getAllByText("Keys").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("0.000 - 1.250s")).toBeTruthy();
    expect(screen.getAllByText("Interpolation").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getByText("linear")).toBeTruthy();
  });

  it("renders every clip when multiple animation clips are available", () => {
    renderFromMetadata(
      makeMetadata([
        makeClip({ name: "Idle" }),
        makeClip({ name: "Run", duration: 0.75, keyframeCount: 24 }),
        makeClip({ name: "Jump", duration: 0.5, keyframeCount: 12 }),
      ]),
    );

    expect(screen.getAllByText("Idle").length).toBeGreaterThan(0);
    expect(screen.getByText("Run")).toBeTruthy();
    expect(screen.getByText("Jump")).toBeTruthy();
  });

  it("renders nothing when animationClips is undefined or empty", () => {
    const withoutClips = renderFromMetadata(makeMetadata(undefined));
    expect(withoutClips.container.innerHTML).toBe("");
    withoutClips.unmount();

    const withEmptyClips = renderFromMetadata(makeMetadata([]));
    expect(withEmptyClips.container.innerHTML).toBe("");
  });

  it('renders "n/a" when estimatedFrameRate is null', () => {
    renderFromMetadata(makeMetadata([makeClip({ estimatedFrameRate: null })]));

    expect(screen.getAllByText("n/a").length).toBeGreaterThan(0);
  });
});
