import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimationClip, Group, NumberKeyframeTrack, ObjectLoader } from "three";
import type { ModelParseWorkerPayload } from "../../workers/modelParse.worker";

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

import {
  DEFAULT_MODEL_PARSE_TIMEOUT_MS,
  isAbortOrTimeoutError,
  isModelParseWorkerEnabled,
  parseModelInWorker,
} from "../modelParseWorker";

function gateFor(env: Record<string, unknown> | undefined): boolean {
  return env?.VITE_MODEL_PARSE_WORKER !== "0";
}

function successMessage(id: number, sceneJson: object) {
  return {
    data: {
      id,
      ok: true as const,
      result: { kind: "objectJson" as const, sceneJson },
    },
  };
}

describe("model parse worker gate", () => {
  it("is enabled by default when the env var is unset", () => {
    expect(isModelParseWorkerEnabled()).toBe(true);
  });

  it("disables only on the explicit '0' opt-out", () => {
    expect(gateFor({ VITE_MODEL_PARSE_WORKER: "0" })).toBe(false);
    expect(gateFor({ VITE_MODEL_PARSE_WORKER: "1" })).toBe(true);
    expect(gateFor({})).toBe(true);
    expect(gateFor(undefined)).toBe(true);
  });

  it("classifies abort and timeout errors for fallback suppression", () => {
    const abort = new Error("cancelled");
    abort.name = "AbortError";
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";

    expect(isAbortOrTimeoutError(abort)).toBe(true);
    expect(isAbortOrTimeoutError(timeout)).toBe(true);
    expect(isAbortOrTimeoutError(new Error("worker failed"))).toBe(false);
  });

  it("uses a bounded default timeout", () => {
    expect(DEFAULT_MODEL_PARSE_TIMEOUT_MS).toBe(30_000);
  });
});

describe("model parse worker DAE payload", () => {
  it("accepts serializable texture URL maps for textured Collada documents", () => {
    const payload: ModelParseWorkerPayload = {
      kind: "dae",
      text: "<COLLADA/>",
      basePath: "/models",
      textureUrls: {
        "textures/albedo.png": "blob:resolved-albedo",
      },
      missingTextureUrls: ["textures/normal.png"],
    };

    expect(payload.kind).toBe("dae");
    expect(payload.textureUrls["textures/albedo.png"]).toBe(
      "blob:resolved-albedo",
    );
    expect(payload.missingTextureUrls).toEqual(["textures/normal.png"]);
  });
});

describe("model parse worker glTF payload", () => {
  it("accepts GLB and materialized glTF payloads", () => {
    const glbPayload: ModelParseWorkerPayload = {
      kind: "glb",
      buffer: new ArrayBuffer(4),
    };
    const gltfPayload: ModelParseWorkerPayload = {
      kind: "gltf",
      text: '{"asset":{"version":"2.0"}}',
      resourceUrls: {
        "duck.bin": "blob:duck-bin",
        "duck.png": "blob:duck-png",
      },
    };

    expect(glbPayload.kind).toBe("glb");
    expect(gltfPayload.resourceUrls["duck.png"]).toBe("blob:duck-png");
  });

  it("preserves root animation clips through ObjectLoader JSON roundtrip", () => {
    const root = new Group();
    root.animations = [
      new AnimationClip("Move", 1, [
        new NumberKeyframeTrack(".position[x]", [0, 1], [0, 1]),
      ]),
    ];

    const parsed = new ObjectLoader().parse(root.toJSON());

    expect(parsed.animations).toHaveLength(1);
    expect(parsed.animations[0].name).toBe("Move");
    expect(parsed.animations[0].duration).toBe(1);
  });
});

