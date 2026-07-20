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
      items.some(
        (item) => item.kind !== "separator" && item.id === "wireframe",
      ),
    ).toBe(true);
    expect(
      items.some((item) => item.kind !== "separator" && item.id === "overlays"),
    ).toBe(true);
    expect(
      items.some((item) => item.kind !== "separator" && item.id === "skeleton"),
    ).toBe(true);
  });

  it("keeps Shading and Wireframe as separate top-level popovers", () => {
    const items = build3DToolbar(createOptions());
    const display = findPopover(items, "display");
    const displayLabels =
      display?.children?.flatMap((item) =>
        item.kind === "button" ? [item.label] : [],
      ) ?? [];
    const wireframe = findPopover(items, "wireframe");
    const wireframeLabels =
      wireframe?.children?.flatMap((item) =>
        item.kind === "button" ? [item.label] : [],
      ) ?? [];

    expect(display?.label).toBe("Shading");
    expect(display?.iconId).toBe("shading");
    expect(displayLabels).toEqual([
      "Shaded",
      "Unlit",
      "Normals",
      "Vertex Color",
    ]);
    expect(wireframe?.iconId).toBe("wireframe");
    expect(wireframeLabels).toEqual(["Off", "Overlay", "Only"]);
    expect(
      display?.children?.some(
        (item) => item.kind !== "separator" && item.id === "display-shaded",
      ),
    ).toBe(true);
    expect(
      wireframe?.children?.some(
        (item) => item.kind !== "separator" && item.id === "wireframe-overlay",
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
    const display = items.find(
      (item) => item.kind !== "separator" && item.id === "display",
    );
    const wireframe = items.find(
      (item) => item.kind !== "separator" && item.id === "wireframe",
    );
    const overlays = items.find(
      (item) => item.kind !== "separator" && item.id === "overlays",
    );
    const skeleton = items.find(
      (item) => item.kind !== "separator" && item.id === "skeleton",
    );

    for (const item of [camera, display, wireframe, overlays, skeleton]) {
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
    const skeletonChildren =
      skeleton?.kind === "popover"
        ? skeleton.children?.filter((item) => item.kind !== "separator")
        : [];

    expect(overlays?.kind === "popover" ? overlays.label : null).toBe(
      "Overlays",
    );
    expect(overlays?.kind === "popover" ? overlays.active : null).toBe(true);
    expect(overlays?.kind === "popover" ? overlays.iconId : null).toBe(
      "overlay",
    );
    expect(overlayChildren).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "bounding-boxes-toggle",
          label: "Bounding Box",
          active: true,
          onRun: options.onToggleBoundingBoxes,
        }),
      ]),
    );
    expect(skeleton?.kind === "popover" ? skeleton.label : null).toBe(
      "Skeleton",
    );
    expect(skeleton?.kind === "popover" ? skeleton.iconId : null).toBe(
      "skeleton",
    );
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
    for (const child of [
      ...(overlayChildren ?? []),
      ...(skeletonChildren ?? []),
    ]) {
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

  it("does not nest Wireframe or Skeleton inside another popover", () => {
    const items = build3DToolbar(createOptions());
    const display = findPopover(items, "display");
    const overlays = findPopover(items, "overlays");

    expect(
      display?.children?.some(
        (item) => item.kind !== "separator" && item.id.startsWith("wireframe"),
      ),
    ).toBe(false);
    expect(
      overlays?.children?.some(
        (item) => item.kind !== "separator" && item.id.startsWith("skeleton"),
      ),
    ).toBe(false);
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
      "wireframe",
    );
    expect(findChild(off!, "wireframe-off")?.active).toBe(true);

    const overlay = findPopover(
      build3DToolbar(createOptions({ showWireframe: true, showTexture: true })),
      "wireframe",
    );
    expect(findChild(overlay!, "wireframe-overlay")?.active).toBe(true);

    const only = findPopover(
      build3DToolbar(
        createOptions({ showWireframe: true, showTexture: false }),
      ),
      "wireframe",
    );
    expect(findChild(only!, "wireframe-only")?.active).toBe(true);
  });

  it("applies wireframe tri-state side effects", () => {
    const offOptions = createOptions({
      showWireframe: true,
      showTexture: false,
    });
    const offDisplay = findPopover(build3DToolbar(offOptions), "wireframe");
    findChild(offDisplay!, "wireframe-off")?.onRun?.();
    expect(offOptions.onToggleWireframe).toHaveBeenCalledTimes(1);
    expect(offOptions.onToggleTexture).toHaveBeenCalledTimes(1);

    const overlayOptions = createOptions({
      showWireframe: false,
      showTexture: false,
    });
    const overlayDisplay = findPopover(
      build3DToolbar(overlayOptions),
      "wireframe",
    );
    findChild(overlayDisplay!, "wireframe-overlay")?.onRun?.();
    expect(overlayOptions.onToggleWireframe).toHaveBeenCalledTimes(1);
    expect(overlayOptions.onToggleTexture).toHaveBeenCalledTimes(1);

    const onlyOptions = createOptions({
      showWireframe: false,
      showTexture: true,
    });
    const onlyDisplay = findPopover(build3DToolbar(onlyOptions), "wireframe");
    findChild(onlyDisplay!, "wireframe-only")?.onRun?.();
    expect(onlyOptions.onToggleWireframe).toHaveBeenCalledTimes(1);
    expect(onlyOptions.onToggleTexture).toHaveBeenCalledTimes(1);
  });
});
