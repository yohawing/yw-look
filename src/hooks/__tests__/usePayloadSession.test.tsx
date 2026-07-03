import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectedFile } from "../../types/file";
import type {
  BackendCapabilities,
  PurposeModes,
  StageInspection,
  VariantSelection,
} from "../../types/ipc";
import {
  backendCapabilities,
  closeStageSession,
  extractGeometry,
  extractGeometrySession,
  loadPayload,
  openStageSession,
  unloadPayload,
} from "../../lib/usd";
import { usePayloadSession } from "../usePayloadSession";

vi.mock("../../config/viewerLimits", () => ({
  DEFERRED_PAYLOAD_PREVIEW_LIMITS: {
    startDelayMs: 1,
    yieldMs: 1,
    busyRetryMs: 1,
    maxBusyRetries: 2,
  },
}));

vi.mock("../../lib/usd", () => ({
  backendCapabilities: vi.fn(),
  closeStageSession: vi.fn(),
  extractGeometry: vi.fn(),
  extractGeometrySession: vi.fn(),
  isUsdTaskBusyError: vi.fn((error: unknown) => {
    if (error instanceof Error) return error.message === "USD_TASK_BUSY";
    return error === "USD_TASK_BUSY";
  }),
  loadPayload: vi.fn(),
  openStageSession: vi.fn(),
  unloadPayload: vi.fn(),
}));

const capabilities: BackendCapabilities = {
  inspect: true,
  geometry: true,
  source: true,
  session: true,
  light: true,
};

const file: SelectedFile = {
  path: "samples/assets/usd/tiny_payload.usda",
  fileName: "tiny_payload.usda",
  extension: "usda",
  kind: "model",
  parentDirectory: "samples/assets/usd",
};

const purposeModes: PurposeModes = {
  render: true,
  proxy: false,
  guide: false,
};

const variantSelections: VariantSelection[] = [];

const inspection: StageInspection = {
  path: file.path,
  defaultPrim: "Root",
  upAxis: "Y",
  metersPerUnit: 0.01,
  timeCodesPerSecond: null,
  framesPerSecond: null,
  startTimeCode: null,
  endTimeCode: null,
  comment: null,
  rootLayerIsBinary: false,
  rootPrims: ["/Root"],
  composedLayers: [file.path],
  references: [],
  payloads: [
    {
      sourcePrim: "/Root/PayloadRoot",
      assetPath: "./tiny.usda",
      targetPrim: "/Root",
      state: "unloaded",
      kind: "payload",
    },
  ],
  missingAssets: [],
  variantSets: [],
  loadPolicy: "noPayloads",
};

function busyError() {
  return new Error("USD_TASK_BUSY");
}

function buffer(byteLength: number) {
  return new ArrayBuffer(byteLength);
}

function renderPayloadSession() {
  const recordVariantSelectionError = vi.fn(() => false);
  const updateViewerFeedback = vi.fn();
  const result = renderHook(() =>
    usePayloadSession(
      file,
      true,
      "noPayloads",
      inspection,
      variantSelections,
      purposeModes,
      recordVariantSelectionError,
      null,
      updateViewerFeedback,
      true,
    ),
  );
  return { ...result, recordVariantSelectionError, updateViewerFeedback };
}

describe("usePayloadSession", () => {
  beforeEach(() => {
    vi.mocked(backendCapabilities).mockResolvedValue(capabilities);
    vi.mocked(closeStageSession).mockResolvedValue();
    vi.mocked(extractGeometry).mockResolvedValue(buffer(96));
    vi.mocked(extractGeometrySession).mockResolvedValue(buffer(64));
    vi.mocked(loadPayload).mockResolvedValue();
    vi.mocked(openStageSession).mockResolvedValue(42);
    vi.mocked(unloadPayload).mockResolvedValue();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("retries busy stage opens through the shared retry helper", async () => {
    vi.mocked(openStageSession)
      .mockRejectedValueOnce(busyError())
      .mockResolvedValueOnce(42);

    const { result, unmount } = renderPayloadSession();

    await waitFor(() => {
      expect(result.current.stageSessionHandle).toBe(42);
    });
    expect(openStageSession).toHaveBeenCalledTimes(2);

    unmount();
  });

  it("retries busy payload loads, updates path state, and re-extracts the session", async () => {
    const glbBuffer = buffer(128);
    vi.mocked(loadPayload)
      .mockRejectedValueOnce(busyError())
      .mockResolvedValueOnce();
    vi.mocked(extractGeometrySession).mockResolvedValue(glbBuffer);

    const { result, unmount } = renderPayloadSession();

    await waitFor(() => {
      expect(result.current.stageSessionHandle).toBe(42);
    });
    expect(result.current.unloadedPayloadPaths.has("/Root/PayloadRoot")).toBe(
      true,
    );

    await act(async () => {
      await result.current.handleLoadPayload("/Root/PayloadRoot");
    });

    expect(loadPayload).toHaveBeenCalledTimes(2);
    expect(extractGeometrySession).toHaveBeenCalledWith(42, {
      policy: "noPayloads",
      variantSelections: [],
      purposeModes,
    });
    expect(result.current.unloadedPayloadPaths.has("/Root/PayloadRoot")).toBe(
      false,
    );
    expect(result.current.sessionGlbBuffer).toBe(glbBuffer);

    unmount();
  });

  it("retries busy deferred previews and clears progress when full payload geometry is ready", async () => {
    const fullPreviewBuffer = buffer(256);
    vi.mocked(extractGeometry)
      .mockRejectedValueOnce(busyError())
      .mockResolvedValueOnce(fullPreviewBuffer);

    const { result, unmount } = renderPayloadSession();

    await waitFor(() => {
      expect(result.current.stageSessionHandle).toBe(42);
    });

    await waitFor(() => {
      expect(result.current.sessionGlbBuffer).toBe(fullPreviewBuffer);
    });
    expect(extractGeometry).toHaveBeenCalledTimes(2);
    expect(result.current.deferredPayloadProgress).toBeNull();

    unmount();
  });
});
