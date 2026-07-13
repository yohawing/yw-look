import { describe, expect, it, vi } from "vitest";
import {
  BoxGeometry,
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

  it("settles without build or synchronous raycast for interleaved geometry", async () => {
    const data = new InterleavedBuffer(
      new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
      3,
    );
    const geometry = new BoxGeometry();
    geometry.setAttribute(
      "position",
      new InterleavedBufferAttribute(data, 3, 0),
    );
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.name = "InterleavedLarge";
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

    await expect(
      Promise.resolve(picker.pickSelectionKey(mesh, makePointer(50, 50))),
    ).resolves.toBeNull();
    expect(builder.build).not.toHaveBeenCalled();
    expect(raycast).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("dynamic or unsupported geometry excluded"),
    );
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
