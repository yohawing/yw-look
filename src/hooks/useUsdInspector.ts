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
  type VariantSelection,
} from "../lib/usd";
import { errorMessage } from "../lib/errors";
import { retryWhileBusy } from "../lib/usdBusyRetry";

const USD_INSPECTOR_DEFER_MS = 1_000;
const EMPTY_VARIANT_SELECTIONS: VariantSelection[] = [];

function makeUsdInspectorQueryKey(
  currentFile: SelectedFile | null,
  variantSelections: VariantSelection[],
): string {
  return JSON.stringify({
    path: isUsdFile(currentFile) ? (currentFile?.path ?? null) : null,
    variantSelections,
  });
}

export function useUsdInspector(
  currentFile: SelectedFile | null,
  isTauri: boolean,
  usdLoadPolicy: StageLoadPolicy,
  enabled: boolean,
  variantSelections: VariantSelection[] = EMPTY_VARIANT_SELECTIONS,
) {
  const currentQueryKey = makeUsdInspectorQueryKey(
    currentFile,
    variantSelections,
  );
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
  const [usdInspectorStartedQueryKey, setUsdInspectorStartedQueryKey] =
    useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- invalidate the previous async snapshot before starting queries for a new USD selection
    setUsdInspectorStartedQueryKey(currentQueryKey);
    if (!isTauri || !isUsdFile(currentFile) || !currentFile) {
      setUsdSummary(null);
      setUsdInspection(null);
      setUsdIssues([]);
      setUsdLights(null);
      setUsdLightsError(null);
      setUsdInspectorLoading(false);
      setUsdInspectorError(null);
      return;
    }

    setUsdSummary(null);
    setUsdInspection(null);
    setUsdIssues([]);
    setUsdLights(null);
    setUsdLightsError(null);
    setUsdInspectorLoading(enabled);
    setUsdInspectorError(null);

    if (!enabled) {
      return;
    }

    let cancelled = false;

    const path = currentFile.path;

    const usdInspectorStartMs = performance.now();

    const timer = window.setTimeout(() => {
      const busyExhaustedMessage =
        "USD backend stayed busy; inspection is incomplete. Reopen the file to retry.";
      const summarizePromise = retryWhileBusy(
        () =>
          summarizeStage(
            path,
            usdLoadPolicy,
            { background: true },
            variantSelections,
          ),
        { shouldAbort: () => cancelled },
      )
        .then((summary) => {
          if (cancelled) return;
          if (summary === undefined) {
            setUsdInspectorError(busyExhaustedMessage);
            return;
          }
          setUsdSummary(summary);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setUsdInspectorError(
            errorMessage(error, "Failed to summarize USD stage."),
          );
        });

      const inspectPromise = retryWhileBusy(
        () =>
          inspectStage(
            path,
            usdLoadPolicy,
            { background: true },
            variantSelections,
          ),
        { shouldAbort: () => cancelled },
      )
        .then((inspection) => {
          if (cancelled) return;
          if (inspection === undefined) {
            setUsdInspectorError(
              (previous) => previous ?? busyExhaustedMessage,
            );
            return;
          }
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
          ? retryWhileBusy(
              () =>
                collectAssetIssues(
                  path,
                  { background: true },
                  variantSelections,
                ),
              { shouldAbort: () => cancelled },
            )
              .then((issues) => {
                if (cancelled) return;
                if (issues === undefined) {
                  setUsdInspectorError(
                    (previous) => previous ?? busyExhaustedMessage,
                  );
                  return;
                }
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
          ? retryWhileBusy(
              () =>
                inspectUsdLights(path, { background: true }, variantSelections),
              {
                shouldAbort: () => cancelled,
              },
            )
              .then((lights) => {
                if (cancelled) return;
                if (lights === undefined) {
                  setUsdLights(null);
                  setUsdLightsError(busyExhaustedMessage);
                  return;
                }
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
    }, USD_INSPECTOR_DEFER_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    currentFile,
    currentQueryKey,
    enabled,
    isTauri,
    usdLoadPolicy,
    variantSelections,
  ]);

  const hasCurrentInspection = usdInspectorStartedQueryKey === currentQueryKey;

  return {
    usdSummary: hasCurrentInspection ? usdSummary : null,
    usdInspection: hasCurrentInspection ? usdInspection : null,
    usdIssues: hasCurrentInspection ? usdIssues : [],
    usdLights: hasCurrentInspection ? usdLights : null,
    usdLightsError: hasCurrentInspection ? usdLightsError : null,
    usdInspectorLoading,
    usdInspectorError: hasCurrentInspection ? usdInspectorError : null,
  };
}
