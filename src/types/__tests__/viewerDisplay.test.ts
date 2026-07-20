import { describe, expect, it } from "vitest";
import {
  deriveDisplayFlags,
  deriveDisplayMode,
  deriveViewportDisplayState,
} from "../viewer";

describe("viewport display state", () => {
  it.each([
    [{ showTexture: true, showWireframe: false }, "textured"],
    [{ showTexture: false, showWireframe: false }, "untextured"],
    [{ showTexture: false, showWireframe: true }, "wireframe"],
    [{ showTexture: true, showWireframe: true }, "texturedWireframe"],
  ] as const)(
    "derives DisplayMode from texture and wireframe flags",
    (flags, mode) => {
      expect(deriveDisplayMode(flags)).toBe(mode);
      expect(deriveDisplayFlags(mode)).toEqual(flags);
    },
  );

  it("derives the toolbar display state as surface and wireframe axes", () => {
    expect(
      deriveViewportDisplayState({
        showTexture: true,
        showWireframe: true,
        showUnlit: false,
        showNormals: true,
        showVertexColors: false,
      }),
    ).toEqual({
      surface: "normals",
      wireframe: "overlay",
      displayMode: "texturedWireframe",
    });
  });

  it("falls back to shaded when surface display flags conflict", () => {
    expect(
      deriveViewportDisplayState({
        showTexture: false,
        showWireframe: true,
        showUnlit: true,
        showNormals: true,
        showVertexColors: false,
      }),
    ).toEqual({
      surface: "shaded",
      wireframe: "only",
      displayMode: "wireframe",
    });
  });
});
