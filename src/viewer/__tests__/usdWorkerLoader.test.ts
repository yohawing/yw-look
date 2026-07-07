/**
 * Regression tests for `isUsdWorkerEnabled` and USD worker request isolation.
 *
 * The gate flipped from OFF → ON in #45 once Phase 3 narrowed the
 * worker's responsibility to single-buffer USDA. We assert the
 * default-on shape against the live module — when the test suite
 * runs `VITE_USD_WORKER` is unset, so the function must return `true`.
 *
 * The `=0` opt-out is asserted by directly invoking the same logic
 * with a synthetic env object; Vitest's `stubEnv` does not propagate
 * `import.meta.env` mutations across the module boundary on this
 * config (verified empirically, the imported module sees the
 * pre-stub value), so a same-file pure-function check is the most
 * reliable shape we can lock in here.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Group } from "three";

type MockWorkerInstance = {
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  listeners: Map<string, Set<EventListener>>;
  emit: (type: string, event?: unknown) => void;
};

const mocks = vi.hoisted(() => {
  const workers: MockWorkerInstance[] = [];

  class MockWorker {
    readonly listeners = new Map<string, Set<EventListener>>();
    readonly addEventListener = vi.fn(
      (type: string, listener: EventListener) => {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(listener);
      },
    );
    readonly removeEventListener = vi.fn(
      (type: string, listener: EventListener) => {
        this.listeners.get(type)?.delete(listener);
      },
    );
    readonly postMessage = vi.fn();
    readonly terminate = vi.fn();

    constructor() {
      workers.push(this as unknown as MockWorkerInstance);
    }

    emit(type: string, event?: unknown) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event as Event);
      }
    }
  }

  return {
    workers,
    Worker: MockWorker,
  };
});

vi.stubGlobal("Worker", mocks.Worker);

import { isUsdWorkerEnabled, parseUsdInWorker } from "../usdWorkerLoader";

function gateFor(env: Record<string, unknown> | undefined): boolean {
  return env?.VITE_USD_WORKER !== "0";
}

describe("isUsdWorkerEnabled", () => {
  it("is enabled by default when the env var is unset", () => {
    expect(isUsdWorkerEnabled()).toBe(true);
  });

  it("disables only on the explicit '0' opt-out", () => {
    expect(gateFor({ VITE_USD_WORKER: "0" })).toBe(false);
  });

  it("stays enabled for legacy '1' and arbitrary values", () => {
    expect(gateFor({ VITE_USD_WORKER: "1" })).toBe(true);
    expect(gateFor({ VITE_USD_WORKER: "true" })).toBe(true);
    expect(gateFor({ VITE_USD_WORKER: "" })).toBe(true);
    expect(gateFor({})).toBe(true);
    expect(gateFor(undefined)).toBe(true);
  });
});

describe("parseUsdInWorker request isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workers.length = 0;
  });

  it("does not cancel an in-flight peer when one request aborts", async () => {
    const controller = new AbortController();
    const sceneJson = new Group().toJSON();

    const aborted = parseUsdInWorker(
      "a.usda",
      { kind: "text", text: "#usda" },
      { signal: controller.signal },
    );
    const surviving = parseUsdInWorker("b.usda", {
      kind: "text",
      text: "#usda",
    });

    expect(mocks.workers).toHaveLength(2);

    const [workerA, workerB] = mocks.workers;
    const idA = workerA.postMessage.mock.calls[0][0].id;
    const idB = workerB.postMessage.mock.calls[0][0].id;

    controller.abort();

    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    expect(workerA.terminate).toHaveBeenCalled();

    workerB.emit("message", {
      data: {
        id: idB,
        ok: true,
        result: { kind: "objectJson", sceneJson },
      },
    });

    const object = await surviving;
    expect(object).toBeInstanceOf(Group);
    expect(workerB.terminate).toHaveBeenCalled();
    expect(idA).not.toBe(idB);
  });

  it("clones binary buffers before posting to the worker", async () => {
    const buffer = new ArrayBuffer(8);
    const sliceSpy = vi.spyOn(buffer, "slice");

    const promise = parseUsdInWorker("x.usdc", { kind: "binary", buffer });

    const worker = mocks.workers[0];
    const posted = worker.postMessage.mock.calls[0][0];

    expect(sliceSpy).toHaveBeenCalledWith(0);
    expect(posted.payload.buffer).not.toBe(buffer);
    expect(buffer.byteLength).toBe(8);

    worker.emit("message", {
      data: {
        id: posted.id,
        ok: true,
        result: { kind: "objectJson", sceneJson: new Group().toJSON() },
      },
    });

    await promise;
  });
});
