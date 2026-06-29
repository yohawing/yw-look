import { describe, expect, it } from "vitest";
import {
  buildReadyPreviewFeedback,
  buildRuntimeWarningFeedback,
  joinFeedbackWarnings,
} from "../loadFeedback";

describe("joinFeedbackWarnings", () => {
  it("joins only present warning strings", () => {
    expect(joinFeedbackWarnings(["scale", null, undefined, "runtime"])).toBe(
      "scale\nruntime",
    );
  });

  it("returns null when no warnings are present", () => {
    expect(joinFeedbackWarnings([null, undefined, ""])).toBeNull();
  });
});

describe("buildRuntimeWarningFeedback", () => {
  it("reports loading feedback before the preview is ready", () => {
    expect(
      buildRuntimeWarningFeedback("asset.glb", ["streamed texture"], null),
    ).toEqual({
      mode: "loading",
      message: "Loading asset.glb",
      warning: "streamed texture",
      canResetCamera: false,
    });
  });

  it("reports ready feedback after the preview is ready", () => {
    expect(
      buildRuntimeWarningFeedback("asset.glb", ["runtime"], {
        message: "Preview ready: asset.glb",
        warnings: ["scale", null],
      }),
    ).toEqual({
      mode: "ready",
      message: "Preview ready: asset.glb",
      warning: "scale\nruntime",
      canResetCamera: true,
    });
  });
});

describe("buildReadyPreviewFeedback", () => {
  it("builds ready feedback with null warning when all warnings are empty", () => {
    expect(
      buildReadyPreviewFeedback(
        { message: "Preview ready: asset.glb", warnings: [null] },
        [],
      ),
    ).toEqual({
      mode: "ready",
      message: "Preview ready: asset.glb",
      warning: null,
      canResetCamera: true,
    });
  });
});
