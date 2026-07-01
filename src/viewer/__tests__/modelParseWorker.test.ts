import { describe, expect, it } from "vitest";
import type { ModelParseWorkerPayload } from "../../workers/modelParse.worker";
import {
  DEFAULT_MODEL_PARSE_TIMEOUT_MS,
  isAbortOrTimeoutError,
  isModelParseWorkerEnabled,
} from "../modelParseWorker";

function gateFor(env: Record<string, unknown> | undefined): boolean {
  return env?.VITE_MODEL_PARSE_WORKER !== "0";
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
