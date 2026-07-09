import { useCallback, useEffect, useRef, useState } from "react";
import { DEFERRED_PAYLOAD_PREVIEW_LIMITS } from "../config/viewerLimits";
import { deferEffectStateUpdate } from "../lib/deferEffectStateUpdate";
import { errorMessage } from "../lib/errors";
import { isUsdFile, type SelectedFile } from "../lib/files";
import {
  backendCapabilities,
  closeStageSession,
  extractGeometry,
  extractGeometrySession,
  isUsdTaskBusyError,
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

function yieldDeferredPreviewFrame(
  delayMs: number = DEFERRED_PAYLOAD_PREVIEW_LIMITS.yieldMs,
): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
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

async function retryWhileBusy<T>(
  task: () => Promise<T>,
  options: {
    shouldAbort?: () => boolean;
    onBusyRetry?: () => void;
  } = {},
): Promise<T | undefined> {
  for (
    let attempt = 0;
    attempt <= DEFERRED_PAYLOAD_PREVIEW_LIMITS.maxBusyRetries;
    attempt += 1
  ) {
    try {
      return await task();
    } catch (error) {
      if (!isUsdTaskBusyError(error)) {
        throw error;
      }
      if (options.shouldAbort?.()) {
        return undefined;
      }
      options.onBusyRetry?.();
      await yieldDeferredPreviewFrame(
        DEFERRED_PAYLOAD_PREVIEW_LIMITS.busyRetryMs,
      );
    }
  }
  return undefined;
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
  const [sessionGlbBuffer, setSessionGlbBuffer] = useState<ArrayBuffer | null>(
    null,
  );
  const [deferredPayloadProgress, setDeferredPayloadProgress] =
    useState<DeferredTextureSnapshot | null>(null);

  const stageSessionHandleRef = useRef<StageSessionHandle | null>(
    stageSessionHandle,
  );
  const payloadSessionSupportedRef = useRef<boolean | null>(null);
  const deferredPreviewSessionRef = useRef<StageSessionHandle | null>(null);
  const sessionLoadedPayloadPathsRef = useRef<Set<string>>(new Set());
  const viewerWarningRef = useRef<string | null>(viewerWarning);
  useEffect(() => {
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

  const sessionGlbBufferRef = useRef<ArrayBuffer | null>(sessionGlbBuffer);
  useEffect(() => {
    sessionGlbBufferRef.current = sessionGlbBuffer;
  }, [sessionGlbBuffer]);

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
    if (!usdInspection || usdLoadPolicy !== "noPayloads") {
      return deferEffectStateUpdate(() => {
        setPayloadPrimPaths(new Set());
        setUnloadedPayloadPaths(new Set());
      });
    }
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
      setPayloadPrimPaths(allPayloads);
      setUnloadedPayloadPaths(unloaded);
    });
  }, [usdInspection, usdLoadPolicy]);

  const buildExtractOptions = useCallback(
    (policy: StageLoadPolicy) =>
      buildPayloadExtractOptions(policy, variantSelections, purposeModes),
    [variantSelections, purposeModes],
  );

  const buildSessionExtractOptions = useCallback(
    () => buildExtractOptions("noPayloads"),
    [buildExtractOptions],
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
      isAborted: AbortCheck = () => false,
    ) => {
      try {
        const glbBuffer = await extractGeometrySession(
          captured,
          buildSessionExtractOptions(),
        );
        if (
          isAborted() ||
          isSessionStale(stageSessionHandleRef.current, captured)
        ) {
          return;
        }
        setSessionGlbBuffer(glbBuffer);
      } catch (err: unknown) {
        if (
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
    [buildSessionExtractOptions, recordVariantSelectionError],
  );

  useEffect(() => {
    if (stageSessionHandle === null) {
      return deferEffectStateUpdate(() => {
        setSessionGlbBuffer(null);
      });
    }
    if (sessionGlbBufferRef.current === null) {
      return;
    }
    let cancelled = false;
    void refreshSessionGeometry(
      stageSessionHandle,
      "on variant change",
      () => cancelled,
    );
    return () => {
      cancelled = true;
    };
  }, [refreshSessionGeometry, stageSessionHandle]);

  const runPayloadMutation = useCallback(
    async (operation: PayloadOperation, primPath: string) => {
      const captured = stageSessionHandle;
      if (captured === null) return;
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
          if (isSessionStale(stageSessionHandleRef.current, captured)) return;
          reportPayloadOperationFailure(
            operation,
            primPath,
            payloadOperationBusyTimeout(operation, primPath),
          );
          return;
        }
        if (isSessionStale(stageSessionHandleRef.current, captured)) return;
        updatePayloadPathState(operation, primPath);
      } catch (err: unknown) {
        if (isSessionStale(stageSessionHandleRef.current, captured)) return;
        console.error(`[usd] ${operation}_payload failed:`, err);
        reportPayloadOperationFailure(operation, primPath, err);
        return;
      }
      await refreshSessionGeometry(captured, `after ${operation}`);
    },
    [
      stageSessionHandle,
      refreshSessionGeometry,
      reportPayloadOperationFailure,
      updatePayloadPathState,
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
    if (!usdInspection) return;

    let cancelled = false;

    const loadDeferredPreview = async () => {
      try {
        const previewPayloads = Array.from(
          new Set(
            usdInspection.payloads
              .filter((arc) => arc.state === "unloaded")
              .map((arc) => arc.sourcePrim),
          ),
        );
        if (previewPayloads.length === 0) return;

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
        if (
          isDeferredPreviewAborted(
            stageSessionHandleRef.current,
            captured,
            cancelled,
          )
        ) {
          return;
        }
        const glbBuffer = await retryWhileBusy(
          () =>
            extractGeometry(currentFile.path, buildExtractOptions("loadAll"), {
              background: true,
            }),
          {
            shouldAbort: () =>
              isDeferredPreviewAborted(
                stageSessionHandleRef.current,
                captured,
                cancelled,
              ),
            onBusyRetry: () => {
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
          if (
            !isDeferredPreviewAborted(
              stageSessionHandleRef.current,
              captured,
              cancelled,
            )
          ) {
            setDeferredPayloadProgress(null);
          }
          return;
        }
        if (
          isDeferredPreviewAborted(
            stageSessionHandleRef.current,
            captured,
            cancelled,
          )
        ) {
          return;
        }
        setSessionGlbBuffer(glbBuffer);
        deferredPreviewSessionRef.current = captured;
        setDeferredPayloadProgress(null);
        if (import.meta.env.DEV) {
          const meshCount = glbMeshCount(glbBuffer);
          console.info(
            `[usd] deferred preview full payload load ready (${previewPayloads.length} payloads, ${meshCount} meshes)`,
          );
        }
      } catch (err: unknown) {
        if (
          isDeferredPreviewAborted(
            stageSessionHandleRef.current,
            captured,
            cancelled,
          )
        ) {
          return;
        }
        console.warn("[usd] deferred preview payload load failed:", err);
        setDeferredPayloadProgress(null);
      }
    };

    void loadDeferredPreview();
    return () => {
      cancelled = true;
      setDeferredPayloadProgress(null);
    };
  }, [
    currentFile,
    stageSessionHandle,
    usdInspection,
    usdLoadPolicy,
    previewReadyForDeferredPayloads,
    buildExtractOptions,
  ]);

  return {
    stageSessionHandle,
    payloadPrimPaths,
    unloadedPayloadPaths,
    sessionGlbBuffer,
    setSessionGlbBuffer,
    deferredPayloadProgress,
    buildSessionExtractOptions,
    handleLoadPayload,
    handleUnloadPayload,
  };
}
