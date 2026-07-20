import { SNAPSHOT_PERF_NOW } from "./states";

const PATCHED_KEY = "__YW_VIEWPORT_STATE_SNAPSHOT_PERF_PATCHED__";

export function freezePerformanceNowForSnapshot() {
  if (Object.hasOwn(globalThis, PATCHED_KEY)) {
    return;
  }

  Object.defineProperty(globalThis, PATCHED_KEY, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  performance.now = () => SNAPSHOT_PERF_NOW;
}
