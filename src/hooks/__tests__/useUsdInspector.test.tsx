import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectedFile } from "../../lib/files";
import type { VariantSelection } from "../../types/ipc";
import {
  collectAssetIssues,
  inspectStage,
  inspectUsdLights,
  summarizeStage,
} from "../../lib/usd";
import { useUsdInspector } from "../useUsdInspector";

vi.mock("../../config/viewerLimits", () => ({
  DEFERRED_PAYLOAD_PREVIEW_LIMITS: {
    startDelayMs: 1,
    yieldMs: 1,
    busyRetryMs: 1,
    maxBusyRetries: 2,
  },
}));

vi.mock("../../lib/usd", () => ({
  collectAssetIssues: vi.fn(),
  inspectStage: vi.fn(),
  inspectUsdLights: vi.fn(),
  isUsdTaskBusyError: vi.fn((error: unknown) =>
    error instanceof Error
      ? error.message === "USD_TASK_BUSY"
      : error === "USD_TASK_BUSY",
  ),
  summarizeStage: vi.fn(),
}));

const usdFile: SelectedFile = {
  path: "C:\\assets\\scene.usda",
  fileName: "scene.usda",
  extension: "usda",
  kind: "model",
  parentDirectory: "C:\\assets",
};

const summary = { path: usdFile.path, defaultPrim: "Root" };
const inspection = { path: usdFile.path, rootPrims: ["/Root"] };
const lights = [{ primPath: "/Root/Key" }];

function busyError() {
  return new Error("USD_TASK_BUSY");
}

function renderInspector(
  file: SelectedFile | null = usdFile,
  variantSelections: VariantSelection[] = [],
) {
  return renderHook(
    ({ currentFile, variantSelections: currentSelections }) =>
      useUsdInspector(currentFile, true, "loadAll", true, currentSelections),
    { initialProps: { currentFile: file, variantSelections } },
  );
}

