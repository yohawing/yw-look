import { useEffect } from "react";
import { ViewerStatePanel } from "../components/ViewerStatePanel";
import type { ViewportStateSnapshotCase } from "./states";

type ViewportStateSnapshotHarnessProps = {
  testCase: ViewportStateSnapshotCase;
};

export function ViewportStateSnapshotHarness({
  testCase,
}: ViewportStateSnapshotHarnessProps) {
  useEffect(() => {
    document.documentElement.dataset.viewportStateSnapshotReady = testCase.id;
    return () => {
      delete document.documentElement.dataset.viewportStateSnapshotReady;
    };
  }, [testCase.id]);

  return (
    <div
      className="viewport-state-snapshot-harness"
      data-state={testCase.id}
      data-viewport-state-snapshot-ready={testCase.id}
    >
      <div
        className={`viewport-overlay${testCase.mode === "empty" ? " is-empty" : ""}`}
      >
        <ViewerStatePanel
          detailMessage={testCase.detailMessage}
          fileExtension={testCase.fileExtension}
          fileName={testCase.fileName}
          loadingStage={testCase.loadingStage}
          mode={testCase.mode}
        />
      </div>
    </div>
  );
}
