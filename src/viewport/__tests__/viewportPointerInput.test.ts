import { Group } from "three";
import { describe, expect, it, vi } from "vitest";
import { createViewportPointerInput } from "../viewportPointerInput";
import type { ViewerSurfaceMode } from "../../types/viewer";

function pointerEvent(
  button: number,
  clientX: number,
  clientY: number,
): PointerEvent {
  return { button, clientX, clientY } as PointerEvent;
}

function createHarness() {
  let mounted: Group | null = new Group();
  let viewerSurfaceMode: ViewerSurfaceMode = "asset";
  let selectMesh: ((meshName: string | null) => void) | undefined = vi.fn();
  let flyActive = false;
  const controls = { enabled: true };
  const flyCameraControls = {
    enter: vi.fn(() => {
      flyActive = true;
    }),
    exit: vi.fn(() => {
      flyActive = false;
    }),
    isActive: vi.fn(() => flyActive),
  };
  const picker = {
    pickSelectionKey: vi.fn(() => "mesh-a"),
  };
  const input = createViewportPointerInput({
    controls,
    flyCameraControls,
    getMountedObject: () => mounted,
    getSelectMesh: () => selectMesh,
    getViewerSurfaceMode: () => viewerSurfaceMode,
    picker,
  });

  return {
    controls,
    flyCameraControls,
    input,
    picker,
    get selectMesh() {
      return selectMesh;
    },
    setMounted(next: Group | null) {
      mounted = next;
    },
    setSelectMesh(next: ((meshName: string | null) => void) | undefined) {
      selectMesh = next;
    },
    setViewerSurfaceMode(next: ViewerSurfaceMode) {
      viewerSurfaceMode = next;
    },
  };
}

describe("createViewportPointerInput", () => {
  it("picks on a left click under the drag threshold", () => {
    const harness = createHarness();

    harness.input.pointerDownHandler(pointerEvent(0, 10, 20));
    harness.input.pointerUpHandler(pointerEvent(0, 12, 21));

    expect(harness.picker.pickSelectionKey).toHaveBeenCalledTimes(1);
    expect(harness.selectMesh).toHaveBeenCalledWith("mesh-a");
    expect(harness.controls.enabled).toBe(true);
  });

  it("does not pick after a drag", () => {
    const harness = createHarness();

    harness.input.pointerDownHandler(pointerEvent(0, 10, 20));
    harness.input.pointerUpHandler(pointerEvent(0, 30, 40));

    expect(harness.picker.pickSelectionKey).not.toHaveBeenCalled();
    expect(harness.selectMesh).not.toHaveBeenCalled();
  });

  it("deselects when clicking an empty scene", () => {
    const harness = createHarness();
    harness.setMounted(null);

    harness.input.pointerDownHandler(pointerEvent(0, 10, 20));
    harness.input.pointerUpHandler(pointerEvent(0, 10, 20));

    expect(harness.selectMesh).toHaveBeenCalledWith(null);
    expect(harness.controls.enabled).toBe(false);
  });

  it("keeps controls enabled and skips picking in texture mode", () => {
    const harness = createHarness();
    harness.setViewerSurfaceMode("texture");

    harness.input.pointerDownHandler(pointerEvent(0, 10, 20));
    harness.input.pointerUpHandler(pointerEvent(0, 10, 20));

    expect(harness.controls.enabled).toBe(true);
    expect(harness.picker.pickSelectionKey).not.toHaveBeenCalled();
    expect(harness.selectMesh).not.toHaveBeenCalled();
  });

  it("enters and exits fly camera with the right button", () => {
    const harness = createHarness();

    harness.input.pointerDownHandler(pointerEvent(2, 10, 20));
    harness.input.pointerUpHandler(pointerEvent(2, 10, 20));

    expect(harness.flyCameraControls.enter).toHaveBeenCalledTimes(1);
    expect(harness.flyCameraControls.exit).toHaveBeenCalledTimes(1);
    expect(harness.picker.pickSelectionKey).not.toHaveBeenCalled();
  });

  it("prevents the context menu", () => {
    const harness = createHarness();
    const event = { preventDefault: vi.fn() } as unknown as MouseEvent;

    harness.input.contextMenuHandler(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });
});
