import type { OrthographicCamera, PerspectiveCamera } from "three";
import type { PackRuntime } from "../../types/format-pack";
import type { IfcRuntimeState } from "./types";

/**
 * Bridges Fragments' camera/update/dispose lifecycle to the shared viewport
 * runtime seam. The manager owns the mounted object's GPU resources.
 */
export function createIfcRuntime(state: IfcRuntimeState): PackRuntime {
  let disposed = false;
  let updateInFlight: Promise<void> | null = null;
  let disposeInFlight: Promise<void> | null = null;

  const reportRuntimeFailure = (
    operation: "update" | "dispose",
    error: unknown,
  ) => {
    console.error(`[ifc-loader-pack] Fragments ${operation} failed`, error);
  };

  const disposeManager = () => {
    if (!disposeInFlight) {
      disposed = true;
      const dispose = updateInFlight
        ? updateInFlight.then(() => state.manager.dispose())
        : state.manager.dispose();
      disposeInFlight = Promise.resolve(dispose).catch((error) => {
        reportRuntimeFailure("dispose", error);
      });
    }
    return disposeInFlight;
  };

  return {
    ownsMountedObjectResources: true,
    update: ({ camera }) => {
      if (disposed) {
        return;
      }
      state.model.useCamera(camera as PerspectiveCamera | OrthographicCamera);
      if (updateInFlight) {
        return;
      }
      updateInFlight = state.manager
        .update()
        .catch((error) => {
          reportRuntimeFailure("update", error);
        })
        .finally(() => {
          updateInFlight = null;
        });
    },
    dispose: () => {
      void disposeManager();
    },
  };
}
