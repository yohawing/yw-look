import {
  BufferAttribute,
  BufferGeometry,
  InterleavedBufferAttribute,
  Mesh,
  SkinnedMesh,
  type TypedArray,
} from "three";
import {
  acceleratedRaycast,
  type BVHOptions,
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
  generate(geometry: BufferGeometry, options?: BVHOptions): Promise<MeshBVH>;
  dispose(): void;
};

type GeometryArrayBackup = {
  index: { attribute: BufferAttribute; array: TypedArray } | null;
  position: { attribute: BufferAttribute; array: TypedArray };
};

type BvhInputAttribute = BufferAttribute | InterleavedBufferAttribute;

function isInterleavedAttribute(
  attribute: BvhInputAttribute | null | undefined,
): attribute is InterleavedBufferAttribute {
  return (
    attribute !== null &&
    attribute !== undefined &&
    (
      attribute as BvhInputAttribute & {
        isInterleavedBufferAttribute?: boolean;
      }
    ).isInterleavedBufferAttribute === true
  );
}

function isFloat16Attribute(attribute: BvhInputAttribute) {
  return (
    (
      attribute as BvhInputAttribute & {
        isFloat16BufferAttribute?: boolean;
      }
    ).isFloat16BufferAttribute === true
  );
}

function copyPositionAttribute(
  attribute: BufferAttribute | InterleavedBufferAttribute,
): BufferAttribute {
  if (attribute.itemSize < 3) {
    throw new Error(
      `position attribute itemSize ${attribute.itemSize} is smaller than 3`,
    );
  }
  const array = new Float32Array(attribute.count * 3);
  if (!attribute.normalized && !isFloat16Attribute(attribute)) {
    const source = isInterleavedAttribute(attribute)
      ? attribute.data.array
      : attribute.array;
    const stride = isInterleavedAttribute(attribute)
      ? attribute.data.stride
      : attribute.itemSize;
    const sourceOffset = isInterleavedAttribute(attribute)
      ? attribute.offset
      : 0;
    for (let item = 0; item < attribute.count; item += 1) {
      const from = item * stride + sourceOffset;
      const to = item * 3;
      array[to] = source[from];
      array[to + 1] = source[from + 1];
      array[to + 2] = source[from + 2];
    }
  } else {
    for (let item = 0; item < attribute.count; item += 1) {
      const offset = item * 3;
      array[offset] = attribute.getX(item);
      array[offset + 1] = attribute.getY(item);
      array[offset + 2] = attribute.getZ(item);
    }
  }
  return new BufferAttribute(array, 3, false);
}

function copyIndexAttribute(
  attribute: BvhInputAttribute,
  positionCount: number,
): BufferAttribute {
  if (attribute.itemSize !== 1) {
    throw new Error(`index attribute itemSize ${attribute.itemSize} is not 1`);
  }
  if (isFloat16Attribute(attribute)) {
    throw new Error("Float16 index attributes are not supported");
  }
  const values =
    positionCount <= 65_536
      ? new Uint16Array(attribute.count)
      : new Uint32Array(attribute.count);
  const directSource = !attribute.normalized
    ? isInterleavedAttribute(attribute)
      ? attribute.data.array
      : attribute.array
    : null;
  const stride = isInterleavedAttribute(attribute)
    ? attribute.data.stride
    : attribute.itemSize;
  const offset = isInterleavedAttribute(attribute) ? attribute.offset : 0;
  for (let item = 0; item < attribute.count; item += 1) {
    const value = directSource
      ? directSource[item * stride + offset]
      : attribute.getX(item);
    if (
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < 0 ||
      value >= positionCount
    ) {
      throw new Error(
        `index attribute value ${String(value)} at ${item} is outside [0, ${positionCount})`,
      );
    }
    values[item] = value;
  }
  return new BufferAttribute(values, 1, false);
}

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

function needsWorkerGeometryProxy(geometry: BufferGeometry) {
  const position = geometry.getAttribute("position");
  const index = geometry.index as BvhInputAttribute | null;
  return (
    isInterleavedAttribute(position) ||
    isFloat16Attribute(position) ||
    position.normalized ||
    position.itemSize !== 3 ||
    isInterleavedAttribute(index) ||
    (index !== null && isFloat16Attribute(index)) ||
    index?.normalized === true ||
    (index !== null && index.itemSize !== 1)
  );
}

function createWorkerGeometry(source: BufferGeometry): BufferGeometry {
  const workerGeometry = new BufferGeometry();
  workerGeometry.setAttribute(
    "position",
    copyPositionAttribute(source.getAttribute("position")),
  );
  if (source.index) {
    workerGeometry.setIndex(
      copyIndexAttribute(
        source.index as BvhInputAttribute,
        source.getAttribute("position").count,
      ),
    );
  }
  for (const group of source.groups) {
    workerGeometry.addGroup(group.start, group.count, group.materialIndex);
  }
  workerGeometry.setDrawRange(source.drawRange.start, source.drawRange.count);
  workerGeometry.boundingBox = source.boundingBox?.clone() ?? null;
  workerGeometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  return workerGeometry;
}

function workerBvhOptions(source: BufferGeometry): BVHOptions | undefined {
  const { start, count } = source.drawRange;
  if (start === 0 && !Number.isFinite(count)) return undefined;
  const available =
    source.index?.count ?? source.getAttribute("position").count;
  return {
    range: {
      start,
      count: Number.isFinite(count) ? count : Math.max(0, available - start),
    },
  };
}

export function meshTriangleCount(mesh: Mesh): number {
  const geometry = mesh.geometry;
  return geometry.index
    ? Math.floor(geometry.index.count / 3)
    : Math.floor((geometry.getAttribute("position")?.count ?? 0) / 3);
}

export function isStaticMeshBvhCandidate(mesh: Mesh): boolean {
  const position = mesh.geometry.getAttribute("position");
  return (
    !(mesh instanceof SkinnedMesh) &&
    (mesh.morphTargetInfluences?.length ?? 0) === 0 &&
    (mesh.geometry.morphAttributes.position?.length ?? 0) === 0 &&
    position !== undefined &&
    position.itemSize >= 3
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
      let workerGeometry: BufferGeometry;
      let workerOptions: BVHOptions | undefined;
      let backup: GeometryArrayBackup | null;
      try {
        const usesWorkerGeometry = needsWorkerGeometryProxy(mesh.geometry);
        workerGeometry = usesWorkerGeometry
          ? createWorkerGeometry(mesh.geometry)
          : mesh.geometry;
        workerOptions = workerBvhOptions(mesh.geometry);
        backup = usesWorkerGeometry
          ? null
          : backupGeometryArrays(mesh.geometry);
      } catch (error: unknown) {
        console.warn(
          `[selection-bvh] ${mesh.name || mesh.uuid}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
      worker ??= createWorker();
      const activeWorker = worker;
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
          if (backup) restoreGeometryArrays(backup);
        },
      };
      pendingBuilds.add(pending);
      const workerResult = Promise.resolve()
        .then(() =>
          cancelled || buildGeneration !== generation
            ? null
            : activeWorker.generate(workerGeometry, workerOptions),
        )
        .then((bvh) => {
          if (!bvh || cancelled || buildGeneration !== generation) {
            if (backup && pendingBuilds.has(pending)) {
              restoreGeometryArrays(backup);
            }
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
          if (backup && pendingBuilds.has(pending)) {
            restoreGeometryArrays(backup);
          }
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
