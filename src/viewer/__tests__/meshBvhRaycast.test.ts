import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Float16BufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Raycaster,
  SkinnedMesh,
  Vector3,
} from "three";
import { describe, expect, it, vi } from "vitest";
import { MeshBVH, type BVHOptions } from "three-mesh-bvh";
import {
  createMeshBvhRaycastBuilder,
  isStaticMeshBvhCandidate,
  meshTriangleCount,
} from "../meshBvhRaycast";

function createInterleavedGeometry(
  source: BufferGeometry = new PlaneGeometry(2, 2),
) {
  const sourcePosition = source.getAttribute("position");
  const positionArray = new Float32Array(sourcePosition.count * 4);
  for (let index = 0; index < sourcePosition.count; index += 1) {
    const offset = index * 4;
    positionArray[offset] = sourcePosition.getX(index);
    positionArray[offset + 1] = sourcePosition.getY(index);
    positionArray[offset + 2] = sourcePosition.getZ(index);
    positionArray[offset + 3] = 123;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new InterleavedBufferAttribute(
      new InterleavedBuffer(positionArray, 4),
      3,
      0,
    ),
  );
  if (source.index) {
    const indexArray = new Uint32Array(source.index.count * 2);
    for (let index = 0; index < source.index.count; index += 1) {
      indexArray[index * 2] = source.index.getX(index);
      indexArray[index * 2 + 1] = 999;
    }
    geometry.setIndex(
      new InterleavedBufferAttribute(
        new InterleavedBuffer(indexArray, 2),
        1,
        0,
      ) as never,
    );
  }
  for (const group of source.groups) {
    geometry.addGroup(group.start, group.count, group.materialIndex);
  }
  geometry.setDrawRange(source.drawRange.start, source.drawRange.count);
  return geometry;
}

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

  it("builds interleaved static geometry through an isolated non-interleaved worker input", async () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new InterleavedBufferAttribute(
        new InterleavedBuffer(
          new Int16Array([
            -32767, -32767, 0, 111, 32767, -32767, 0, 222, 0, 32767, 0, 333,
          ]),
          4,
        ),
        3,
        0,
        true,
      ),
    );
    geometry.setIndex(
      new InterleavedBufferAttribute(
        new InterleavedBuffer(new Uint16Array([0, 91, 1, 92, 2, 93]), 2),
        1,
        0,
      ) as never,
    );
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    const originalPosition = geometry.getAttribute("position");
    const originalIndex = geometry.index;
    const positionData = Array.from(
      (originalPosition as InterleavedBufferAttribute).data.array,
    );
    const indexData = Array.from(
      (originalIndex as unknown as InterleavedBufferAttribute).data.array,
    );
    const bvh = {} as MeshBVH;
    const worker = {
      generate: vi.fn(async (input: BufferGeometry) => {
        void input;
        return bvh;
      }),
      dispose: vi.fn(),
    };
    const builder = createMeshBvhRaycastBuilder(() => worker);

    await expect(builder.build(mesh)).resolves.toBe(true);

    const workerInput = worker.generate.mock.calls[0]?.[0];
    expect(workerInput).not.toBe(geometry);
    expect(
      workerInput?.getAttribute("position") instanceof
        InterleavedBufferAttribute,
    ).toBe(false);
    expect(workerInput?.index instanceof InterleavedBufferAttribute).toBe(
      false,
    );
    expect(workerInput?.getAttribute("position").array).toBeInstanceOf(
      Float32Array,
    );
    expect(workerInput?.getAttribute("position").itemSize).toBe(3);
    expect(workerInput?.getAttribute("position").normalized).toBe(false);
    expect(
      Array.from(workerInput?.getAttribute("position").array ?? []),
    ).toEqual([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
    expect(Array.from(workerInput?.index?.array ?? [])).toEqual([0, 1, 2]);
    expect(geometry.getAttribute("position")).toBe(originalPosition);
    expect(geometry.index).toBe(originalIndex);
    expect(
      Array.from((originalPosition as InterleavedBufferAttribute).data.array),
    ).toEqual(positionData);
    expect(
      Array.from(
        (originalIndex as unknown as InterleavedBufferAttribute).data.array,
      ),
    ).toEqual(indexData);
    expect(geometry.boundsTree).toBe(bvh);
  });

  it("keeps groups and enforces drawRange when raycasting the detached proxy BVH", async () => {
    const source = new BufferGeometry();
    source.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([
          -1, -1, 0, 1, -1, 0, 0, 1, 0, 9, -1, 0, 11, -1, 0, 10, 1, 0,
        ]),
        3,
      ),
    );
    source.setIndex([0, 1, 2, 3, 4, 5]);
    source.addGroup(0, 3, 0);
    source.addGroup(3, 3, 1);
    source.setDrawRange(3, 3);
    const geometry = createInterleavedGeometry(source);
    const mesh = new Mesh(geometry, [
      new MeshBasicMaterial(),
      new MeshBasicMaterial(),
    ]);
    mesh.position.z = -5;
    mesh.updateMatrixWorld(true);
    let workerInput: BufferGeometry | null = null;
    let workerOptions: BVHOptions | undefined;
    const worker = {
      async generate(input: BufferGeometry, options?: BVHOptions) {
        workerInput = input;
        workerOptions = options;
        return new MeshBVH(input, options);
      },
      dispose: vi.fn(),
    };
    const builder = createMeshBvhRaycastBuilder(() => worker);

    await expect(builder.build(mesh)).resolves.toBe(true);
    const hits = new Raycaster(
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -1),
    ).intersectObject(mesh, false);

    expect(workerOptions).toEqual({ range: { start: 3, count: 3 } });
    expect((workerInput as unknown as BufferGeometry).groups).toEqual([
      { start: 0, count: 3, materialIndex: 0 },
      { start: 3, count: 3, materialIndex: 1 },
    ]);
    expect(hits).toHaveLength(0);
  });

  it("decodes Float16 positions into the worker proxy and raycasts the real BVH", async () => {
    const geometry = new BufferGeometry();
    const position = new Float16BufferAttribute(new Uint16Array(9), 3);
    position.setXYZ(0, -1, -1, 0);
    position.setXYZ(1, 1, -1, 0);
    position.setXYZ(2, 0, 1, 0);
    geometry.setAttribute("position", position);
    geometry.setIndex([0, 1, 2]);
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.position.z = -5;
    mesh.updateMatrixWorld(true);
    let workerInput: BufferGeometry | null = null;
    const worker = {
      async generate(input: BufferGeometry, options?: BVHOptions) {
        workerInput = input;
        return new MeshBVH(input, options);
      },
      dispose: vi.fn(),
    };
    const builder = createMeshBvhRaycastBuilder(() => worker);

    await expect(builder.build(mesh)).resolves.toBe(true);
    const hits = new Raycaster(
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -1),
    ).intersectObject(mesh, false);

    expect(workerInput).not.toBe(geometry);
    expect(
      Array.from(
        (workerInput as unknown as BufferGeometry).getAttribute("position")
          .array,
      ),
    ).toEqual([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
    expect(
      (workerInput as unknown as BufferGeometry).getAttribute("position").array,
    ).toBeInstanceOf(Float32Array);
    expect(geometry.getAttribute("position")).toBe(position);
    expect(hits).toHaveLength(1);
  });

  it("proxies normalized non-interleaved position attributes", async () => {
    const geometry = new BufferGeometry();
    const position = new BufferAttribute(
      new Int16Array([
        -32767, -32767, 0, 71, 32767, -32767, 0, 72, 0, 32767, 0, 73,
      ]),
      4,
      true,
    );
    geometry.setAttribute("position", position);
    geometry.setIndex([0, 1, 2]);
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    const worker = {
      generate: vi.fn(async (input: BufferGeometry) => {
        void input;
        return {} as MeshBVH;
      }),
      dispose: vi.fn(),
    };
    const builder = createMeshBvhRaycastBuilder(() => worker);

    await expect(builder.build(mesh)).resolves.toBe(true);

    const workerGeometry = worker.generate.mock.calls[0]?.[0];
    expect(workerGeometry).not.toBe(geometry);
    expect(workerGeometry?.getAttribute("position").itemSize).toBe(3);
    expect(workerGeometry?.getAttribute("position").normalized).toBe(false);
    expect(
      Array.from(workerGeometry?.getAttribute("position").array ?? []),
    ).toEqual([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
    expect(geometry.getAttribute("position")).toBe(position);
  });

  it("rejects invalid interleaved indices without starting the worker", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const geometry = createInterleavedGeometry();
    geometry.setIndex(
      new InterleavedBufferAttribute(
        new InterleavedBuffer(new Int16Array([0, 8, -1, 8, 2, 8]), 2),
        1,
        0,
      ) as never,
    );
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.name = "InvalidInterleavedIndex";
    const worker = {
      generate: vi.fn(async () => ({}) as MeshBVH),
      dispose: vi.fn(),
    };
    const createWorker = vi.fn(() => worker);
    const builder = createMeshBvhRaycastBuilder(createWorker);

    await expect(builder.build(mesh)).resolves.toBe(false);

    expect(createWorker).not.toHaveBeenCalled();
    expect(worker.generate).not.toHaveBeenCalled();
    expect(geometry.boundsTree).toBeUndefined();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("index attribute value -1"),
    );
    warning.mockRestore();
  });

  it("rejects Float16 indices without starting the worker", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const geometry = new PlaneGeometry(2, 2);
    const index = new Float16BufferAttribute(
      new Uint16Array(geometry.index!.count),
      1,
    );
    for (let item = 0; item < geometry.index!.count; item += 1) {
      index.setX(item, geometry.index!.getX(item));
    }
    geometry.setIndex(index);
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.name = "Float16Index";
    const worker = {
      generate: vi.fn(async () => ({}) as MeshBVH),
      dispose: vi.fn(),
    };
    const createWorker = vi.fn(() => worker);
    const builder = createMeshBvhRaycastBuilder(createWorker);

    await expect(builder.build(mesh)).resolves.toBe(false);

    expect(createWorker).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("Float16 index attributes are not supported"),
    );
    warning.mockRestore();
  });

  it("keeps interleaved render geometry intact when the worker fails", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const geometry = createInterleavedGeometry();
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    const originalPosition = geometry.getAttribute("position");
    const originalIndex = geometry.index;
    const originalPositionData = (
      originalPosition as InterleavedBufferAttribute
    ).data.array;
    const originalIndexData = (
      originalIndex as unknown as InterleavedBufferAttribute
    ).data.array;
    const worker = {
      async generate(input: BufferGeometry) {
        Object.defineProperty(input.getAttribute("position"), "array", {
          configurable: true,
          value: new Float32Array(0),
        });
        if (input.index) {
          Object.defineProperty(input.index, "array", {
            configurable: true,
            value: new Uint32Array(0),
          });
        }
        throw new Error("interleaved worker failure");
      },
      dispose: vi.fn(),
    };
    const builder = createMeshBvhRaycastBuilder(() => worker);

    await expect(builder.build(mesh)).resolves.toBe(false);

    expect(geometry.getAttribute("position")).toBe(originalPosition);
    expect(geometry.index).toBe(originalIndex);
    expect((originalPosition as InterleavedBufferAttribute).data.array).toBe(
      originalPositionData,
    );
    expect(
      (originalIndex as unknown as InterleavedBufferAttribute).data.array,
    ).toBe(originalIndexData);
    expect(geometry.boundsTree).toBeUndefined();
    warning.mockRestore();
  });

  it.each(["invalidate", "dispose"] as const)(
    "keeps interleaved render geometry intact on %s and ignores a stale worker result",
    async (action) => {
      let finish!: (bvh: MeshBVH) => void;
      const geometry = createInterleavedGeometry();
      const mesh = new Mesh(geometry, new MeshBasicMaterial());
      const originalPosition = geometry.getAttribute("position");
      const originalIndex = geometry.index;
      const originalPositionData = (
        originalPosition as InterleavedBufferAttribute
      ).data.array;
      const originalIndexData = (
        originalIndex as unknown as InterleavedBufferAttribute
      ).data.array;
      const worker = {
        generate: vi.fn(
          () => new Promise<MeshBVH>((resolve) => (finish = resolve)),
        ),
        dispose: vi.fn(),
      };
      const builder = createMeshBvhRaycastBuilder(() => worker);

      const pending = builder.build(mesh);
      await Promise.resolve();
      await Promise.resolve();
      builder[action]();

      await expect(pending).resolves.toBe(false);
      finish({} as MeshBVH);
      await Promise.resolve();
      expect(geometry.getAttribute("position")).toBe(originalPosition);
      expect(geometry.index).toBe(originalIndex);
      expect((originalPosition as InterleavedBufferAttribute).data.array).toBe(
        originalPositionData,
      );
      expect(
        (originalIndex as unknown as InterleavedBufferAttribute).data.array,
      ).toBe(originalIndexData);
      expect(geometry.boundsTree).toBeUndefined();
      expect(worker.dispose).toHaveBeenCalledOnce();
    },
  );

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

  it("keeps interleaved worker-input scheduling below 50ms for 125k triangles", async () => {
    const geometry = createInterleavedGeometry(
      new PlaneGeometry(10, 10, 250, 250),
    );
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    const worker = {
      generate: vi.fn(() => new Promise<MeshBVH>(() => undefined)),
      dispose: vi.fn(),
    };
    const builder = createMeshBvhRaycastBuilder(() => worker);

    const startedAt = performance.now();
    const pending = builder.build(mesh);
    const schedulingMs = performance.now() - startedAt;
    builder.invalidate();

    await expect(pending).resolves.toBe(false);
    console.info(
      `selection-bvh-interleaved-profile ${JSON.stringify({ triangles: meshTriangleCount(mesh), schedulingMs })}`,
    );
    expect(schedulingMs).toBeLessThan(50);
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
    expect(isStaticMeshBvhCandidate(interleaved)).toBe(true);
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
