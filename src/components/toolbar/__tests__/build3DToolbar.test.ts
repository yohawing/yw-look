import { describe, expect, it, vi } from "vitest";
import { build3DToolbar } from "../build3DToolbar";
import type { Build3DToolbarOptions } from "../../../types/viewer";

function createOptions(
  overrides: Partial<Build3DToolbarOptions> = {},
): Build3DToolbarOptions {
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
    ...overrides,
  };
}

function findPopover(items: ReturnType<typeof build3DToolbar>, id: string) {
  const item = items.find(
    (entry) => entry.kind !== "separator" && entry.id === id,
  );
  expect(item?.kind).toBe("popover");
  return item?.kind === "popover" ? item : null;
}

function findChild(
  popover: NonNullable<ReturnType<typeof findPopover>>,
  childId: string,
) {
  const child = popover.children?.find(
    (entry) => entry.kind !== "separator" && entry.id === childId,
  );
  expect(child?.kind).not.toBe("separator");
  return child?.kind !== "separator" && child?.kind !== "status"
    ? child
    : undefined;
}

describe("build3DToolbar", () => {
  it("omits the Look popover from viewport settings", () => {
    const items = build3DToolbar(createOptions());

    expect(
      items.some((item) => item.kind !== "separator" && item.id === "look"),
    ).toBe(false);
    expect(
      items.some((item) => item.kind !== "separator" && item.id === "display"),
    ).toBe(true);
    expect(
      items.some((item) => item.kind !== "separator" && item.id === "overlays"),
    ).toBe(true);
    expect(
      items.some(
        (item) => item.kind !== "separator" && item.id === "bounding-boxes",
      ),
    ).toBe(false);
  });

  it("merges surface display and wireframe into one Display popover", () => {
    const items = build3DToolbar(createOptions());

    expect(
      items.some((item) => item.kind !== "separator" && item.id === "shading"),
    ).toBe(false);
    expect(
      items.some(
        (item) => item.kind !== "separator" && item.id === "wireframe",
      ),
    ).toBe(false);

    const display = findPopover(items, "display");
    const childLabels =
      display?.children?.flatMap((item) =>
        item.kind === "button" ? [item.label] : [],
      ) ?? [];

    expect(childLabels).toEqual([
      "Shaded",
      "Unlit",
      "Normals",
      "Vertex Color",
      "Off",
      "Overlay",
      "Only",
    ]);
    expect(
      display?.children?.some(
        (item) => item.kind !== "separator" && item.id === "display-shaded",
      ),
    ).toBe(true);
    expect(
      display?.children?.some(
        (item) =>
          item.kind !== "separator" && item.id === "display-wireframe-overlay",
      ),
    ).toBe(true);
    expect(
      display?.children?.some(
        (item) => item.kind !== "separator" && item.id === "shading-texture",
      ),
    ).toBe(false);
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
    const display = items.find(
      (item) => item.kind !== "separator" && item.id === "display",
    );
    const overlays = items.find(
      (item) => item.kind !== "separator" && item.id === "overlays",
    );

    for (const item of [camera, display, overlays]) {
      expect(item?.kind).toBe("popover");
      if (item?.kind === "popover") {
        expect(item.onRun).toBeUndefined();
        expect(item.children?.length).toBeGreaterThan(0);
      }
    }

    const overlayChildren =
      overlays?.kind === "popover"
        ? overlays.children?.filter((item) => item.kind !== "separator")
        : [];

    expect(overlays?.kind === "popover" ? overlays.label : null).toBe(
      "Overlays",
    );
    expect(overlays?.kind === "popover" ? overlays.active : null).toBe(true);
    expect(overlayChildren).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "bounding-boxes-toggle",
          label: "Bounding Box",
          active: true,
          onRun: options.onToggleBoundingBoxes,
        }),
        expect.objectContaining({
          id: "skeleton-section-label",
          label: "Skeleton",
        }),
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
    for (const child of overlayChildren ?? []) {
      expect("iconId" in child).toBe(false);
    }
  });

  it("omits the Overlay popover when no overlay toggles are available", () => {
    const items = build3DToolbar(
      createOptions({
        showBoundingBoxes: undefined,
        onToggleBoundingBoxes: undefined,
        showSkeleton: undefined,
        onToggleSkeleton: undefined,
      }),
    );

    expect(
      items.some((item) => item.kind !== "separator" && item.id === "overlays"),
    ).toBe(false);
  });

  it("uses the popover title as Display header and groups Wireframe internally", () => {
    const display = findPopover(build3DToolbar(createOptions()), "display");
    const separators =
      display?.children?.filter((item) => item.kind === "separator") ?? [];

    expect(separators).toHaveLength(1);
    expect(
      display?.children?.some(
        (item) => item.kind === "status" && item.id === "display-section-label",
      ),
    ).toBe(false);
    expect(
      display?.children?.some(
        (item) =>
          item.kind === "status" && item.id === "wireframe-section-label",
      ),
    ).toBe(true);
  });

  it("marks mutually exclusive surface display modes as active", () => {
    const shaded = findPopover(
      build3DToolbar(
        createOptions({
          showTexture: true,
          showUnlit: false,
          showNormals: false,
          showVertexColors: false,
        }),
      ),
      "display",
    );
    expect(findChild(shaded!, "display-shaded")?.active).toBe(true);
    expect(findChild(shaded!, "display-unlit")?.active).toBe(false);

    const unlit = findPopover(
      build3DToolbar(
        createOptions({
          showUnlit: true,
          showNormals: false,
          showVertexColors: false,
        }),
      ),
      "display",
    );
    expect(findChild(unlit!, "display-unlit")?.active).toBe(true);
    expect(findChild(unlit!, "display-shaded")?.active).toBe(false);

    const normals = findPopover(
      build3DToolbar(
        createOptions({
          showNormals: true,
          showUnlit: false,
          showVertexColors: false,
        }),
      ),
      "display",
    );
    expect(findChild(normals!, "display-normals")?.active).toBe(true);

    const vertexColor = findPopover(
      build3DToolbar(
        createOptions({
          showVertexColors: true,
          showUnlit: false,
          showNormals: false,
        }),
      ),
      "display",
    );
    expect(findChild(vertexColor!, "display-vertexColor")?.active).toBe(true);
  });

  it("applies shaded display side effects", () => {
    const options = createOptions({
      showTexture: false,
      showUnlit: true,
      showNormals: true,
      showVertexColors: true,
    });
    const display = findPopover(build3DToolbar(options), "display");

    findChild(display!, "display-shaded")?.onRun?.();

    expect(options.onToggleTexture).toHaveBeenCalledTimes(1);
    expect(options.onToggleUnlit).toHaveBeenCalledTimes(1);
    expect(options.onToggleNormals).toHaveBeenCalledTimes(1);
    expect(options.onToggleVertexColors).toHaveBeenCalledTimes(1);
  });

  it("applies unlit display side effects", () => {
    const options = createOptions({
      showTexture: false,
      showUnlit: false,
      showNormals: true,
      showVertexColors: true,
    });
    const display = findPopover(build3DToolbar(options), "display");

    findChild(display!, "display-unlit")?.onRun?.();

    expect(options.onToggleTexture).toHaveBeenCalledTimes(1);
    expect(options.onToggleUnlit).toHaveBeenCalledTimes(1);
    expect(options.onToggleNormals).toHaveBeenCalledTimes(1);
    expect(options.onToggleVertexColors).toHaveBeenCalledTimes(1);
  });

  it("applies normals display side effects without forcing texture", () => {
    const options = createOptions({
      showTexture: false,
      showUnlit: true,
      showNormals: false,
      showVertexColors: true,
    });
    const display = findPopover(build3DToolbar(options), "display");

    findChild(display!, "display-normals")?.onRun?.();

    expect(options.onToggleTexture).not.toHaveBeenCalled();
    expect(options.onToggleUnlit).toHaveBeenCalledTimes(1);
    expect(options.onToggleNormals).toHaveBeenCalledTimes(1);
    expect(options.onToggleVertexColors).toHaveBeenCalledTimes(1);
  });

  it("applies vertex color display side effects", () => {
    const options = createOptions({
      showUnlit: true,
      showNormals: true,
      showVertexColors: false,
    });
    const display = findPopover(build3DToolbar(options), "display");

    findChild(display!, "display-vertexColor")?.onRun?.();

    expect(options.onToggleUnlit).toHaveBeenCalledTimes(1);
    expect(options.onToggleNormals).toHaveBeenCalledTimes(1);
    expect(options.onToggleVertexColors).toHaveBeenCalledTimes(1);
  });

  it("marks wireframe tri-state modes as active", () => {
    const off = findPopover(
      build3DToolbar(
        createOptions({ showWireframe: false, showTexture: true }),
      ),
      "display",
    );
    expect(findChild(off!, "display-wireframe-off")?.active).toBe(true);

    const overlay = findPopover(
      build3DToolbar(createOptions({ showWireframe: true, showTexture: true })),
      "display",
    );
    expect(findChild(overlay!, "display-wireframe-overlay")?.active).toBe(true);

    const only = findPopover(
      build3DToolbar(
        createOptions({ showWireframe: true, showTexture: false }),
      ),
      "display",
    );
    expect(findChild(only!, "display-wireframe-only")?.active).toBe(true);
  });

  it("applies wireframe tri-state side effects", () => {
    const offOptions = createOptions({
      showWireframe: true,
      showTexture: false,
    });
    const offDisplay = findPopover(build3DToolbar(offOptions), "display");
    findChild(offDisplay!, "display-wireframe-off")?.onRun?.();
    expect(offOptions.onToggleWireframe).toHaveBeenCalledTimes(1);
    expect(offOptions.onToggleTexture).toHaveBeenCalledTimes(1);

    const overlayOptions = createOptions({
      showWireframe: false,
      showTexture: false,
    });
    const overlayDisplay = findPopover(
      build3DToolbar(overlayOptions),
      "display",
    );
    findChild(overlayDisplay!, "display-wireframe-overlay")?.onRun?.();
    expect(overlayOptions.onToggleWireframe).toHaveBeenCalledTimes(1);
    expect(overlayOptions.onToggleTexture).toHaveBeenCalledTimes(1);

    const onlyOptions = createOptions({
      showWireframe: false,
      showTexture: true,
    });
    const onlyDisplay = findPopover(build3DToolbar(onlyOptions), "display");
    findChild(onlyDisplay!, "display-wireframe-only")?.onRun?.();
    expect(onlyOptions.onToggleWireframe).toHaveBeenCalledTimes(1);
    expect(onlyOptions.onToggleTexture).toHaveBeenCalledTimes(1);
  });
});
