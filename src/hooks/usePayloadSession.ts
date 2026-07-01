import { useCallback, useEffect, useRef, useState } from "react";
import { DEFERRED_PAYLOAD_PREVIEW_LIMITS } from "../config/viewerLimits";
import { isUsdFile, type SelectedFile } from "../lib/files";
import { errorMessage } from "../lib/invokeSafe";
import {
  backendCapabilities,
  closeStageSession,
  extractGeometry,
  extractGeometrySession,
  loadPayload,
  openStageSession,
  unloadPayload,
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

    setDeferredPayloadProgress(null);
  }, [stageSessionHandle]);

  useEffect(() => {
    viewerWarningRef.current = viewerWarning;
  }, [viewerWarning]);

  const sessionGlbBufferRef = useRef<ArrayBuffer | null>(sessionGlbBuffer);
  useEffect(() => {
    sessionGlbBufferRef.current = sessionGlbBuffer;
  }, [sessionGlbBuffer]);

  useEffect(() => {
    if (!isTauri || !isUsdFile(currentFile) || !currentFile) {
      setStageSessionHandle(null);
      setUnloadedPayloadPaths(new Set());
      return;
    }

    if (usdLoadPolicy !== "noPayloads") {
      setStageSessionHandle(null);
      setUnloadedPayloadPaths(new Set());
      return;
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
      return openStageSession(path, "noPayloads");
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
  }, [currentFile, isTauri, usdLoadPolicy]);

  useEffect(() => {
    if (stageSessionHandle === null) {
      setSessionGlbBuffer(null);
      return;
    }
    if (sessionGlbBufferRef.current === null) {
      return;
    }
    let cancelled = false;
    extractGeometrySession(stageSessionHandle, {
      policy: "noPayloads",
      variantSelections,
      purposeModes,
    })
      .then((buf) => {
        if (!cancelled) setSessionGlbBuffer(buf);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.warn("[usd] session re-extract on variant change failed:", err);
        recordVariantSelectionError(err);
        setSessionGlbBuffer(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantSelections, stageSessionHandle]);

  useEffect(() => {
    if (!usdInspection || usdLoadPolicy !== "noPayloads") {
      setPayloadPrimPaths(new Set());
      setUnloadedPayloadPaths(new Set());
      return;
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
    setPayloadPrimPaths(allPayloads);
    setUnloadedPayloadPaths(unloaded);
  }, [usdInspection, usdLoadPolicy]);

  const buildSessionExtractOptions = useCallback(
    () => ({
      policy: "noPayloads" as const,
      variantSelections,
      purposeModes,
    }),
    [variantSelections, purposeModes],
  );

  const reportPayloadOperationFailure = useCallback(
    (operation: "load" | "unload", primPath: string, error: unknown) => {
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

  const handleLoadPayload = useCallback(
    async (primPath: string) => {
      const captured = stageSessionHandle;
      if (captured === null) return;
      try {
        await loadPayload(captured, primPath);
        if (stageSessionHandleRef.current !== captured) return;
        sessionLoadedPayloadPathsRef.current.add(primPath);
        setUnloadedPayloadPaths((prev) => {
          const next = new Set(prev);
          next.delete(primPath);
          return next;
        });
      } catch (err: unknown) {
        if (stageSessionHandleRef.current !== captured) return;
        console.error("[usd] load_payload failed:", err);
        reportPayloadOperationFailure("load", primPath, err);
        return;
      }
      try {
        const glbBuffer = await extractGeometrySession(
          captured,
          buildSessionExtractOptions(),
        );
        if (stageSessionHandleRef.current !== captured) return;
        setSessionGlbBuffer(glbBuffer);
      } catch (err: unknown) {
        if (stageSessionHandleRef.current !== captured) return;
        console.warn("[usd] session re-extract after load failed:", err);
        recordVariantSelectionError(err);
        setSessionGlbBuffer(null);
      }
    },
    [
      stageSessionHandle,
      buildSessionExtractOptions,
      recordVariantSelectionError,
      reportPayloadOperationFailure,
    ],
  );

  const handleUnloadPayload = useCallback(
    async (primPath: string) => {
      const captured = stageSessionHandle;
      if (captured === null) return;
      try {
        await unloadPayload(captured, primPath);
        if (stageSessionHandleRef.current !== captured) return;
        sessionLoadedPayloadPathsRef.current.delete(primPath);
        setUnloadedPayloadPaths((prev) => {
          const next = new Set(prev);
          next.add(primPath);
          return next;
        });
      } catch (err: unknown) {
        if (stageSessionHandleRef.current !== captured) return;
        console.error("[usd] unload_payload failed:", err);
        reportPayloadOperationFailure("unload", primPath, err);
        return;
      }
      try {
        const glbBuffer = await extractGeometrySession(
          captured,
          buildSessionExtractOptions(),
        );
        if (stageSessionHandleRef.current !== captured) return;
        setSessionGlbBuffer(glbBuffer);
      } catch (err: unknown) {
        if (stageSessionHandleRef.current !== captured) return;
        console.warn("[usd] session re-extract after unload failed:", err);
        recordVariantSelectionError(err);
        setSessionGlbBuffer(null);
      }
    },
    [
      stageSessionHandle,
      buildSessionExtractOptions,
      recordVariantSelectionError,
      reportPayloadOperationFailure,
    ],
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
        if (cancelled || stageSessionHandleRef.current !== captured) {
          return;
        }
        const glbBuffer = await extractGeometry(currentFile.path, {
          policy: "loadAll",
          variantSelections,
          purposeModes,
        });
        if (cancelled || stageSessionHandleRef.current !== captured) {
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
        if (cancelled || stageSessionHandleRef.current !== captured) return;
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
    purposeModes,
    variantSelections,
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
