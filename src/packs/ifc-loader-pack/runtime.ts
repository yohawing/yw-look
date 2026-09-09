import {
  Vector2,
  type OrthographicCamera,
  type PerspectiveCamera,
} from "three";
import { buildIfcHierarchy } from "../../lib/ifcHierarchy";
import type { HierarchyNode } from "../../types/viewer";
import type { IfcInspection } from "../../types/ifc";
import { ifcSelectionKey } from "./inspection";
import type { PackRuntime } from "../../types/format-pack";
import type { IfcRuntimeState } from "./types";

/**
 * Bridges Fragments' camera/update/dispose lifecycle to the shared viewport
 * runtime seam. The manager owns the mounted object's GPU resources.
 */
export function createIfcRuntime(
  state: IfcRuntimeState,
  inspection: IfcInspection,
): PackRuntime {
  const { model } = state;
  const hierarchy = buildIfcHierarchy(inspection.getSnapshot().elements);
  const boundsRequests = new Set<Promise<unknown>>();
  const picks = new Set<Promise<string | null>>();
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
      disposeInFlight = Promise.allSettled([
        inspection.dispose(),
        updateInFlight,
        ...picks,
        ...boundsRequests,
      ])
        .then(() => state.manager.dispose())
        .catch((error) => {
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
    selection: {
      getBounds: async (key) => {
        if (disposed) return null;
        const ids = new Set<number>();
        const visit = (nodes: HierarchyNode[], inside = false) => {
          for (const node of nodes) {
            const matches = inside || node.name === key;
            if (matches && /^ifc:\d+$/.test(node.name))
              ids.add(Number(node.name.slice(4)));
            visit(node.children, matches);
          }
        };
        visit(hierarchy);
        if (!ids.size) return null;
        model.object.updateWorldMatrix(true, false);
        const request = model.getMergedBox([...ids]);
        boundsRequests.add(request);
        try {
          const bounds = await request;
          return disposed ? null : bounds;
        } finally {
          boundsRequests.delete(request);
        }
      },
      pick: async (event, camera, canvas) => {
        if (disposed) return null;
        const pick = model
          .raycast({
            camera: camera as PerspectiveCamera | OrthographicCamera,
            mouse: new Vector2(event.clientX, event.clientY),
            dom: canvas,
          })
          .then((hit) =>
            !disposed && hit ? ifcSelectionKey(hit.localId) : null,
          );
        picks.add(pick);
        try {
          return await pick;
        } finally {
          picks.delete(pick);
        }
      },
      select: inspection.select,
    },
    dispose: () => {
      void disposeManager();
    },
  };
}
