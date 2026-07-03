import { useCallback } from "react";
import { useViewerStore } from "../stores/viewerStore";
import { requestViewportScaleNormalizationCancel } from "../viewport/viewportCommands";
import { DiagnosticsCard } from "./DiagnosticsCard";
import { WarningsCard } from "./WarningsCard";

type WarningsSidebarPanelProps = {
  warnings: string[];
};

export function WarningsSidebarPanel({ warnings }: WarningsSidebarPanelProps) {
  const resourceDiagnostics = useViewerStore(
    (state) => state.resourceDiagnostics,
  );
  const scaleNormalizationApplied = useViewerStore(
    (state) => state.scaleNormalization?.applied ?? false,
  );

  const handleCancelScaleNormalization = useCallback(() => {
    requestViewportScaleNormalizationCancel();
  }, []);

  return (
    <>
      <WarningsCard
        onCancelScaleNormalization={handleCancelScaleNormalization}
        scaleNormalizationApplied={scaleNormalizationApplied}
        warnings={warnings}
      />
      <DiagnosticsCard
        processMemoryMetrics={null}
        resourceDiagnostics={resourceDiagnostics}
      />
    </>
  );
}
