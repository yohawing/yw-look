import { useCallback, useEffect, useRef, useState } from "react";
import type { PerformanceSnapshot } from "../types/ui";
import type { SettingsPayload } from "../lib/settings";

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadline) => void,
    options?: IdleRequestOptions,
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const TIME_TO_INTERACTIVE_TIMEOUT_MS = 1500;

export function usePerformanceTracker(
  settingsPayload: SettingsPayload | null,
  settingsError: string | null,
) {
  // eslint-disable-next-line react-hooks/purity -- measuring mount time with a ref is the React-recommended pattern
  const appStartRef = useRef(performance.now());
  const [performanceSnapshot, setPerformanceSnapshot] =
    useState<PerformanceSnapshot>({
      startupMs: null,
      loadMs: null,
      navigationMs: null,
      firstPaintMs: null,
      interactiveMs: null,
    });

  useEffect(() => {
    setPerformanceSnapshot((previous) => ({
      ...previous,
      startupMs: performance.now() - appStartRef.current,
    }));

    const existingPaintMetric = performance
      .getEntriesByType("paint")
      .find((entry) => entry.name === "first-contentful-paint");
    if (existingPaintMetric) {
      setPerformanceSnapshot((previous) =>
        previous.firstPaintMs === null
          ? {
              ...previous,
              firstPaintMs: existingPaintMetric.startTime,
            }
          : previous,
      );
    }

    if (typeof PerformanceObserver === "undefined") {
      return;
    }

    const paintObserver = new PerformanceObserver((entryList) => {
      const firstPaint = entryList
        .getEntries()
        .find((entry) => entry.name === "first-contentful-paint");
      if (!firstPaint) {
        return;
      }

      setPerformanceSnapshot((previous) =>
        previous.firstPaintMs === null
          ? {
              ...previous,
              firstPaintMs: firstPaint.startTime,
            }
          : previous,
      );
      paintObserver.disconnect();
    });

    try {
      paintObserver.observe({ type: "paint", buffered: true });
    } catch {
      paintObserver.disconnect();
    }

    return () => {
      paintObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (performanceSnapshot.interactiveMs !== null) {
      return;
    }

    if (!settingsPayload && !settingsError) {
      return;
    }

    let cancelled = false;
    const markInteractive = () => {
      if (cancelled) {
        return;
      }

      setPerformanceSnapshot((previous) =>
        previous.interactiveMs === null
          ? {
              ...previous,
              interactiveMs: performance.now() - appStartRef.current,
            }
          : previous,
      );
    };

    const idleWindow = window as WindowWithIdleCallback;

    if (typeof idleWindow.requestIdleCallback === "function") {
      const callbackId = idleWindow.requestIdleCallback(markInteractive, {
        timeout: TIME_TO_INTERACTIVE_TIMEOUT_MS,
      });
      return () => {
        cancelled = true;
        idleWindow.cancelIdleCallback?.(callbackId);
      };
    }

    const timeoutId = window.setTimeout(markInteractive, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [performanceSnapshot.interactiveMs, settingsError, settingsPayload]);

  const recordLoadTiming = useCallback(
    (
      startedAt: number,
      reason: "open" | "startup" | "navigation" | "retry" | "recent",
    ) => {
      const elapsed = performance.now() - startedAt;
      setPerformanceSnapshot((previous) => ({
        ...previous,
        loadMs: elapsed,
        navigationMs: reason === "navigation" ? elapsed : previous.navigationMs,
      }));
    },
    [],
  );

  return { performanceSnapshot, recordLoadTiming };
}
