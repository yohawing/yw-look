import { useCallback, useRef } from "react";
import type { AssetResourceMetrics } from "../lib/diagnostics";
import type { SceneContext } from "../types/viewer";
import {
  collectResourceDiagnosticsSnapshot,
  resourceDiagnosticsSignature,
} from "./resourceDiagnostics";
import { useSyncRef } from "./useSyncRef";

export function useResourceDiagnosticsPublisher(
  onResourceDiagnosticsChange:
    | ((
        snapshot: ReturnType<typeof collectResourceDiagnosticsSnapshot> | null,
      ) => void)
    | undefined,
) {
  const assetResourceMetricsRef = useRef<AssetResourceMetrics | null>(null);
  const lastResourceDiagnosticsRef = useRef<string | null>(null);
  const onResourceDiagnosticsChangeRef = useRef(onResourceDiagnosticsChange);

  useSyncRef(onResourceDiagnosticsChangeRef, onResourceDiagnosticsChange);

  const publishResourceDiagnostics = useCallback(
    (context: SceneContext | null) => {
      const callback = onResourceDiagnosticsChangeRef.current;
      if (!callback || !context) {
        return;
      }

      const snapshot = collectResourceDiagnosticsSnapshot(
        context.renderer,
        assetResourceMetricsRef.current,
      );
      const signature = resourceDiagnosticsSignature(snapshot);
      if (signature === lastResourceDiagnosticsRef.current) {
        return;
      }
      lastResourceDiagnosticsRef.current = signature;
      callback(snapshot);
    },
    [],
  );

  const clearResourceDiagnostics = useCallback(() => {
    assetResourceMetricsRef.current = null;
    lastResourceDiagnosticsRef.current = null;
    onResourceDiagnosticsChangeRef.current?.(null);
  }, []);

  return {
    assetResourceMetricsRef,
    clearResourceDiagnostics,
    publishResourceDiagnostics,
  };
}
