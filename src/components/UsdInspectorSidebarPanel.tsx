import { useCallback } from "react";
import type {
  AssetIssue,
  StageInspection,
  StageLoadPolicy,
  StageSummary,
} from "../lib/usd";
import { useViewerStore } from "../stores/viewerStore";
import { UsdInspectorCard } from "./UsdInspectorCard";

type UsdInspectorSidebarPanelProps = {
  summary: StageSummary | null;
  inspection: StageInspection | null;
  issues: AssetIssue[];
  loading: boolean;
  error: string | null;
};

export function UsdInspectorSidebarPanel({
  summary,
  inspection,
  issues,
  loading,
  error,
}: UsdInspectorSidebarPanelProps) {
  const usdLoadPolicy = useViewerStore((state) => state.usdLoadPolicy);
  const variantSelectionError = useViewerStore(
    (state) => state.variantSelectionError,
  );
  const variantSelections = useViewerStore((state) => state.variantSelections);

  const applyVariantSelection = useCallback(
    (primPath: string, setName: string, variantName: string) => {
      useViewerStore.getState().setVariantSelectionError(null);
      const prev = useViewerStore.getState().variantSelections;
      const next = prev.filter(
        (selection) =>
          !(selection.primPath === primPath && selection.setName === setName),
      );
      next.push({ primPath, setName, variantName });
      useViewerStore.getState().setVariantSelections(next);
    },
    [],
  );

  const handleLoadPolicyChange = useCallback((policy: StageLoadPolicy) => {
    useViewerStore.getState().setUsdLoadPolicy(policy);
  }, []);

  return (
    <UsdInspectorCard
      error={error}
      inspection={inspection}
      issues={issues}
      loading={loading}
      summary={summary}
      loadPolicy={usdLoadPolicy}
      onLoadPolicyChange={handleLoadPolicyChange}
      variantSelectionError={variantSelectionError}
      variantSelections={variantSelections}
      onVariantChange={applyVariantSelection}
    />
  );
}
