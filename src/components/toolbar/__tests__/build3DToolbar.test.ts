import { describe, expect, it, vi } from "vitest";
import { build3DToolbar } from "../build3DToolbar";
import type { Build3DToolbarOptions } from "../../../types/viewer";

function createOptions(): Build3DToolbarOptions {
  return {
    cameraPreset: "front",
    cameraPresetOptions: [{ id: "front", label: "Front" }],
    onSelectCameraPreset: vi.fn(),
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

  it("keeps viewport setting changes inside popover children", () => {
    const options = createOptions();
    const items = build3DToolbar({
      ...options,
      showBoundingBoxes: true,
      showLocalAxis: true,
      onToggleLocalAxis: vi.fn(),
      showJointNames: false,
      onToggleJointNames: vi.fn(),
    });

    const camera = items.find(
      (item) => item.kind !== "separator" && item.id === "camera",
    );
    const shading = items.find(
      (item) => item.kind !== "separator" && item.id === "shading",
    );
    const wireframe = items.find(
      (item) => item.kind !== "separator" && item.id === "wireframe",
    );
    const boundingBoxes = items.find(
      (item) => item.kind !== "separator" && item.id === "bounding-boxes",
    );
    const skeleton = items.find(
      (item) => item.kind !== "separator" && item.id === "skeleton",
    );

    for (const item of [camera, shading, wireframe, boundingBoxes, skeleton]) {
      expect(item?.kind).toBe("popover");
      if (item?.kind === "popover") {
        expect(item.onRun).toBeUndefined();
        expect(item.children?.length).toBeGreaterThan(0);
      }
    }

    const skeletonChildren =
      skeleton?.kind === "popover"
        ? skeleton.children?.filter((item) => item.kind !== "separator")
        : [];

    expect(skeletonChildren).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "skeleton-bones",
          label: "Bone",
          active: true,
          onRun: options.onToggleSkeleton,
        }),
        expect.objectContaining({
          id: "local-axis",
          label: "Local Axis",
        }),
        expect.objectContaining({
          id: "bone-name",
          label: "Bone Name",
        }),
      ]),
    );
    for (const child of skeletonChildren ?? []) {
      expect("iconId" in child).toBe(false);
    }
  });
});
