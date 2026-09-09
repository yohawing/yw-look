import { describe, expect, it, vi } from "vitest";
import { Box3, Group, PerspectiveCamera } from "three";
import type { IfcInspection } from "../../../types/ifc";
import type { IfcRuntimeState } from "../types";
import { createIfcRuntime } from "../runtime";

function createInspection() {
  return {
    getSnapshot: () => ({
      elements: [
        {
          id: 1,
          name: "Wall",
          category: "IFCWALL",
          storey: "Floor",
          building: "Building",
        },
      ],
    }),
    select: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  } as unknown as IfcInspection;
}

function createState() {
  const model = {
    object: new Group(),
    useCamera: vi.fn(),
    raycast: vi.fn(),
    getMergedBox: vi.fn(),
  };
  const manager = {
    load: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
  return {
    state: { manager, model } as unknown as IfcRuntimeState,
    model,
    manager,
  };
}

describe("createIfcRuntime", () => {
  it("drains selection work before disposal and discards late results", async () => {
    const { state, model, manager } = createState();
    const inspection = createInspection();
    let finishInspection!: () => void;
    vi.mocked(inspection.dispose).mockReturnValue(
      new Promise<void>((resolve) => {
        finishInspection = resolve;
      }),
    );
    let finishPick!: (hit: { localId: number }) => void;
    model.raycast.mockReturnValue(
      new Promise((resolve) => {
        finishPick = resolve;
      }),
    );
    let finishBounds!: (bounds: Box3) => void;
    model.getMergedBox.mockReturnValue(
      new Promise((resolve) => {
        finishBounds = resolve;
      }),
    );
    const runtime = createIfcRuntime(state, inspection);
    const camera = new PerspectiveCamera();
    const pick = runtime.selection!.pick(
      { clientX: 1, clientY: 2 },
      camera,
      document.createElement("canvas"),
    );
    const bounds = runtime.selection!.getBounds!("ifc:1");
    runtime.dispose();
    runtime.dispose();
    finishInspection();
    await Promise.resolve();
    expect(manager.dispose).not.toHaveBeenCalled();
    finishPick({ localId: 1 });
    expect(await pick).toBeNull();
    expect(manager.dispose).not.toHaveBeenCalled();
    finishBounds(new Box3());
    expect(await bounds).toBeNull();
    await vi.waitFor(() => expect(manager.dispose).toHaveBeenCalledOnce());
    expect(inspection.dispose).toHaveBeenCalledOnce();
    expect(await runtime.selection!.getBounds!("ifc:1")).toBeNull();
    expect(model.getMergedBox).toHaveBeenCalledOnce();
  });

  it("forwards the viewport camera and owns manager resources", () => {
    const { state, model, manager } = createState();
    const runtime = createIfcRuntime(state, createInspection());
    const camera = new PerspectiveCamera();

    runtime.update?.({
      camera,
      deltaSeconds: 1 / 60,
      renderer: {} as never,
    });

    expect(runtime.ownsMountedObjectResources).toBe(true);
    expect(model.useCamera).toHaveBeenCalledWith(camera);
    expect(manager.update).toHaveBeenCalledOnce();
  });

  it("serializes frame updates while a Fragments refresh is pending", () => {
    const { state, manager } = createState();
    const runtime = createIfcRuntime(state, createInspection());
    const camera = new PerspectiveCamera();
    let resolveUpdate!: () => void;
    manager.update.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    runtime.update?.({
      camera,
      deltaSeconds: 1 / 60,
      renderer: {} as never,
    });
    runtime.update?.({
      camera,
      deltaSeconds: 1 / 60,
      renderer: {} as never,
    });

    expect(manager.update).toHaveBeenCalledOnce();
    resolveUpdate();
  });

  it("waits for a pending refresh before disposing the manager", async () => {
    const { state, manager } = createState();
    const runtime = createIfcRuntime(state, createInspection());
    const camera = new PerspectiveCamera();
    let resolveUpdate!: () => void;
    manager.update.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    runtime.update?.({
      camera,
      deltaSeconds: 1 / 60,
      renderer: {} as never,
    });
    runtime.dispose();

    expect(manager.dispose).not.toHaveBeenCalled();
    resolveUpdate();
    await vi.waitFor(() => expect(manager.dispose).toHaveBeenCalledOnce());
  });

  it("disposes the fragments manager exactly once and ignores later updates", async () => {
    const { state, model, manager } = createState();
    const runtime = createIfcRuntime(state, createInspection());
    const camera = new PerspectiveCamera();

    runtime.dispose();
    runtime.dispose();
    runtime.update?.({
      camera,
      deltaSeconds: 0,
      renderer: {} as never,
    });

    await vi.waitFor(() => expect(manager.dispose).toHaveBeenCalledOnce());
    expect(model.useCamera).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
  });
});
