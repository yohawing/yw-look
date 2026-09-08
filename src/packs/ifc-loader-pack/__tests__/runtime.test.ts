import { describe, expect, it, vi } from "vitest";
import { Group, PerspectiveCamera } from "three";
import type { IfcRuntimeState } from "../types";
import { createIfcRuntime } from "../runtime";

function createState() {
  const model = {
    object: new Group(),
    useCamera: vi.fn(),
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
  it("forwards the viewport camera and owns manager resources", () => {
    const { state, model, manager } = createState();
    const runtime = createIfcRuntime(state);
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
    const runtime = createIfcRuntime(state);
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
    const runtime = createIfcRuntime(state);
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

  it("disposes the fragments manager exactly once and ignores later updates", () => {
    const { state, model, manager } = createState();
    const runtime = createIfcRuntime(state);
    const camera = new PerspectiveCamera();

    runtime.dispose();
    runtime.dispose();
    runtime.update?.({
      camera,
      deltaSeconds: 0,
      renderer: {} as never,
    });

    expect(manager.dispose).toHaveBeenCalledOnce();
    expect(model.useCamera).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
  });
});
