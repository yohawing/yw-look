import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadBenchManifest,
  measureMainThreadResponsiveness,
  renderReportMarkdown,
  responsivenessGapMs,
} from "../benchRuntime";
import type { BenchReport } from "../benchTypes";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

describe("loadBenchManifest", () => {
  it("reads the bench-configured manifest without passing a frontend path", async () => {
    invokeMock.mockResolvedValueOnce(
      JSON.stringify({ models: [{ id: "flight-helmet" }] }),
    );

    const manifest = await loadBenchManifest();

    expect(manifest.models).toEqual([{ id: "flight-helmet" }]);
    expect(invokeMock).toHaveBeenCalledWith("read_bench_manifest");
  });
});

describe("responsivenessGapMs", () => {
  it("returns zero when ticks arrive on schedule", () => {
    expect(responsivenessGapMs(0, 16, 16)).toBe(0);
  });

  it("returns excess delay beyond the expected interval", () => {
    expect(responsivenessGapMs(0, 48, 16)).toBe(32);
  });
});

describe("measureMainThreadResponsiveness", () => {
  it("records samples while a load operation is pending", async () => {
    const result = await measureMainThreadResponsiveness(
      () =>
        new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 50)),
    );

    expect(result.value).toBe("ok");
    expect(result.metrics.sampleCount).toBeGreaterThan(0);
    expect(result.metrics.maxGapMs).not.toBeNull();
    expect(result.metrics.maxGapMs).toBeGreaterThanOrEqual(0);
  });

  it("returns null max gap when the operation finishes before the first probe tick", async () => {
    const result = await measureMainThreadResponsiveness(async () => "fast");

    expect(result.value).toBe("fast");
    expect(result.metrics.sampleCount).toBe(0);
    expect(result.metrics.maxGapMs).toBeNull();
  });

  it("records a final gap when the operation blocks before the interval can run", async () => {
    const result = await measureMainThreadResponsiveness(async () => {
      const started = performance.now();
      while (performance.now() - started < 40) {
        // Simulate a synchronous loader block before the load promise resolves.
      }
      return "blocked";
    });

    expect(result.value).toBe("blocked");
    expect(result.metrics.sampleCount).toBeGreaterThan(0);
    expect(result.metrics.maxGapMs).not.toBeNull();
    expect(result.metrics.maxGapMs).toBeGreaterThan(0);
  });
});

describe("renderReportMarkdown", () => {
  it("includes load responsiveness columns", () => {
    const report: BenchReport = {
      schemaVersion: 1,
      generatedAt: "2026-07-07T00:00:00.000Z",
      mode: "dev",
      appVersion: "0.2.2",
      os: "windows",
      arch: "x86_64",
      nodeVersion: "22.0.0",
      modelsPath: "samples",
      repoRoot: "F:/Develop/yw-look",
      outDir: "artifacts/bench/test",
      caseIds: ["damaged-helmet"],
      summary: { total: 1, loaded: 1, nonBlank: 1, failed: 0 },
      cases: [
        {
          id: "damaged-helmet",
          name: "Damaged Helmet",
          path: "samples/damaged-helmet.glb",
          ext: "glb",
          license: "test",
          tags: [],
          shouldLoad: true,
          loaded: true,
          consoleErrors: 0,
          nonBlankCanvas: true,
          meshCount: 1,
          minMeshCount: 1,
          openPipelineMs: 150,
          resolveFileMs: 10,
          listSiblingsMs: 5,
          loadTimeMs: 140,
          loadResponsiveness: { sampleCount: 12, maxGapMs: 45.5 },
          stageTimeMs: { decode: 50, gpu: 80 },
          fps: 60,
          frameTimeMs: { avg: 16.5, p50: 16, p95: 18 },
          rendererInfo: null,
          performanceMemory: null,
          screenshot: null,
          error: null,
        },
      ],
    };

    const markdown = renderReportMarkdown(report);

    expect(markdown).toContain("Resp samples");
    expect(markdown).toContain("Resp max gap ms");
    expect(markdown).toContain("12");
    expect(markdown).toContain("45.5");
  });
});
