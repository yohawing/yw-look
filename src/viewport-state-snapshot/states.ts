import type { LoadingStageSnapshot } from "../types/viewer";
import type { ViewerMode } from "../types/viewer";

export type ViewportStateSnapshotCaseId = "empty" | "loading" | "error";

export const SNAPSHOT_PERF_NOW = 10_000;

export const loadingSnapshotStage: LoadingStageSnapshot = {
  activeStage: "decode",
  activeStageStartedAt: SNAPSHOT_PERF_NOW - 842,
  elapsedByStage: {
    scan: 128,
    resolve: 356,
  },
  totalElapsedMs: 484,
};

export type ViewportStateSnapshotCase = {
  id: ViewportStateSnapshotCaseId;
  label: string;
  mode: ViewerMode;
  fileName?: string;
  fileExtension?: string;
  detailMessage?: string;
  loadingStage?: LoadingStageSnapshot | null;
};

export const viewportStateSnapshotCases: ViewportStateSnapshotCase[] = [
  {
    id: "empty",
    label: "Empty viewport overlay",
    mode: "empty",
  },
  {
    id: "loading",
    label: "Loading viewport overlay",
    mode: "loading",
    fileName: "BoxTextured.glb",
    loadingStage: loadingSnapshotStage,
  },
  {
    id: "error",
    label: "Load error viewport overlay",
    mode: "loadFailed",
    fileName: "broken-model.glb",
    fileExtension: "glb",
    detailMessage:
      "Failed to read buffer view 2: byte length 0 is out of range.",
  },
];

export function getViewportStateSnapshotCase(
  state: string | null,
): ViewportStateSnapshotCase {
  const testCase = viewportStateSnapshotCases.find(
    (candidate) => candidate.id === state,
  );
  if (!testCase) {
    throw new Error(
      `unknown viewport state snapshot case: ${state ?? "(missing)"}`,
    );
  }
  return testCase;
}
