import { describe, expect, it, vi } from "vitest";
import {
  BoxGeometry,
  BufferGeometry,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
} from "three";
import { acceleratedRaycast, MeshBVH } from "three-mesh-bvh";
import { createViewportPicker } from "../selection";
import { createMeshBvhRaycastBuilder, meshTriangleCount } from "../../viewer";

function makeDomElement() {
  return {
    getBoundingClientRect: () =>
      ({
        left: 0,
        top: 0,
        width: 100,
        height: 100,
      }) as DOMRect,
  };
}

function makePointer(clientX: number, clientY: number) {
  return { clientX, clientY } as PointerEvent;
}

function makeInterleavedPlaneGeometry() {
  const source = new PlaneGeometry(2, 2);
  const position = source.getAttribute("position");
  const positionArray = new Float32Array(position.count * 4);
  for (let item = 0; item < position.count; item += 1) {
    const offset = item * 4;
    positionArray[offset] = position.getX(item);
    positionArray[offset + 1] = position.getY(item);
    positionArray[offset + 2] = position.getZ(item);
    positionArray[offset + 3] = 456;
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
  const sourceIndex = source.index!;
  const indexArray = new Uint16Array(sourceIndex.count * 2);
  for (let item = 0; item < sourceIndex.count; item += 1) {
    indexArray[item * 2] = sourceIndex.getX(item);
    indexArray[item * 2 + 1] = 999;
  }
  geometry.setIndex(
    new InterleavedBufferAttribute(
      new InterleavedBuffer(indexArray, 2),
      1,
      0,
    ) as never,
  );
  return geometry;
}

describe("createViewportPicker", () => {
  it("does not prepare or raycast before post-render mounted synchronization", () => {
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    mesh.name = "NotUploadedYet";
    const raycast = vi.spyOn(mesh, "raycast");
    const builder = {
      build: vi.fn(async () => true),
      invalidate: vi.fn(),
      dispose: vi.fn(),
    } as unknown as ReturnType<typeof createMeshBvhRaycastBuilder>;
    const picker = createViewportPicker(
      new PerspectiveCamera(),
      makeDomElement(),
      { bvhBuilder: builder, largeTriangleThreshold: 1 },
    );

    expect(picker.pickSelectionKey(mesh, makePointer(50, 50))).toBeNull();
    expect(builder.build).not.toHaveBeenCalled();
    expect(raycast).not.toHaveBeenCalled();
  });

  it("returns the selection key for a mesh under the pointer", () => {
    const scene = new Scene();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.name = "Cube";
    mesh.position.z = -5;
    scene.add(mesh);
    scene.updateMatrixWorld(true);

    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld(true);
    const picker = createViewportPicker(camera, makeDomElement());
    picker.syncMountedObject(scene);

    expect(picker.pickSelectionKey(scene, makePointer(50, 50))).toBe("Cube");
  });

  it("selects a mounted root mesh directly", () => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.name = "RootMesh";
    mesh.position.z = -5;
    mesh.updateMatrixWorld(true);

    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld(true);
    const picker = createViewportPicker(camera, makeDomElement());
    picker.syncMountedObject(mesh);

    expect(picker.pickSelectionKey(mesh, makePointer(50, 50))).toBe("RootMesh");
  });

  it("ignores the shadow catcher mesh", () => {
    const scene = new Scene();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.name = "__yw_shadow_catcher";
    mesh.position.z = -5;
    scene.add(mesh);
    scene.updateMatrixWorld(true);

    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld(true);
    const picker = createViewportPicker(camera, makeDomElement());
    picker.syncMountedObject(scene);

    expect(picker.pickSelectionKey(scene, makePointer(50, 50))).toBeNull();
  });

  it("returns null when the pointer misses selectable geometry", () => {
    const scene = new Scene();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.name = "Cube";
    mesh.position.set(10, 10, -5);
    scene.add(mesh);
    scene.updateMatrixWorld(true);

    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld(true);
    const picker = createViewportPicker(camera, makeDomElement());
    picker.syncMountedObject(scene);

    expect(picker.pickSelectionKey(scene, makePointer(50, 50))).toBeNull();
  });

  it("never synchronously raycasts a large mesh before BVH preparation", async () => {
    let finishBuild!: (ready: boolean) => void;
    const build = vi.fn(
      () => new Promise<boolean>((resolve) => (finishBuild = resolve)),
    );
    const bvhBuilder = {
      build,
      invalidate: vi.fn(),
      dispose: vi.fn(),
    } as unknown as ReturnType<typeof createMeshBvhRaycastBuilder>;
    const scene = new Scene();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.name = "Large";
    mesh.position.z = -5;
    scene.add(mesh);
    scene.updateMatrixWorld(true);
    const raycast = vi.spyOn(mesh, "raycast");
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld(true);
    let rect = { left: 0, top: 0, width: 100, height: 100 } as DOMRect;
    const picker = createViewportPicker(
      camera,
      { getBoundingClientRect: () => rect },
      {
        bvhBuilder,
        largeTriangleThreshold: 1,
      },
    );
    picker.syncMountedObject(scene);

    const result = picker.pickSelectionKey(scene, makePointer(50, 50));
    expect(result).toBeInstanceOf(Promise);
    expect(raycast).not.toHaveBeenCalled();
    camera.position.x = 10;
    camera.updateMatrixWorld(true);
    rect = { left: 100, top: 100, width: 50, height: 50 } as DOMRect;
    await Promise.resolve();
    finishBuild(true);
    await expect(result).resolves.toBe("Large");
    expect(raycast).toHaveBeenCalled();
    expect(build).toHaveBeenCalledTimes(1);

    picker.syncMountedObject(scene);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("invalidates a stale pending pick when the mounted asset changes", async () => {
    let finishBuild!: (ready: boolean) => void;
    const bvhBuilder = {
      build: () => new Promise<boolean>((resolve) => (finishBuild = resolve)),
      invalidate: vi.fn(),
      dispose: vi.fn(),
    } as unknown as ReturnType<typeof createMeshBvhRaycastBuilder>;
    const first = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    first.name = "First";
    const second = new Scene();
    const picker = createViewportPicker(
      new PerspectiveCamera(),
      makeDomElement(),
      { bvhBuilder, largeTriangleThreshold: 1 },
    );

    picker.syncMountedObject(first);
    const pending = picker.pickSelectionKey(first, makePointer(50, 50));
    await Promise.resolve();
    picker.syncMountedObject(second);
    finishBuild(true);

    await expect(pending).resolves.toBeNull();
    expect(bvhBuilder.invalidate).toHaveBeenCalledTimes(2);
  });

  it("skips queued meshes from an old root while the new root completes", async () => {
    let finishOldFirst!: (ready: boolean) => void;
    const oldRoot = new Scene();
    const oldFirst = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    oldFirst.name = "OldFirst";
    const oldSecond = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    oldSecond.name = "OldSecond";
    oldRoot.add(oldFirst, oldSecond);
    const newRoot = new Scene();
    const newMesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    newMesh.name = "NewMesh";
    newRoot.add(newMesh);
    const build = vi.fn((mesh: Mesh) =>
      mesh === oldFirst
        ? new Promise<boolean>((resolve) => (finishOldFirst = resolve))
        : Promise.resolve(true),
    );
    const builder = {
      build,
      invalidate: vi.fn(),
      dispose: vi.fn(),
    } as unknown as ReturnType<typeof createMeshBvhRaycastBuilder>;
    const picker = createViewportPicker(
      new PerspectiveCamera(),
      makeDomElement(),
      { bvhBuilder: builder, largeTriangleThreshold: 1 },
    );

    picker.syncMountedObject(oldRoot);
    await Promise.resolve();
    expect(build).toHaveBeenCalledWith(oldFirst);
    picker.syncMountedObject(newRoot);
    await Promise.resolve();
    await Promise.resolve();
    expect(build).toHaveBeenCalledWith(newMesh);
    finishOldFirst(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(build).not.toHaveBeenCalledWith(oldSecond);
    await expect(
      Promise.resolve(picker.pickSelectionKey(newRoot, makePointer(50, 50))),
    ).resolves.toBeNull();
  });

  it("settles a pending pick when asset replacement terminates the worker", async () => {
    const worker = {
      generate: vi.fn(() => new Promise<MeshBVH>(() => undefined)),
      dispose: vi.fn(),
    };
    const builder = createMeshBvhRaycastBuilder(() => worker);
    const first = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    first.name = "FirstLarge";
    first.position.z = -5;
    first.updateMatrixWorld(true);
    const picker = createViewportPicker(
      new PerspectiveCamera(60, 1, 0.1, 100),
      makeDomElement(),
      { bvhBuilder: builder, largeTriangleThreshold: 1 },
    );
    picker.syncMountedObject(first);
    await Promise.resolve();
    await Promise.resolve();

    const pending = picker.pickSelectionKey(first, makePointer(50, 50));
    picker.syncMountedObject(new Scene());

    await expect(pending).resolves.toBeNull();
    expect(worker.dispose).toHaveBeenCalled();
  });

  it("does not fall back to synchronous triangles for a large dynamic mesh", () => {
    const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    mesh.name = "DynamicLarge";
    mesh.morphTargetInfluences = [0];
    const raycast = vi.spyOn(mesh, "raycast");
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const builder = {
      build: vi.fn(async () => true),
      invalidate: vi.fn(),
      dispose: vi.fn(),
    } as unknown as ReturnType<typeof createMeshBvhRaycastBuilder>;
    const picker = createViewportPicker(
      new PerspectiveCamera(),
      makeDomElement(),
      { bvhBuilder: builder, largeTriangleThreshold: 1 },
    );
    picker.syncMountedObject(mesh);

    expect(picker.pickSelectionKey(mesh, makePointer(50, 50))).toBeNull();
    expect(builder.build).not.toHaveBeenCalled();
    expect(raycast).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("dynamic or unsupported geometry excluded"),
    );
    warning.mockRestore();
  });

  it("picks ready interleaved geometry without synchronous triangle fallback", async () => {
    let workerInput: BufferGeometry | null = null;
    let finishBuild!: () => void;
    const worker = {
      generate: vi.fn(
        (input: BufferGeometry) =>
          new Promise<MeshBVH>((resolve) => {
            workerInput = input;
            finishBuild = () => resolve(new MeshBVH(input));
          }),
      ),
      dispose: vi.fn(),
    };
    const builder = createMeshBvhRaycastBuilder(() => worker);
    const geometry = makeInterleavedPlaneGeometry();
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.name = "InterleavedLarge";
    mesh.position.z = -5;
    mesh.updateMatrixWorld(true);
    const originalPosition = geometry.getAttribute("position");
    const originalIndex = geometry.index;
    const originalPositionData = (
      originalPosition as InterleavedBufferAttribute
    ).data.array;
    const originalIndexData = (
      originalIndex as unknown as InterleavedBufferAttribute
    ).data.array;
    const originalRaycast = vi.spyOn(mesh, "raycast");
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.updateMatrixWorld(true);
    const picker = createViewportPicker(camera, makeDomElement(), {
      bvhBuilder: builder,
      largeTriangleThreshold: 1,
    });
    picker.syncMountedObject(mesh);

    const pending = picker.pickSelectionKey(mesh, makePointer(50, 50));
    expect(pending).toBeInstanceOf(Promise);
    await Promise.resolve();
    await Promise.resolve();
    expect(originalRaycast).not.toHaveBeenCalled();
    expect(
      (workerInput as unknown as BufferGeometry).getAttribute(
        "position",
      ) instanceof InterleavedBufferAttribute,
    ).toBe(false);
    expect(
      (workerInput as unknown as BufferGeometry).index instanceof
        InterleavedBufferAttribute,
    ).toBe(false);
    finishBuild();

    await expect(pending).resolves.toBe("InterleavedLarge");
    expect(originalRaycast).not.toHaveBeenCalled();
    expect(geometry.getAttribute("position")).toBe(originalPosition);
    expect(geometry.index).toBe(originalIndex);
    expect((originalPosition as InterleavedBufferAttribute).data.array).toBe(
      originalPositionData,
    );
    expect(
      (originalIndex as unknown as InterleavedBufferAttribute).data.array,
    ).toBe(originalIndexData);
  });

  it("settles a failed interleaved build without synchronous triangle fallback", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const worker = {
      generate: vi.fn(async () => {
        throw new Error("proxy build failed");
      }),
      dispose: vi.fn(),
    };
    const builder = createMeshBvhRaycastBuilder(() => worker);
    const geometry = makeInterleavedPlaneGeometry();
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.name = "InterleavedFailure";
    const originalPosition = geometry.getAttribute("position");
    const originalIndex = geometry.index;
    const originalRaycast = vi.spyOn(mesh, "raycast");
    const picker = createViewportPicker(
      new PerspectiveCamera(),
      makeDomElement(),
      { bvhBuilder: builder, largeTriangleThreshold: 1 },
    );

    picker.syncMountedObject(mesh);
    await expect(
      picker.pickSelectionKey(mesh, makePointer(50, 50)),
    ).resolves.toBeNull();

    expect(originalRaycast).not.toHaveBeenCalled();
    expect(geometry.getAttribute("position")).toBe(originalPosition);
    expect(geometry.index).toBe(originalIndex);
    expect(geometry.boundsTree).toBeUndefined();
    warning.mockRestore();
  });

  it("keeps high-poly scheduling and ready clicking below 50ms", async () => {
    const geometry = new PlaneGeometry(10, 10, 250, 250);
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.name = "GeneratedHighPoly";
    mesh.position.z = -5;
    mesh.updateMatrixWorld(true);
    const bvh = new MeshBVH(geometry);
    const builder = {
      build: vi.fn(async () => {
        geometry.boundsTree = bvh;
        mesh.raycast = acceleratedRaycast;
        return true;
      }),
      invalidate: vi.fn(),
      dispose: vi.fn(),
    } as unknown as ReturnType<typeof createMeshBvhRaycastBuilder>;
    const picker = createViewportPicker(
      new PerspectiveCamera(60, 1, 0.1, 100),
      makeDomElement(),
      { bvhBuilder: builder },
    );

    const startedAt = performance.now();
    picker.syncMountedObject(mesh);
    const schedulingMs = performance.now() - startedAt;
    await Promise.resolve();
    await Promise.resolve();
    const clickStartedAt = performance.now();
    await picker.pickSelectionKey(mesh, makePointer(50, 50));
    const readyClickMs = performance.now() - clickStartedAt;

    console.info(
      `selection-bvh-profile ${JSON.stringify({ triangles: meshTriangleCount(mesh), schedulingMs, readyClickMs })}`,
    );

    expect(schedulingMs).toBeLessThan(50);
    expect(readyClickMs).toBeLessThan(50);
  });
});
