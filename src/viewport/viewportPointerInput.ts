import type { Object3D } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { FlyCameraControls } from "./flyCamera";
import type { SceneContext, ViewerSurfaceMode } from "../types/viewer";

type ViewportPicker = {
  pickSelectionKey(
    mounted: Object3D,
    event: Pick<PointerEvent, "clientX" | "clientY">,
  ): string | null | Promise<string | null>;
};

type CreateViewportPointerInputOptions = {
  clickDragPx?: number;
  controls: Pick<OrbitControls, "enabled">;
  flyCameraControls: Pick<FlyCameraControls, "enter" | "exit" | "isActive">;
  getMountedObject: () => SceneContext["mountedObject"] | undefined;
  getSelectMesh: () => ((meshName: string | null) => void) | undefined;
  getViewerSurfaceMode: () => ViewerSurfaceMode;
  picker: ViewportPicker;
};

export function createViewportPointerInput({
  clickDragPx = 4,
  controls,
  flyCameraControls,
  getMountedObject,
  getSelectMesh,
  getViewerSurfaceMode,
  picker,
}: CreateViewportPointerInputOptions) {
  let clickStart: { x: number; y: number; button: number } | null = null;
  let pickGeneration = 0;

  const performPick = (event: PointerEvent): void => {
    const generation = ++pickGeneration;
    const callback = getSelectMesh();
    if (!callback) return;
    const mounted = getMountedObject();
    if (!mounted) {
      callback(null);
      return;
    }
    const result = picker.pickSelectionKey(mounted, event);
    if (!(result instanceof Promise)) {
      if (generation === pickGeneration && getMountedObject() === mounted) {
        getSelectMesh()?.(result);
      }
      return;
    }
    void result.then((selectionKey) => {
      if (generation !== pickGeneration || getMountedObject() !== mounted)
        return;
      getSelectMesh()?.(selectionKey);
    });
  };

  const pointerDownHandler = (event: PointerEvent): void => {
    if (event.button === 0) {
      clickStart = {
        x: event.clientX,
        y: event.clientY,
        button: event.button,
      };
    } else {
      clickStart = null;
    }

    if (!getMountedObject()) {
      controls.enabled = false;
      return;
    }

    if (getViewerSurfaceMode() === "texture") {
      controls.enabled = true;
      return;
    }

    if (event.button === 2) {
      flyCameraControls.enter();
      return;
    }

    controls.enabled = event.button === 0 || event.button === 1;
  };

  const pointerUpHandler = (event: PointerEvent): void => {
    if (event.button === 2 && flyCameraControls.isActive()) {
      flyCameraControls.exit();
      return;
    }
    if (
      clickStart &&
      event.button === 0 &&
      clickStart.button === 0 &&
      Math.hypot(event.clientX - clickStart.x, event.clientY - clickStart.y) <
        clickDragPx &&
      getViewerSurfaceMode() !== "texture"
    ) {
      performPick(event);
    }
    clickStart = null;
    controls.enabled = Boolean(getMountedObject());
  };

  const contextMenuHandler = (event: MouseEvent): void => {
    event.preventDefault();
  };

  return {
    contextMenuHandler,
    pointerDownHandler,
    pointerUpHandler,
  };
}
