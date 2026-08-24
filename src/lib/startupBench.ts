import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";

export type StartupBenchConfig = {
  enabled: boolean;
  outDir: string;
  appVersion: string;
  os: string;
  arch: string;
  processId: number | null;
  mode: string;
  packaged: boolean;
  nodeVersion: string | null;
};

export type StartupBenchBrowserMetrics = {
  performanceNowMs: number;
  domContentLoadedEventEnd: number | null;
  loadEventEnd: number | null;
  responseEnd: number | null;
  domInteractive: number | null;
  firstPaintMs: number | null;
  firstContentfulPaintMs: number | null;
  paintEntries: Array<{ name: string; startTimeMs: number }>;
};

export type StartupBenchAppResult = {
  appVersion: string;
  os: string;
  arch: string;
  processId: number | null;
  mode: string;
  packaged: boolean;
  nodeVersion: string | null;
  performanceNowMs: number;
  browserMetrics: StartupBenchBrowserMetrics;
  finishedAt: string;
};

export async function loadStartupBenchConfig() {
  return invoke<StartupBenchConfig | null>("get_startup_bench_config");
}

function collectBrowserMetrics(): StartupBenchBrowserMetrics {
  const navigation = performance.getEntriesByType("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  const paints = performance.getEntriesByType("paint");
  const firstPaint = paints.find((entry) => entry.name === "first-paint");
  const firstContentfulPaint = paints.find(
    (entry) => entry.name === "first-contentful-paint",
  );

  return {
    performanceNowMs: performance.now(),
    domContentLoadedEventEnd: navigation?.domContentLoadedEventEnd ?? null,
    loadEventEnd: navigation?.loadEventEnd ?? null,
    responseEnd: navigation?.responseEnd ?? null,
    domInteractive: navigation?.domInteractive ?? null,
    firstPaintMs: firstPaint?.startTime ?? null,
    firstContentfulPaintMs: firstContentfulPaint?.startTime ?? null,
    paintEntries: paints.map((entry) => ({
      name: entry.name,
      startTimeMs: entry.startTime,
    })),
  };
}

function waitForAppShell() {
  return new Promise<void>((resolve) => {
    const check = () => {
      if (document.querySelector(".app-shell")) {
        resolve();
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

function waitTwoAnimationFrames() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

export function useStartupBench(isTauri: boolean) {
  useEffect(() => {
    if (!isTauri) {
      return;
    }

    let active = true;

    void (async () => {
      const config = await loadStartupBenchConfig();
      if (!active || !config?.enabled) {
        return;
      }

      await waitForAppShell();
      if (!active) {
        return;
      }
      await waitTwoAnimationFrames();
      if (!active) {
        return;
      }

      const result: StartupBenchAppResult = {
        appVersion: config.appVersion,
        os: config.os,
        arch: config.arch,
        processId: config.processId,
        mode: config.mode,
        packaged: config.packaged,
        nodeVersion: config.nodeVersion,
        performanceNowMs: performance.now(),
        browserMetrics: collectBrowserMetrics(),
        finishedAt: new Date().toISOString(),
      };

      await invoke("finish_startup_bench", { result });
    })();

    return () => {
      active = false;
    };
  }, [isTauri]);
}
