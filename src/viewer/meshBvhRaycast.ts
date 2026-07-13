import {
  BufferGeometry,
  Mesh,
  SkinnedMesh,
  type BufferAttribute,
  type TypedArray,
} from "three";
import {
  acceleratedRaycast,
  type GeometryBVH,
  type MeshBVH,
} from "three-mesh-bvh";
// Use the implementation subpath intentionally: the public `worker` barrel
// also makes ParallelMeshBVHWorker reachable and Vite emits its unused worker
// chunk. package.json pins 0.9.11 exactly because this subpath is not a stable
// public API; upgrade it only with typecheck + production bundle verification.
import { GenerateMeshBVHWorker } from "three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js";

export const LARGE_PICK_MESH_TRIANGLE_THRESHOLD = 50_000;

type BvhWorker = {
  generate(geometry: BufferGeometry): Promise<MeshBVH>;
  dispose(): void;
};

type GeometryArrayBackup = {
  index: { attribute: BufferAttribute; array: TypedArray } | null;
  position: { attribute: BufferAttribute; array: TypedArray };
};

function backupGeometryArrays(geometry: BufferGeometry): GeometryArrayBackup {
  const position = geometry.getAttribute("position") as BufferAttribute;
  const index = geometry.index;
  return {
    position: {
      attribute: position,
      array: position.array.slice() as TypedArray,
    },
    index: index
      ? { attribute: index, array: index.array.slice() as TypedArray }
      : null,
  };
}

function restoreGeometryArrays(backup: GeometryArrayBackup) {
  backup.position.attribute.array = backup.position.array;
  backup.position.attribute.needsUpdate = true;
  if (backup.index) {
    backup.index.attribute.array = backup.index.array;
    backup.index.attribute.needsUpdate = true;
  }
}

export function meshTriangleCount(mesh: Mesh): number {
  const geometry = mesh.geometry;
  return geometry.index
    ? Math.floor(geometry.index.count / 3)
    : Math.floor((geometry.getAttribute("position")?.count ?? 0) / 3);
}

export function isStaticMeshBvhCandidate(mesh: Mesh): boolean {
  const position = mesh.geometry.getAttribute("position") as
    | (BufferAttribute & { isInterleavedBufferAttribute?: boolean })
    | undefined;
  const index = mesh.geometry.index as
    | (BufferAttribute & { isInterleavedBufferAttribute?: boolean })
    | null;
  return (
    !(mesh instanceof SkinnedMesh) &&
    (mesh.morphTargetInfluences?.length ?? 0) === 0 &&
    (mesh.geometry.morphAttributes.position?.length ?? 0) === 0 &&
    position?.isInterleavedBufferAttribute !== true &&
    index?.isInterleavedBufferAttribute !== true
  );
}

export function createMeshBvhRaycastBuilder(
  createWorker: () => BvhWorker = () => new GenerateMeshBVHWorker(),
) {
  let worker: BvhWorker | null = null;
  let generation = 0;
  const ownedBoundsTrees = new Set<GeometryBVH>();
  const pendingBuilds = new Set<{
    cancel(): void;
    restore(): void;
  }>();
  const installed = new Map<
    Mesh,
    {
      bvh: GeometryBVH;
      previousBoundsTree: GeometryBVH | undefined;
      raycast: Mesh["raycast"];
    }
  >();

  const invalidate = () => {
    generation += 1;
    worker?.dispose();
    worker = null;
    for (const pending of pendingBuilds) {
      pending.restore();
      pending.cancel();
    }
    pendingBuilds.clear();
    for (const [mesh, state] of installed) {
      if (mesh.geometry.boundsTree === state.bvh) {
        mesh.geometry.boundsTree = state.previousBoundsTree;
      }
      mesh.raycast = state.raycast;
    }
    installed.clear();
    ownedBoundsTrees.clear();
  };

  return {
    async build(mesh: Mesh): Promise<boolean> {
      const buildGeneration = generation;
      const existing = mesh.geometry.boundsTree;
      if (existing) {
        installed.set(mesh, {
          bvh: existing,
          previousBoundsTree: ownedBoundsTrees.has(existing)
            ? undefined
            : existing,
          raycast: mesh.raycast,
        });
        mesh.raycast = acceleratedRaycast;
        return true;
      }
      if (pendingBuilds.size > 0) {
        console.warn(
          `[selection-bvh] ${mesh.name || mesh.uuid}: concurrent BVH build rejected while the shared worker is busy`,
        );
        return false;
      }
      worker ??= createWorker();
      const activeWorker = worker;
      const backup = backupGeometryArrays(mesh.geometry);
      let cancelled = false;
      let settleCancelled!: (ready: false) => void;
      const cancelledResult = new Promise<false>((resolve) => {
        settleCancelled = resolve;
      });
      const pending = {
        cancel() {
          cancelled = true;
          settleCancelled(false);
        },
        restore() {
          restoreGeometryArrays(backup);
        },
      };
      pendingBuilds.add(pending);
      const workerResult = Promise.resolve()
        .then(() =>
          cancelled || buildGeneration !== generation
            ? null
            : activeWorker.generate(mesh.geometry),
        )
        .then((bvh) => {
          if (!bvh || cancelled || buildGeneration !== generation) {
            if (pendingBuilds.has(pending)) restoreGeometryArrays(backup);
            return false;
          }
          const raycast = mesh.raycast;
          mesh.geometry.boundsTree = bvh;
          mesh.raycast = acceleratedRaycast;
          ownedBoundsTrees.add(bvh);
          installed.set(mesh, {
            bvh,
            previousBoundsTree: undefined,
            raycast,
          });
          return true;
        })
        .catch((error: unknown) => {
          if (pendingBuilds.has(pending)) restoreGeometryArrays(backup);
          if (!cancelled) {
            activeWorker.dispose();
            if (worker === activeWorker) worker = null;
            console.warn(
              `[selection-bvh] ${mesh.name || mesh.uuid}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          return false;
        });
      const ready = await Promise.race([workerResult, cancelledResult]);
      pendingBuilds.delete(pending);
      return ready;
    },
    invalidate,
    dispose: invalidate,
  };
}
