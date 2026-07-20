import { describe, expect, it } from "vitest";
import { createLoadingStageClock } from "../loadingStage";

describe("createLoadingStageClock", () => {
  it("reports the initial stage without accumulated elapsed stages", () => {
    const time = 100;
    const clock = createLoadingStageClock("scan", time, () => time);

    expect(clock.report("scan")).toEqual({
      activeStage: "scan",
      activeStageStartedAt: 100,
      elapsedByStage: {},
      totalElapsedMs: 0,
    });
  });

  it("accumulates elapsed time when the active stage changes", () => {
    let time = 100;
    const clock = createLoadingStageClock("scan", time, () => time);

    time = 140;
    expect(clock.report("decode")).toEqual({
      activeStage: "decode",
      activeStageStartedAt: 140,
      elapsedByStage: { scan: 40 },
      totalElapsedMs: 40,
    });

    time = 190;
    expect(clock.report("scene")).toEqual({
      activeStage: "scene",
      activeStageStartedAt: 190,
      elapsedByStage: { scan: 40, decode: 50 },
      totalElapsedMs: 90,
    });
  });

  it("keeps the active stage start time stable when reporting the same stage", () => {
    let time = 10;
    const clock = createLoadingStageClock("scan", time, () => time);

    time = 25;
    clock.report("decode");

    time = 40;
    expect(clock.report("decode")).toEqual({
      activeStage: "decode",
      activeStageStartedAt: 25,
      elapsedByStage: { scan: 15 },
      totalElapsedMs: 30,
    });
  });

  it("returns snapshots that cannot mutate the clock's elapsed state", () => {
    let time = 0;
    const clock = createLoadingStageClock("scan", time, () => time);

    time = 5;
    const snapshot = clock.report("decode");
    snapshot.elapsedByStage.scan = 999;

    time = 10;
    expect(clock.report("scene").elapsedByStage).toEqual({
      scan: 5,
      decode: 5,
    });
  });

  it("accumulates elapsed time when a stage becomes active more than once", () => {
    let time = 0;
    const clock = createLoadingStageClock("scan", time, () => time);

    time = 5;
    clock.report("decode");

    time = 8;
    clock.report("scan");

    time = 10;
    expect(clock.report("scene").elapsedByStage).toEqual({
      scan: 7,
      decode: 3,
    });
  });
});
