import { useEffect, useState } from "react";
import { isUsdFile, type SelectedFile } from "../lib/files";
import {
  collectAssetIssues,
  inspectStage,
  inspectUsdLights,
  summarizeStage,
  type AssetIssue,
  type StageInspection,
  type StageLoadPolicy,
  type StageSummary,
  type UsdLightInfo,
} from "../lib/usd";
import { errorMessage } from "../lib/invokeSafe";

export function useUsdInspector(
  currentFile: SelectedFile | null,
  isTauri: boolean,
  usdLoadPolicy: StageLoadPolicy,
) {
  const [usdSummary, setUsdSummary] = useState<StageSummary | null>(null);
  const [usdInspection, setUsdInspection] = useState<StageInspection | null>(
    null,
  );
  const [usdIssues, setUsdIssues] = useState<AssetIssue[]>([]);
  const [usdLights, setUsdLights] = useState<UsdLightInfo[] | null>(null);
  const [usdLightsError, setUsdLightsError] = useState<string | null>(null);
  const [usdInspectorLoading, setUsdInspectorLoading] = useState(false);
  const [usdInspectorError, setUsdInspectorError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!isTauri || !isUsdFile(currentFile) || !currentFile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset all derived async USD state when the file is not a USD file or Tauri is unavailable; values come from cancellable RPCs and cannot be derived during render
      setUsdSummary(null);
      setUsdInspection(null);
      setUsdIssues([]);
      setUsdLights(null);
      setUsdLightsError(null);
      setUsdInspectorLoading(false);
      setUsdInspectorError(null);
      return;
    }

    let cancelled = false;
    setUsdSummary(null);
    setUsdInspection(null);
    setUsdIssues([]);
    setUsdLights(null);
    setUsdLightsError(null);
    setUsdInspectorLoading(true);
    setUsdInspectorError(null);

    const path = currentFile.path;

    const usdInspectorStartMs = performance.now();

    const summarizePromise = summarizeStage(path, usdLoadPolicy)
      .then((summary) => {
        if (cancelled) return;
        setUsdSummary(summary);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setUsdInspectorError(
          errorMessage(error, "Failed to summarize USD stage."),
        );
      });

    const inspectPromise = inspectStage(path, usdLoadPolicy)
      .then((inspection) => {
        if (cancelled) return;
        setUsdInspection(inspection);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setUsdInspectorError(
          (previous) =>
            previous ?? errorMessage(error, "Failed to inspect USD stage."),
        );
      });

    const issuesPromise =
      usdLoadPolicy === "loadAll"
        ? collectAssetIssues(path)
            .then((issues) => {
              if (cancelled) return;
              setUsdIssues(issues);
            })
            .catch((error: unknown) => {
              if (cancelled) return;
              setUsdInspectorError(
                (previous) =>
                  previous ??
                  errorMessage(error, "Failed to collect USD asset issues."),
              );
            })
        : Promise.resolve();

    const lightsPromise =
      usdLoadPolicy === "loadAll"
        ? inspectUsdLights(path)
            .then((lights) => {
              if (cancelled) return;
              setUsdLights(lights);
              setUsdLightsError(null);
            })
            .catch((error: unknown) => {
              if (cancelled) return;
              setUsdLights(null);
              setUsdLightsError(
                errorMessage(error, "Failed to inspect USD lights."),
              );
            })
        : Promise.resolve();

    void Promise.allSettled([
      summarizePromise,
      inspectPromise,
      issuesPromise,
      lightsPromise,
    ]).then(() => {
      if (cancelled) return;
      setUsdInspectorLoading(false);
      if (import.meta.env.DEV) {
        const elapsedMs = Math.round(performance.now() - usdInspectorStartMs);
        console.info(
          `[usd] inspector RPCs settled in ${elapsedMs}ms (policy=${usdLoadPolicy}): ${path}`,
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [currentFile, isTauri, usdLoadPolicy]);

  return {
    usdSummary,
    usdInspection,
    usdIssues,
    usdLights,
    usdLightsError,
    usdInspectorLoading,
    usdInspectorError,
  };
}
