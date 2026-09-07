import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { DEFERRED_PAYLOAD_PREVIEW_LIMITS } from "../config/viewerLimits";
import { deferEffectStateUpdate } from "../lib/deferEffectStateUpdate";
import { errorMessage } from "../lib/errors";
import { isUsdFile, type SelectedFile } from "../lib/files";
import { retryWhileBusy, yieldDeferredPreviewFrame } from "../lib/usdBusyRetry";
import {
  backendCapabilities,
  closeStageSession,
  extractGeometry,
  extractGeometrySession,
  loadPayload,
  openStageSession,
  unloadPayload,
  type ExtractGeometryOptions,
  type PurposeModes,
  type StageInspection,
  type StageLoadPolicy,
  type StageSessionHandle,
  type VariantSelection,
} from "../lib/usd";
import type { ViewerFeedback } from "../types/viewer";
import type { DeferredTextureSnapshot } from "../viewer";

function glbMeshCount(buffer: ArrayBuffer): number {
  if (buffer.byteLength < 20) return 0;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) return 0;

  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + chunkLength > buffer.byteLength) return 0;
    if (chunkType === 0x4e4f534a) {
      try {
        const json = new TextDecoder().decode(
          new Uint8Array(buffer, offset, chunkLength),
        );
        const parsed = JSON.parse(json) as { meshes?: unknown[] };
        return Array.isArray(parsed.meshes) ? parsed.meshes.length : 0;
      } catch {
        return 0;
      }
    }
    offset += chunkLength;
  }
  return 0;
}

function payloadOperationWarning(
  operation: "load" | "unload",
  primPath: string,
  error: unknown,
) {
  const action = operation === "load" ? "load" : "unload";
  const detail = errorMessage(error, `Failed to ${action} USD payload.`);
  return `Could not ${action} payload: ${primPath} - ${detail}`;
}

function payloadOperationBusyTimeout(
  operation: "load" | "unload",
  primPath: string,
) {
  const action = operation === "load" ? "loading" : "unloading";
  return new Error(`USD task stayed busy while ${action} ${primPath}.`);
}

function appendViewerWarning(
  currentWarning: string | null,
  nextWarning: string,
) {
  const warnings = (currentWarning ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!warnings.includes(nextWarning)) {
    warnings.push(nextWarning);
  }
  return warnings.length > 0 ? warnings.join("\n") : null;
}

type PayloadOperation = "load" | "unload";
type AbortCheck = () => boolean;

type SessionRefreshInputs = {
  filePath: string | null;
  handle: StageSessionHandle;
  key: string;
  usdLoadPolicy: StageLoadPolicy;
};

type SessionGlbBufferInputs = {
  handle: StageSessionHandle | null;
  key: string;
};

type SessionGlbBufferState = {
  buffer: ArrayBuffer;
  inputs: SessionGlbBufferInputs;
};

const EMPTY_PAYLOAD_PATHS: ReadonlySet<string> = new Set();

type AppliedPayloadPathSnapshot = {
  filePath: string;
  handle: StageSessionHandle;
  inspection: StageInspection;
};

function buildSessionInputsKey(
  filePath: string | null,
  usdLoadPolicy: StageLoadPolicy,
  variantSelections: VariantSelection[],
  purposeModes: PurposeModes,
) {
  return JSON.stringify({
    filePath,
    usdLoadPolicy,
    variantSelections,
    purposeModes,
  });
}

function buildPayloadExtractOptions(
  policy: StageLoadPolicy,
  variantSelections: VariantSelection[],
  purposeModes: PurposeModes,
): ExtractGeometryOptions {
  return {
    policy,
    variantSelections,
    purposeModes,
  };
}

function isSessionStale(
  current: StageSessionHandle | null,
  captured: StageSessionHandle,
): boolean {
  return current !== captured;
}

function isDeferredPreviewAborted(
  current: StageSessionHandle | null,
  captured: StageSessionHandle,
  cancelled: boolean,
): boolean {
  return cancelled || isSessionStale(current, captured);
}

