import { describe, expect, it, vi } from "vitest";
import { build3DToolbar } from "../build3DToolbar";
import type { Build3DToolbarOptions } from "../../../types/viewer";

function createOptions(): Build3DToolbarOptions {
  return {
    cameraPreset: "front",
    cameraPresetOptions: [{ id: "front", label: "Front" }],
    onSelectCameraPreset: vi.fn(),
    onCycleCamera: vi.fn(),
    showTexture: true,
    onToggleTexture: vi.fn(),
    showUnlit: false,
    onToggleUnlit: vi.fn(),
    showNormals: false,
    onToggleNormals: vi.fn(),
    showVertexColors: false,
    onToggleVertexColors: vi.fn(),
    showWireframe: false,
    onToggleWireframe: vi.fn(),
    environmentPreset: "studio",
    environmentPresetOptions: [{ id: "studio", label: "Studio" }],
    onSelectEnvironmentPreset: vi.fn(),
    showShadows: true,
    onToggleShadows: vi.fn(),
    showEnvironmentBackground: true,
    onToggleEnvironmentBackground: vi.fn(),
    showBoundingBoxes: false,
    onToggleBoundingBoxes: vi.fn(),
    showSkeleton: true,
    onToggleSkeleton: vi.fn(),
  };
}

describe("build3DToolbar", () => {
  it("omits the Look popover from viewport settings", () => {
    const items = build3DToolbar(createOptions());

    expect(
      items.some((item) => item.kind !== "separator" && item.id === "look"),
    ).toBe(false);
    expect(
      items.some((item) => item.kind !== "separator" && item.id === "shading"),
    ).toBe(true);
    expect(
      items.some(
        (item) => item.kind !== "separator" && item.id === "bounding-boxes",
      ),
    ).toBe(true);
  });
});
