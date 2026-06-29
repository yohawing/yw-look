import type { ViewerFeedback } from "../types/viewer";

export type ReadyPreviewFeedbackBase = {
  message: string;
  warnings: Array<string | null>;
};

export function joinFeedbackWarnings(
  warnings: readonly (string | null | undefined)[],
) {
  const warningText = warnings
    .filter((warning): warning is string => Boolean(warning))
    .join("\n");
  return warningText || null;
}

export function buildReadyPreviewFeedback(
  readyFeedbackBase: ReadyPreviewFeedbackBase,
  runtimeWarnings: readonly string[],
): ViewerFeedback {
  return {
    mode: "ready",
    message: readyFeedbackBase.message,
    warning: joinFeedbackWarnings([
      ...readyFeedbackBase.warnings,
      ...runtimeWarnings,
    ]),
    canResetCamera: true,
  };
}

export function buildRuntimeWarningFeedback(
  fileName: string,
  runtimeWarnings: readonly string[],
  readyFeedbackBase: ReadyPreviewFeedbackBase | null,
): ViewerFeedback {
  if (readyFeedbackBase) {
    return buildReadyPreviewFeedback(readyFeedbackBase, runtimeWarnings);
  }

  return {
    mode: "loading",
    message: `Loading ${fileName}`,
    warning: runtimeWarnings.join("\n") || null,
    canResetCamera: false,
  };
}
