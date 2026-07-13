import {
  BoxGeometry,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SkinnedMesh,
} from "three";
import { describe, expect, it, vi } from "vitest";
import type { MeshBVH } from "three-mesh-bvh";
import {
  createMeshBvhRaycastBuilder,
  isStaticMeshBvhCandidate,
  meshTriangleCount,
} from "../meshBvhRaycast";

describe("mesh BVH raycast builder", () => {
  it("installs a completed BVH and restores the mesh on invalidation", async () => {
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    const originalRaycast = mesh.raycast;
    const bvh = {} as MeshBVH;
    const worker = { generate: vi.fn(async () => bvh), dispose: vi.fn() };
    const builder = createMeshBvhRaycastBuilder(() => worker);

    await expect(builder.build(mesh)).resolves.toBe(true);
    expect(mesh.geometry.boundsTree).toBe(bvh);
    expect(mesh.raycast).not.toBe(originalRaycast);

    builder.invalidate();
    expect(mesh.geometry.boundsTree).toBeUndefined();
    expect(mesh.raycast).toBe(originalRaycast);
    expect(worker.dispose).toHaveBeenCalledOnce();
  });

  it("logs the worker failure reason and never enables triangle fallback", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    mesh.name = "HighPoly";
    const originalRaycast = mesh.raycast;
    const builder = createMeshBvhRaycastBuilder(() => ({
      generate: vi.fn(async () => {
        throw new Error("worker unavailable");
      }),
      dispose: vi.fn(),
    }));

    await expect(builder.build(mesh)).resolves.toBe(false);
    expect(mesh.raycast).toBe(originalRaycast);
    expect(mesh.geometry.boundsTree).toBeUndefined();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("HighPoly: worker unavailable"),
    );
    warning.mockRestore();
  });

  it("restores transferred arrays and settles before a terminated worker returns", async () => {
    let finish!: (bvh: MeshBVH) => void;
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    const position = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.index!;
    const expectedPosition = Array.from(position.array);
    const expectedIndex = Array.from(index.array);
    const worker = {
      generate: () => {
        Object.defineProperty(position, "array", {
          configurable: true,
          value: new Float32Array(0),
          writable: true,
        });
        Object.defineProperty(index, "array", {
          configurable: true,
          value: new Uint16Array(0),
          writable: true,
        });
        return new Promise<MeshBVH>((resolve) => (finish = resolve));
      },
      dispose: vi.fn(),
    };
    const builder = createMeshBvhRaycastBuilder(() => worker);

    const pending = builder.build(mesh);
    await Promise.resolve();
    await Promise.resolve();
    expect(position.array).toHaveLength(0);
    builder.invalidate();

    await expect(pending).resolves.toBe(false);
    expect(Array.from(position.array)).toEqual(expectedPosition);
    expect(Array.from(index.array)).toEqual(expectedIndex);
    expect(worker.dispose).toHaveBeenCalledOnce();
    finish({} as MeshBVH);
    await Promise.resolve();
    expect(mesh.geometry.boundsTree).toBeUndefined();
  });

  it("restores transferred arrays when the worker fails", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    const position = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.index!;
    const expectedPosition = Array.from(position.array);
    const expectedIndex = Array.from(index.array);
    const failedWorker = {
      async generate() {
        Object.defineProperty(position, "array", {
          configurable: true,
          value: new Float32Array(0),
          writable: true,
        });
        Object.defineProperty(index, "array", {
          configurable: true,
          value: new Uint16Array(0),
          writable: true,
        });
        throw new Error("transfer failed");
      },
      dispose: vi.fn(),
    };
    const replacementBvh = {} as MeshBVH;
    const replacementWorker = {
      generate: vi.fn(async () => replacementBvh),
      dispose: vi.fn(),
    };
    const createWorker = vi
      .fn()
      .mockReturnValueOnce(failedWorker)
      .mockReturnValueOnce(replacementWorker);
    const builder = createMeshBvhRaycastBuilder(createWorker);

    await expect(builder.build(mesh)).resolves.toBe(false);
    expect(Array.from(position.array)).toEqual(expectedPosition);
    expect(Array.from(index.array)).toEqual(expectedIndex);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("transfer failed"),
    );
    expect(failedWorker.dispose).toHaveBeenCalledOnce();
    await expect(builder.build(mesh)).resolves.toBe(true);
    expect(createWorker).toHaveBeenCalledTimes(2);
    warning.mockRestore();
  });

  it("keeps real backup and worker scheduling below 50ms for 125k triangles", async () => {
    const mesh = new Mesh(
      new PlaneGeometry(10, 10, 250, 250),
      new MeshBasicMaterial(),
    );
    const worker = {
      generate: vi.fn(() => new Promise<MeshBVH>(() => undefined)),
      dispose: vi.fn(),
    };
    const builder = createMeshBvhRaycastBuilder(() => worker);

    const startedAt = performance.now();
    const pending = builder.build(mesh);
    const backupAndSchedulingMs = performance.now() - startedAt;
    builder.invalidate();

    await expect(pending).resolves.toBe(false);
    console.info(
      `selection-bvh-backup-profile ${JSON.stringify({ triangles: meshTriangleCount(mesh), backupAndSchedulingMs })}`,
    );
    expect(backupAndSchedulingMs).toBeLessThan(50);
  });

  it("rejects concurrent builds without terminating the active shared worker", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const worker = {
      generate: vi.fn(() => new Promise<MeshBVH>(() => undefined)),
      dispose: vi.fn(),
    };
    const builder = createMeshBvhRaycastBuilder(() => worker);
    const first = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    const second = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    second.name = "ConcurrentSecond";

    const pending = builder.build(first);
    await expect(builder.build(second)).resolves.toBe(false);

    expect(worker.generate).toHaveBeenCalledTimes(1);
    expect(worker.dispose).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("concurrent BVH build rejected"),
    );
    builder.invalidate();
    await expect(pending).resolves.toBe(false);
    warning.mockRestore();
  });

  it("counts indexed and non-indexed triangles", () => {
    const indexed = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    expect(meshTriangleCount(indexed)).toBe(12);
    indexed.geometry.setIndex(null);
    expect(meshTriangleCount(indexed)).toBe(
      Math.floor(indexed.geometry.getAttribute("position").count / 3),
    );
  });

  it("excludes skinned and morph-driven geometry from static BVH builds", () => {
    const staticMesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    const skinned = new SkinnedMesh(new BoxGeometry(), new MeshBasicMaterial());
    const morphed = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    morphed.morphTargetInfluences = [0];
    const interleavedGeometry = new BoxGeometry();
    interleavedGeometry.setAttribute(
      "position",
      new InterleavedBufferAttribute(
        new InterleavedBuffer(new Float32Array(9), 3),
        3,
        0,
      ),
    );
    const interleaved = new Mesh(interleavedGeometry, new MeshBasicMaterial());

    expect(isStaticMeshBvhCandidate(staticMesh)).toBe(true);
    expect(isStaticMeshBvhCandidate(skinned)).toBe(false);
    expect(isStaticMeshBvhCandidate(morphed)).toBe(false);
    expect(isStaticMeshBvhCandidate(interleaved)).toBe(false);
  });

  it("reuses one bounds tree for meshes sharing a geometry", async () => {
    const geometry = new BoxGeometry();
    const first = new Mesh(geometry, new MeshBasicMaterial());
    const second = new Mesh(geometry, new MeshBasicMaterial());
    const bvh = {} as MeshBVH;
    const worker = { generate: vi.fn(async () => bvh), dispose: vi.fn() };
    const builder = createMeshBvhRaycastBuilder(() => worker);

    await expect(builder.build(first)).resolves.toBe(true);
    await expect(builder.build(second)).resolves.toBe(true);

    expect(worker.generate).toHaveBeenCalledOnce();
    expect(first.geometry.boundsTree).toBe(bvh);
    expect(first.raycast).toBe(second.raycast);
    builder.invalidate();
    expect(first.geometry.boundsTree).toBeUndefined();
  });

  it("preserves a non-owned bounds tree across invalidation", async () => {
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    const external = {} as MeshBVH;
    const originalRaycast = mesh.raycast;
    mesh.geometry.boundsTree = external;
    const worker = { generate: vi.fn(), dispose: vi.fn() };
    const builder = createMeshBvhRaycastBuilder(() => worker as never);

    await expect(builder.build(mesh)).resolves.toBe(true);
    builder.invalidate();

    expect(worker.generate).not.toHaveBeenCalled();
    expect(mesh.geometry.boundsTree).toBe(external);
    expect(mesh.raycast).toBe(originalRaycast);
  });
});