async function advanceInspector(ms = 1_010) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useUsdInspector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.mocked(summarizeStage).mockResolvedValue(summary as never);
    vi.mocked(inspectStage).mockResolvedValue(inspection as never);
    vi.mocked(collectAssetIssues).mockResolvedValue([]);
    vi.mocked(inspectUsdLights).mockResolvedValue(lights as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("retries a busy inspector RPC and publishes the eventual result", async () => {
    vi.mocked(summarizeStage)
      .mockRejectedValueOnce(busyError())
      .mockResolvedValueOnce(summary as never);
    const { result } = renderInspector();

    await advanceInspector();

    expect(summarizeStage).toHaveBeenCalledTimes(2);
    expect(result.current.usdSummary).toEqual(summary);
    expect(result.current.usdInspectorError).toBeNull();
    expect(result.current.usdInspectorLoading).toBe(false);
  });

  it("passes the current variant selections to every enabled inspector query", async () => {
    const variantSelections: VariantSelection[] = [
      {
        primPath: "/World/Asset",
        setName: "modelingVariant",
        variantName: "high",
      },
    ];
    const { result } = renderInspector(usdFile, variantSelections);

    await advanceInspector();

    expect(summarizeStage).toHaveBeenCalledWith(
      usdFile.path,
      "loadAll",
      { background: true },
      variantSelections,
    );
    expect(inspectStage).toHaveBeenCalledWith(
      usdFile.path,
      "loadAll",
      { background: true },
      variantSelections,
    );
    expect(collectAssetIssues).toHaveBeenCalledWith(
      usdFile.path,
      { background: true },
      variantSelections,
    );
    expect(inspectUsdLights).toHaveBeenCalledWith(
      usdFile.path,
      { background: true },
      variantSelections,
    );
    expect(result.current.usdInspectorError).toBeNull();
  });

  it("hides the previous inspection snapshot immediately after a variant change", async () => {
    vi.mocked(collectAssetIssues).mockResolvedValueOnce([
      { code: "old-variant" },
    ] as never);
    vi.mocked(inspectUsdLights).mockResolvedValueOnce([
      { primPath: "/Root/OldLight" },
    ] as never);
    const { result, rerender } = renderInspector(usdFile, [
      {
        primPath: "/World/Asset",
        setName: "modelingVariant",
        variantName: "blue",
      },
    ]);

    await advanceInspector();
    expect(result.current.usdSummary).toEqual(summary);
    expect(result.current.usdInspection).toEqual(inspection);
    expect(result.current.usdIssues).toEqual([{ code: "old-variant" }]);
    expect(result.current.usdLights).toEqual([{ primPath: "/Root/OldLight" }]);

    rerender({
      currentFile: usdFile,
      variantSelections: [],
    });

    expect(result.current.usdSummary).toBeNull();
    expect(result.current.usdInspection).toBeNull();
    expect(result.current.usdIssues).toEqual([]);
    expect(result.current.usdLights).toBeNull();
    expect(result.current.usdLightsError).toBeNull();
    expect(result.current.usdInspectorError).toBeNull();
  });

  it("surfaces an error when busy retries are exhausted", async () => {
    vi.mocked(summarizeStage).mockRejectedValue(busyError());
    const { result } = renderInspector();

    await advanceInspector();

    expect(summarizeStage).toHaveBeenCalledTimes(3);
    expect(result.current.usdSummary).toBeNull();
    expect(result.current.usdInspectorError).toContain("stayed busy");
    expect(result.current.usdInspectorLoading).toBe(false);
  });

  it("does not publish results or errors after cancellation during busy retry", async () => {
    vi.mocked(summarizeStage).mockRejectedValue(busyError());
    const { result, rerender } = renderInspector();

    await advanceInspector(1_000);
    rerender({ currentFile: null, variantSelections: [] });
    await advanceInspector(10);

    expect(result.current.usdSummary).toBeNull();
    expect(result.current.usdInspectorError).toBeNull();
    expect(result.current.usdInspectorLoading).toBe(false);
  });

  it("suppresses all results and errors from four queries after a variant change", async () => {
    let resolveSummary!: (value: unknown) => void;
    let resolveInspection!: (value: unknown) => void;
    let rejectIssues!: (reason: unknown) => void;
    let resolveLights!: (value: unknown) => void;
    const oldSummary = new Promise((resolve) => {
      resolveSummary = resolve;
    });
    const oldInspection = new Promise((resolve) => {
      resolveInspection = resolve;
    });
    const oldIssues = new Promise((_, reject) => {
      rejectIssues = reject;
    });
    const oldLights = new Promise((resolve) => {
      resolveLights = resolve;
    });
    vi.mocked(summarizeStage).mockImplementationOnce(() => oldSummary as never);
    vi.mocked(inspectStage).mockImplementationOnce(
      () => oldInspection as never,
    );
    vi.mocked(collectAssetIssues).mockImplementationOnce(
      () => oldIssues as never,
    );
    vi.mocked(inspectUsdLights).mockImplementationOnce(
      () => oldLights as never,
    );

    const { result, rerender } = renderInspector(usdFile, []);
    await advanceInspector(1_000);

    rerender({
      currentFile: usdFile,
      variantSelections: [
        {
          primPath: "/World/Asset",
          setName: "modelingVariant",
          variantName: "high",
        },
      ],
    });
    await act(async () => {
      resolveSummary(summary);
      resolveInspection(inspection);
      rejectIssues(new Error("stale variant failure"));
      resolveLights(lights);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.usdSummary).toBeNull();
    expect(result.current.usdInspection).toBeNull();
    expect(result.current.usdIssues).toEqual([]);
    expect(result.current.usdLights).toBeNull();
    expect(result.current.usdLightsError).toBeNull();
    expect(result.current.usdInspectorError).toBeNull();
  });

  it("surfaces a non-busy rejection without retrying", async () => {
    vi.mocked(summarizeStage).mockRejectedValue(new Error("inspection broke"));
    const { result } = renderInspector();

    await advanceInspector();

    expect(summarizeStage).toHaveBeenCalledTimes(1);
    expect(result.current.usdInspectorError).toContain("inspection broke");
    expect(result.current.usdInspectorLoading).toBe(false);
  });
});
