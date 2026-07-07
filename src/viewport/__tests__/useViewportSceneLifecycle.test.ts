import { describe, expect, it } from "vitest";
import { getRendererLifetimeBoundary } from "../useViewportSceneLifecycle";

describe("getRendererLifetimeBoundary", () => {
  it.each(["glb", "fbx", "obj", "dae", "stl", "usd", "usdz", undefined])(
    "keeps the default renderer for .%s",
    (extension) => {
      expect(getRendererLifetimeBoundary(extension)).toBe(false);
    },
  );

  it.each(["pmx", "pmd"])(
    "requires a logarithmic-depth renderer for .%s",
    (extension) => {
      expect(getRendererLifetimeBoundary(extension)).toBe(true);
    },
  );

  it("groups default formats under the same lifetime boundary", () => {
    const defaultExtensions = ["glb", "fbx", "obj", "dae", "stl"] as const;
    const boundaries = defaultExtensions.map((extension) =>
      getRendererLifetimeBoundary(extension),
    );

    expect(new Set(boundaries).size).toBe(1);
    expect(boundaries[0]).toBe(false);
  });

  it("switches the lifetime boundary only across the MMD preset", () => {
    expect(getRendererLifetimeBoundary("glb")).not.toBe(
      getRendererLifetimeBoundary("pmx"),
    );
  });
});
