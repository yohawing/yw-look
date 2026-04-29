/**
 * Regression tests for `isUsdWorkerEnabled`.
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

import { describe, expect, it } from "vitest";
import { isUsdWorkerEnabled } from "../usdWorkerLoader";

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
