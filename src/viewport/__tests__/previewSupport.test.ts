import { describe, expect, it } from "vitest";
import type { PreviewSupportState, ViewerMode } from "../../types/viewer";
import { resolveEffectiveOverlayMode } from "../previewSupport";

function resolveOverlayMode({
  currentFilePath = "/asset.glb",
  previewSupportState = "implemented",
  activePreviewPath = "/asset.glb",
  overlayMode = "ready",
}: {
  currentFilePath?: string | null;
  previewSupportState?: PreviewSupportState;
  activePreviewPath?: string | null;
  overlayMode?: ViewerMode;
} = {}) {
  return resolveEffectiveOverlayMode({
    currentFilePath,
    previewSupportState,
    activePreviewPath,
    overlayMode,
  });
}

describe("resolveEffectiveOverlayMode", () => {
  it("shows the empty overlay when no file is selected", () => {
    expect(
      resolveOverlayMode({
        currentFilePath: null,
        previewSupportState: "unsupported",
        activePreviewPath: "/asset.glb",
        overlayMode: "ready",
      }),
    ).toBe("empty");
  });

  it.each([
    "missingOptionalLoader",
    "disabledOptionalLoader",
    "incompatibleOptionalLoader",
    "unsupported",
  ] as const)("uses terminal preview support state %s directly", (state) => {
    expect(resolveOverlayMode({ previewSupportState: state })).toBe(state);
  });

  it("shows loading while the active preview belongs to an older file", () => {
    expect(
      resolveOverlayMode({
        currentFilePath: "/next.glb",
        activePreviewPath: "/previous.glb",
        overlayMode: "ready",
      }),
    ).toBe("loading");
  });

  it("uses the viewport overlay mode once the current file is active", () => {
    expect(
      resolveOverlayMode({
        currentFilePath: "/asset.glb",
        activePreviewPath: "/asset.glb",
        overlayMode: "loadFailed",
      }),
    ).toBe("loadFailed");
  });
});