describe("parseModelInWorker lifecycle and ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workers.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("assigns unique request ids across concurrent requests", async () => {
    const sceneJson = new Group().toJSON();
    const first = parseModelInWorker("a.glb", {
      kind: "glb",
      buffer: new ArrayBuffer(4),
    });
    const second = parseModelInWorker("b.glb", {
      kind: "glb",
      buffer: new ArrayBuffer(4),
    });

    expect(mocks.workers).toHaveLength(2);

    const [workerA, workerB] = mocks.workers;
    const idA = workerA.postMessage.mock.calls[0][0].id;
    const idB = workerB.postMessage.mock.calls[0][0].id;

    expect(idA).not.toBe(idB);

    workerA.emit("message", successMessage(idA, sceneJson));
    workerB.emit("message", successMessage(idB, sceneJson));

    await Promise.all([first, second]);
  });

  it("does not cancel an in-flight peer when one request aborts", async () => {
    const controller = new AbortController();
    const sceneJson = new Group().toJSON();

    const aborted = parseModelInWorker(
      "a.glb",
      { kind: "glb", buffer: new ArrayBuffer(4) },
      { signal: controller.signal },
    );
    const surviving = parseModelInWorker("b.glb", {
      kind: "glb",
      buffer: new ArrayBuffer(4),
    });

    expect(mocks.workers).toHaveLength(2);

    const [workerA, workerB] = mocks.workers;
    const idA = workerA.postMessage.mock.calls[0][0].id;
    const idB = workerB.postMessage.mock.calls[0][0].id;

    controller.abort();

    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    expect(workerA.terminate).toHaveBeenCalledTimes(1);

    workerB.emit("message", successMessage(idB, sceneJson));

    const object = await surviving;
    expect(object).toBeInstanceOf(Group);
    expect(workerB.terminate).toHaveBeenCalledTimes(1);
    expect(idA).not.toBe(idB);
  });

  it("terminates the worker after a successful parse", async () => {
    const sceneJson = new Group().toJSON();
    const promise = parseModelInWorker("ok.glb", {
      kind: "glb",
      buffer: new ArrayBuffer(4),
    });

    const worker = mocks.workers[0];
    const id = worker.postMessage.mock.calls[0][0].id;

    worker.emit("message", successMessage(id, sceneJson));

    await promise;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates the worker after a worker error response", async () => {
    const promise = parseModelInWorker("bad.glb", {
      kind: "glb",
      buffer: new ArrayBuffer(4),
    });

    const worker = mocks.workers[0];
    const id = worker.postMessage.mock.calls[0][0].id;

    worker.emit("message", {
      data: { id, ok: false, error: "parse failed" },
    });

    await expect(promise).rejects.toThrow("parse failed");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates the worker after a timeout", async () => {
    vi.useFakeTimers();

    const promise = parseModelInWorker(
      "slow.glb",
      { kind: "glb", buffer: new ArrayBuffer(4) },
      { timeoutMs: 50 },
    );

    const worker = mocks.workers[0];

    vi.advanceTimersByTime(50);

    await expect(promise).rejects.toMatchObject({ name: "TimeoutError" });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("ignores stale messages that do not match the request id", async () => {
    const sceneJson = new Group().toJSON();
    const promise = parseModelInWorker("stale.glb", {
      kind: "glb",
      buffer: new ArrayBuffer(4),
    });

    const worker = mocks.workers[0];
    const id = worker.postMessage.mock.calls[0][0].id;

    worker.emit("message", successMessage(id + 999, sceneJson));
    worker.emit("message", successMessage(id, sceneJson));

    await promise;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("clones GLB binary buffers before posting to the worker", async () => {
    const buffer = new ArrayBuffer(8);
    const view = new Uint8Array(buffer);
    view.set([1, 2, 3, 4, 5, 6, 7, 8]);
    const originalBytes = Array.from(view);
    const sliceSpy = vi.spyOn(buffer, "slice");

    const promise = parseModelInWorker("x.glb", { kind: "glb", buffer });

    const worker = mocks.workers[0];
    const posted = worker.postMessage.mock.calls[0][0];

    expect(sliceSpy).toHaveBeenCalledWith(0);
    expect(posted.payload.buffer).not.toBe(buffer);
    expect(buffer.byteLength).toBe(8);
    expect(Array.from(new Uint8Array(buffer))).toEqual(originalBytes);

    worker.emit("message", successMessage(posted.id, new Group().toJSON()));

    await promise;
  });

  it("clones other binary model payloads before posting to the worker", async () => {
    const bufferKinds = ["fbx", "ply", "stl"] as const;

    for (const kind of bufferKinds) {
      mocks.workers.length = 0;
      const buffer = new ArrayBuffer(4);
      const sliceSpy = vi.spyOn(buffer, "slice");

      const promise = parseModelInWorker(`x.${kind}`, {
        kind,
        buffer,
        ...(kind === "fbx" ? { resourcePath: "/models" } : {}),
      } as ModelParseWorkerPayload);

      const worker = mocks.workers[0];
      const posted = worker.postMessage.mock.calls[0][0];

      expect(sliceSpy).toHaveBeenCalledWith(0);
      expect(posted.payload.buffer).not.toBe(buffer);

      worker.emit("message", successMessage(posted.id, new Group().toJSON()));
      await promise;
    }
  });

  it("does not clone text-only payloads", async () => {
    const payload: ModelParseWorkerPayload = {
      kind: "obj",
      text: "o Cube",
    };

    const promise = parseModelInWorker("x.obj", payload);

    const worker = mocks.workers[0];
    const posted = worker.postMessage.mock.calls[0][0];

    expect(posted.payload).toBe(payload);
    expect(posted.payload.text).toBe("o Cube");

    worker.emit("message", successMessage(posted.id, new Group().toJSON()));
    await promise;
  });

  it("retains caller-owned buffers after worker failure for main-thread fallback", async () => {
    const buffer = new ArrayBuffer(8);
    const view = new Uint8Array(buffer);
    view.set([9, 8, 7, 6, 5, 4, 3, 2]);
    const originalBytes = Array.from(view);

    const promise = parseModelInWorker("fallback.glb", {
      kind: "glb",
      buffer,
    });

    const worker = mocks.workers[0];
    const id = worker.postMessage.mock.calls[0][0].id;

    worker.emit("message", {
      data: { id, ok: false, error: "worker failed" },
    });

    await expect(promise).rejects.toThrow("worker failed");
    expect(buffer.byteLength).toBe(8);
    expect(Array.from(new Uint8Array(buffer))).toEqual(originalBytes);
  });
});