export function usePayloadSession(
  currentFile: SelectedFile | null,
  isTauri: boolean,
  usdLoadPolicy: StageLoadPolicy,
  usdInspection: StageInspection | null,
  variantSelections: VariantSelection[],
  purposeModes: PurposeModes,
  recordVariantSelectionError: (error: unknown) => boolean,
  viewerWarning: string | null,
  updateViewerFeedback: (partial: Partial<ViewerFeedback>) => void,
  previewReadyForDeferredPayloads: boolean,
) {
  const [stageSessionHandle, setStageSessionHandle] =
    useState<StageSessionHandle | null>(null);
  const [payloadPrimPaths, setPayloadPrimPaths] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [unloadedPayloadPaths, setUnloadedPayloadPaths] = useState<
    ReadonlySet<string>
  >(new Set());
  const [appliedPayloadPathSnapshot, setAppliedPayloadPathSnapshot] =
    useState<AppliedPayloadPathSnapshot | null>(null);
  const [sessionGlbBufferState, setSessionGlbBufferState] =
    useState<SessionGlbBufferState | null>(null);
  const [deferredPayloadProgress, setDeferredPayloadProgress] =
    useState<DeferredTextureSnapshot | null>(null);
  const currentFilePath = currentFile?.path ?? null;
  const sessionGlbBufferInputKey = buildSessionInputsKey(
    currentFilePath,
    usdLoadPolicy,
    variantSelections,
    purposeModes,
  );

  const stageSessionHandleRef = useRef<StageSessionHandle | null>(
    stageSessionHandle,
  );
  const payloadSessionSupportedRef = useRef<boolean | null>(null);
  const deferredPreviewSessionRef = useRef<StageSessionHandle | null>(null);
  const sessionRefreshInputsRef = useRef<SessionRefreshInputs | null>(null);
  const sessionRefreshRequestRef = useRef(0);
  const sessionLoadedPayloadPathsRef = useRef<Set<string>>(new Set());
  const currentSessionGlbBufferInputsRef = useRef<SessionGlbBufferInputs>({
    handle: stageSessionHandle,
    key: sessionGlbBufferInputKey,
  });
  useLayoutEffect(() => {
    currentSessionGlbBufferInputsRef.current = {
      handle: stageSessionHandle,
      key: sessionGlbBufferInputKey,
    };
  }, [sessionGlbBufferInputKey, stageSessionHandle]);
  const setSessionGlbBuffer = useCallback((buffer: ArrayBuffer | null) => {
    setSessionGlbBufferState(
      buffer
        ? { buffer, inputs: currentSessionGlbBufferInputsRef.current }
        : null,
    );
  }, []);
  const nextSessionRefreshRequest = useCallback(() => {
    sessionRefreshRequestRef.current += 1;
    return sessionRefreshRequestRef.current;
  }, []);
  const viewerWarningRef = useRef<string | null>(viewerWarning);
  useEffect(() => {
    sessionRefreshRequestRef.current += 1;
    stageSessionHandleRef.current = stageSessionHandle;
    deferredPreviewSessionRef.current = null;
    sessionLoadedPayloadPathsRef.current = new Set();

    return deferEffectStateUpdate(() => {
      setDeferredPayloadProgress(null);
    });
  }, [stageSessionHandle]);

  useEffect(() => {
    viewerWarningRef.current = viewerWarning;
  }, [viewerWarning]);

  const sessionGlbBufferRef = useRef<ArrayBuffer | null>(
    sessionGlbBufferState?.buffer ?? null,
  );
  useEffect(() => {
    sessionGlbBufferRef.current = sessionGlbBufferState?.buffer ?? null;
  }, [sessionGlbBufferState]);

  const currentSessionGlbBuffer =
    sessionGlbBufferState !== null &&
    sessionGlbBufferState.inputs.handle === stageSessionHandle &&
    sessionGlbBufferState.inputs.key === sessionGlbBufferInputKey
      ? sessionGlbBufferState.buffer
      : null;

  useEffect(() => {
    if (
      !isTauri ||
      !isUsdFile(currentFile) ||
      !currentFile ||
      !previewReadyForDeferredPayloads
    ) {
      return deferEffectStateUpdate(() => {
        setStageSessionHandle(null);
        setUnloadedPayloadPaths(new Set());
      });
    }

    if (usdLoadPolicy !== "noPayloads") {
      return deferEffectStateUpdate(() => {
        setStageSessionHandle(null);
        setUnloadedPayloadPaths(new Set());
      });
    }

    let cancelled = false;
    const path = currentFile.path;

    const openSession = async () => {
      if (payloadSessionSupportedRef.current === null) {
        const capabilities = await backendCapabilities();
        payloadSessionSupportedRef.current = capabilities.session;
      }
      if (!payloadSessionSupportedRef.current) {
        if (!cancelled) {
          setStageSessionHandle(null);
          setUnloadedPayloadPaths(new Set());
        }
        return;
      }
      return retryWhileBusy(
        () =>
          openStageSession(path, "noPayloads", {
            background: true,
          }),
        { shouldAbort: () => cancelled },
      );
    };

    openSession()
      .then((handle) => {
        if (handle === undefined) {
          return;
        }
        if (cancelled) {
          closeStageSession(handle).catch(() => {});
          return;
        }
        setStageSessionHandle(handle);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn(
          "[usd] open_stage_session failed (per-prim load/unload unavailable):",
          err,
        );
        setStageSessionHandle(null);
      });

    return () => {
      cancelled = true;
      setStageSessionHandle((prev) => {
        if (prev !== null) {
          void closeStageSession(prev).catch(() => {});
        }
        return null;
      });
    };
  }, [currentFile, isTauri, previewReadyForDeferredPayloads, usdLoadPolicy]);

  useEffect(() => {
    if (
      !usdInspection ||
      currentFilePath === null ||
      usdInspection.path !== currentFilePath ||
      usdLoadPolicy !== "noPayloads" ||
      stageSessionHandle === null
    ) {
      return deferEffectStateUpdate(() => {
        setAppliedPayloadPathSnapshot(null);
        setPayloadPrimPaths(new Set());
        setUnloadedPayloadPaths(new Set());
      });
    }
    const filePath = currentFilePath;
    const allPayloads = new Set(
      usdInspection.payloads.map((arc) => arc.sourcePrim),
    );
    const unloaded = new Set(
      usdInspection.payloads
        .filter((arc) => arc.state === "unloaded")
        .map((arc) => arc.sourcePrim),
    );
    for (const primPath of sessionLoadedPayloadPathsRef.current) {
      unloaded.delete(primPath);
    }
    return deferEffectStateUpdate(() => {
      setAppliedPayloadPathSnapshot({
        filePath,
        handle: stageSessionHandle,
        inspection: usdInspection,
      });
      setPayloadPrimPaths(allPayloads);
      setUnloadedPayloadPaths(unloaded);
    });
  }, [currentFilePath, stageSessionHandle, usdInspection, usdLoadPolicy]);

  const buildExtractOptions = useCallback(
    (policy: StageLoadPolicy) =>
      buildPayloadExtractOptions(policy, variantSelections, purposeModes),
    [variantSelections, purposeModes],
  );

  const sessionExtractOptionsRef = useRef<ExtractGeometryOptions>(
    buildPayloadExtractOptions("noPayloads", variantSelections, purposeModes),
  );
  useLayoutEffect(() => {
    sessionExtractOptionsRef.current = buildPayloadExtractOptions(
      "noPayloads",
      variantSelections,
      purposeModes,
    );
  }, [purposeModes, variantSelections]);

  const buildSessionExtractOptions = useCallback(
    () => sessionExtractOptionsRef.current,
    [],
  );

  const deferredPreviewPayloadsJson = JSON.stringify(
    Array.from(
      new Set(
        (usdInspection?.payloads ?? [])
          .filter((arc) => arc.state === "unloaded")
          .map((arc) => arc.sourcePrim),
      ),
    ),
  );

  const reportPayloadOperationFailure = useCallback(
    (operation: PayloadOperation, primPath: string, error: unknown) => {
      const warning = appendViewerWarning(
        viewerWarningRef.current,
        payloadOperationWarning(operation, primPath, error),
      );
      viewerWarningRef.current = warning;
      updateViewerFeedback({
        mode: "ready",
        message: "Preview ready with a payload warning.",
        warning,
      });
    },
    [updateViewerFeedback],
  );

  const updatePayloadPathState = useCallback(
    (operation: PayloadOperation, primPath: string) => {
      if (operation === "load") {
        sessionLoadedPayloadPathsRef.current.add(primPath);
      } else {
        sessionLoadedPayloadPathsRef.current.delete(primPath);
      }
      setUnloadedPayloadPaths((prev) => {
        const next = new Set(prev);
        if (operation === "load") {
          next.delete(primPath);
        } else {
          next.add(primPath);
        }
        return next;
      });
    },
    [],
  );

  const refreshSessionGeometry = useCallback(
    async (
      captured: StageSessionHandle,
      failureContext: string,
      requestId: number,
      expectedInputsKey: string,
      isAborted: AbortCheck = () => false,
    ) => {
      const isRequestStale = () =>
        requestId !== sessionRefreshRequestRef.current ||
        currentSessionGlbBufferInputsRef.current.handle !== captured ||
        currentSessionGlbBufferInputsRef.current.key !== expectedInputsKey;
      if (
        isRequestStale() ||
        isAborted() ||
        isSessionStale(stageSessionHandleRef.current, captured)
      ) {
        return;
      }
      try {
        const glbBuffer = await extractGeometrySession(
          captured,
          buildSessionExtractOptions(),
        );
        if (
          isRequestStale() ||
          isAborted() ||
          isSessionStale(stageSessionHandleRef.current, captured)
        ) {
          return;
        }
        setSessionGlbBuffer(glbBuffer);
      } catch (err: unknown) {
        if (
          isRequestStale() ||
          isAborted() ||
          isSessionStale(stageSessionHandleRef.current, captured)
        ) {
          return;
        }
        console.warn(`[usd] session re-extract ${failureContext} failed:`, err);
        recordVariantSelectionError(err);
        setSessionGlbBuffer(null);
      }
    },
    [
      buildSessionExtractOptions,
      recordVariantSelectionError,
      setSessionGlbBuffer,
    ],
  );

  useEffect(() => {
    if (stageSessionHandle === null) {
      sessionRefreshInputsRef.current = null;
      return deferEffectStateUpdate(() => {
        setSessionGlbBuffer(null);
      });
    }

    const previousInputs = sessionRefreshInputsRef.current;
    const filePath = currentFile?.path ?? null;
    const key = buildSessionInputsKey(
      filePath,
      usdLoadPolicy,
      variantSelections,
      purposeModes,
    );
    sessionRefreshInputsRef.current = {
      filePath,
      handle: stageSessionHandle,
      key,
      usdLoadPolicy,
    };
    const sessionOptionsChanged =
      previousInputs !== null &&
      previousInputs.handle === stageSessionHandle &&
      previousInputs.filePath === filePath &&
      previousInputs.usdLoadPolicy === usdLoadPolicy &&
      previousInputs.key !== key;
    if (!sessionOptionsChanged) {
      return;
    }
    const requestId = nextSessionRefreshRequest();
    if (sessionGlbBufferRef.current === null) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      void refreshSessionGeometry(
        stageSessionHandle,
        "on variant change",
        requestId,
        key,
        () => cancelled,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [
    purposeModes,
    refreshSessionGeometry,
    stageSessionHandle,
    variantSelections,
    currentFile?.path,
    usdLoadPolicy,
    nextSessionRefreshRequest,
    setSessionGlbBuffer,
  ]);

  const runPayloadMutation = useCallback(
    async (operation: PayloadOperation, primPath: string) => {
      const captured = stageSessionHandle;
      if (captured === null) return;
      const requestId = nextSessionRefreshRequest();
      setDeferredPayloadProgress(null);
      const mutatePayload = operation === "load" ? loadPayload : unloadPayload;
      try {
        const mutationCompleted = await retryWhileBusy(
          () => mutatePayload(captured, primPath).then(() => true),
          {
            shouldAbort: () =>
              isSessionStale(stageSessionHandleRef.current, captured),
          },
        );
        if (mutationCompleted === undefined) {
          if (
            requestId !== sessionRefreshRequestRef.current ||
            isSessionStale(stageSessionHandleRef.current, captured)
          ) {
            return;
          }
          reportPayloadOperationFailure(
            operation,
            primPath,
            payloadOperationBusyTimeout(operation, primPath),
          );
          return;
        }
        if (isSessionStale(stageSessionHandleRef.current, captured)) {
          return;
        }
        updatePayloadPathState(operation, primPath);
      } catch (err: unknown) {
        if (
          requestId !== sessionRefreshRequestRef.current ||
          isSessionStale(stageSessionHandleRef.current, captured)
        ) {
          return;
        }
        console.error(`[usd] ${operation}_payload failed:`, err);
        reportPayloadOperationFailure(operation, primPath, err);
        return;
      }
      const refreshRequestId = nextSessionRefreshRequest();
      const refreshInputsKey = currentSessionGlbBufferInputsRef.current.key;
      await refreshSessionGeometry(
        captured,
        `after ${operation}`,
        refreshRequestId,
        refreshInputsKey,
        () => refreshRequestId !== sessionRefreshRequestRef.current,
      );
    },
    [
      stageSessionHandle,
      refreshSessionGeometry,
      reportPayloadOperationFailure,
      updatePayloadPathState,
      nextSessionRefreshRequest,
    ],
  );

  const handleLoadPayload = useCallback(
    (primPath: string) => runPayloadMutation("load", primPath),
    [runPayloadMutation],
  );

  const handleUnloadPayload = useCallback(
    (primPath: string) => runPayloadMutation("unload", primPath),
    [runPayloadMutation],
  );

  useEffect(() => {
    const captured = stageSessionHandle;
    if (
      !currentFile ||
      usdLoadPolicy !== "noPayloads" ||
      captured === null ||
      !previewReadyForDeferredPayloads ||
      deferredPreviewSessionRef.current === captured
    ) {
      return;
    }
    const previewPayloads = JSON.parse(deferredPreviewPayloadsJson) as string[];
    if (previewPayloads.length === 0) return;

    if (sessionGlbBufferRef.current !== null) {
      return;
    }
    // Reserve before yielding or invoking the backend. Inspection refreshes
    // and viewport feedback updates must not enqueue duplicate full previews.
    deferredPreviewSessionRef.current = captured;
    const deferredPreviewRequestId = nextSessionRefreshRequest();

    let cancelled = false;
    const releaseDeferredPreviewReservation = () => {
      if (deferredPreviewSessionRef.current === captured) {
        deferredPreviewSessionRef.current = null;
      }
    };
    const cancelStaleDeferredPreview = () => {
      releaseDeferredPreviewReservation();
      setDeferredPayloadProgress(null);
    };
    const isDeferredPreviewRequestAborted = () =>
      isDeferredPreviewAborted(
        stageSessionHandleRef.current,
        captured,
        cancelled,
      ) || deferredPreviewRequestId !== sessionRefreshRequestRef.current;

    const loadDeferredPreview = async () => {
      try {
        setDeferredPayloadProgress({
          kind: "payload",
          total: previewPayloads.length,
          loaded: 0,
          failed: 0,
          pending: previewPayloads.length,
          activeLabel: "Loading full payload preview",
        });
        await yieldDeferredPreviewFrame(
          DEFERRED_PAYLOAD_PREVIEW_LIMITS.startDelayMs,
        );
        if (isDeferredPreviewRequestAborted()) {
          cancelStaleDeferredPreview();
          return;
        }
        const glbBuffer = await retryWhileBusy(
          () =>
            extractGeometry(currentFile.path, buildExtractOptions("loadAll"), {
              background: true,
            }),
          {
            shouldAbort: () => isDeferredPreviewRequestAborted(),
            onBusyRetry: () => {
              if (isDeferredPreviewRequestAborted()) return;
              setDeferredPayloadProgress({
                kind: "payload",
                total: previewPayloads.length,
                loaded: 0,
                failed: 0,
                pending: previewPayloads.length,
                activeLabel: "Waiting for USD task slot",
              });
            },
          },
        );
        if (glbBuffer === undefined) {
          releaseDeferredPreviewReservation();
          if (!isDeferredPreviewRequestAborted()) {
            setDeferredPayloadProgress(null);
          } else {
            cancelStaleDeferredPreview();
          }
          return;
        }
        if (isDeferredPreviewRequestAborted()) {
          cancelStaleDeferredPreview();
          return;
        }
        setSessionGlbBuffer(glbBuffer);
        setDeferredPayloadProgress(null);
        if (import.meta.env.DEV) {
          const meshCount = glbMeshCount(glbBuffer);
          console.info(
            `[usd] deferred preview full payload load ready (${previewPayloads.length} payloads, ${meshCount} meshes)`,
          );
        }
      } catch (err: unknown) {
        if (isDeferredPreviewRequestAborted()) {
          cancelStaleDeferredPreview();
          return;
        }
        console.warn("[usd] deferred preview payload load failed:", err);
        releaseDeferredPreviewReservation();
        setDeferredPayloadProgress(null);
      }
    };

    void loadDeferredPreview();
    return () => {
      cancelled = true;
      releaseDeferredPreviewReservation();
      setDeferredPayloadProgress(null);
    };
  }, [
    currentFile,
    stageSessionHandle,
    deferredPreviewPayloadsJson,
    usdLoadPolicy,
    previewReadyForDeferredPayloads,
    buildExtractOptions,
    nextSessionRefreshRequest,
    setSessionGlbBuffer,
  ]);

  const payloadSnapshotIsCurrent =
    isUsdFile(currentFile) &&
    currentFile !== null &&
    usdLoadPolicy === "noPayloads" &&
    usdInspection !== null &&
    stageSessionHandle !== null &&
    appliedPayloadPathSnapshot !== null &&
    appliedPayloadPathSnapshot.filePath === currentFile.path &&
    appliedPayloadPathSnapshot.handle === stageSessionHandle &&
    appliedPayloadPathSnapshot.inspection === usdInspection;
  return {
    stageSessionHandle,
    payloadPrimPaths: payloadSnapshotIsCurrent
      ? payloadPrimPaths
      : EMPTY_PAYLOAD_PATHS,
    unloadedPayloadPaths: payloadSnapshotIsCurrent
      ? unloadedPayloadPaths
      : EMPTY_PAYLOAD_PATHS,
    sessionGlbBuffer: currentSessionGlbBuffer,
    setSessionGlbBuffer,
    deferredPayloadProgress,
    buildSessionExtractOptions,
    handleLoadPayload,
    handleUnloadPayload,
  };
}
