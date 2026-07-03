import { describe, expect, it, vi } from "vitest";
import { deferEffectStateUpdate } from "../deferEffectStateUpdate";

function waitForMicrotask(): Promise<void> {
  return new Promise((resolve) => {
    queueMicrotask(resolve);
  });
}

describe("deferEffectStateUpdate", () => {
  it("runs the update on the next microtask", async () => {
    const update = vi.fn();

    deferEffectStateUpdate(update);

    expect(update).not.toHaveBeenCalled();
    await waitForMicrotask();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending update when the cleanup runs first", async () => {
    const update = vi.fn();
    const cleanup = deferEffectStateUpdate(update);

    cleanup();
    await waitForMicrotask();

    expect(update).not.toHaveBeenCalled();
  });
});
