import { useMemo } from "react";
import type {
  StageInspection,
  StageLoadPolicy,
  StageSummary,
} from "../lib/usd";

export function useSessionAdjustedUsdSummary({
  payloadPrimPaths,
  unloadedPayloadPaths,
  usdInspection,
  usdLoadPolicy,
  usdSummary,
}: {
  payloadPrimPaths: ReadonlySet<string>;
  unloadedPayloadPaths: ReadonlySet<string>;
  usdInspection: StageInspection | null;
  usdLoadPolicy: StageLoadPolicy;
  usdSummary: StageSummary | null;
}) {
  return useMemo(() => {
    if (
      !usdSummary ||
      !usdInspection ||
      usdLoadPolicy !== "noPayloads" ||
      payloadPrimPaths.size === 0
    ) {
      return usdSummary;
    }
    const payloadArcCounts = usdInspection.payloads.reduce(
      (counts, arc) => {
        if (arc.state === "missing") {
          counts.unresolved += 1;
        } else if (
          arc.state === "unloaded" &&
          unloadedPayloadPaths.has(arc.sourcePrim)
        ) {
          counts.unloaded += 1;
        } else {
          counts.resolved += 1;
        }
        return counts;
      },
      { resolved: 0, unloaded: 0, unresolved: 0 },
    );
    return {
      ...usdSummary,
      unloadedPayloadCount: payloadArcCounts.unloaded,
      resolvedPayloadCount: payloadArcCounts.resolved,
      unresolvedPayloadCount: payloadArcCounts.unresolved,
    };
  }, [
    payloadPrimPaths.size,
    unloadedPayloadPaths,
    usdInspection,
    usdLoadPolicy,
    usdSummary,
  ]);
}
