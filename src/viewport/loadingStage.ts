import type { LoadingStageId, LoadingStageSnapshot } from "../types/viewer";

export type LoadingStageClock = {
  report(stage: LoadingStageId): LoadingStageSnapshot;
};

export function createLoadingStageClock(
  initialStage: LoadingStageId,
  startedAt: number,
  now: () => number = () => performance.now(),
): LoadingStageClock {
  const elapsedByStage: Partial<Record<LoadingStageId, number>> = {};
  let activeStage = initialStage;
  let activeStartedAt = startedAt;

  return {
    report(stage) {
      const timestamp = now();
      if (stage !== activeStage) {
        elapsedByStage[activeStage] =
          (elapsedByStage[activeStage] ?? 0) + (timestamp - activeStartedAt);
        activeStage = stage;
        activeStartedAt = timestamp;
      }

      return {
        activeStage: stage,
        activeStageStartedAt: activeStartedAt,
        elapsedByStage: { ...elapsedByStage },
        totalElapsedMs: timestamp - startedAt,
      };
    },
  };
}
