import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectedFile } from "../../lib/files";
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

function renderInspector(file: SelectedFile | null = usdFile) {
  return renderHook(
    ({ currentFile }) => useUsdInspector(currentFile, true, "loadAll", true),
    { initialProps: { currentFile: file } },
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
    rerender({ currentFile: null });
    await advanceInspector(10);

    expect(result.current.usdSummary).toBeNull();
    expect(result.current.usdInspectorError).toBeNull();
    expect(result.current.usdInspectorLoading).toBe(false);
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
