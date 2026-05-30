import { useCallback, useEffect, useRef, useState } from "react";
import { isUsdFile, type SelectedFile } from "../lib/files";
import {
  closeStageSession,
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

export function usePayloadSession(
  currentFile: SelectedFile | null,
  isTauri: boolean,
  usdLoadPolicy: StageLoadPolicy,
  usdInspection: StageInspection | null,
  variantSelections: VariantSelection[],
  purposeModes: PurposeModes,
  recordVariantSelectionError: (error: unknown) => boolean,
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

  const stageSessionHandleRef = useRef<StageSessionHandle | null>(
    stageSessionHandle,
  );
  useEffect(() => {
    stageSessionHandleRef.current = stageSessionHandle;
  }, [stageSessionHandle]);

  const sessionGlbBufferRef = useRef<ArrayBuffer | null>(sessionGlbBuffer);
  useEffect(() => {
    sessionGlbBufferRef.current = sessionGlbBuffer;
  }, [sessionGlbBuffer]);

  useEffect(() => {
    if (!isTauri || !isUsdFile(currentFile) || !currentFile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset session handle and unloaded paths when file is not a USD file or Tauri is unavailable; session handle comes from a cancellable RPC and cannot be derived during render
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

    openStageSession(path, "noPayloads")
      .then((handle) => {
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset session GLB buffer when the stage session handle is cleared; buffer is derived from a cancellable RPC and cannot be derived during render
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset payload prim paths and unloaded paths when inspection is absent or load policy changed; values come from USD inspection data and cannot be derived during render
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

  const handleLoadPayload = useCallback(
    async (primPath: string) => {
      const captured = stageSessionHandle;
      if (captured === null) return;
      try {
        await loadPayload(captured, primPath);
        if (stageSessionHandleRef.current !== captured) return;
        setUnloadedPayloadPaths((prev) => {
          const next = new Set(prev);
          next.delete(primPath);
          return next;
        });
      } catch (err: unknown) {
        console.error("[usd] load_payload failed:", err);
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
    ],
  );

  const handleUnloadPayload = useCallback(
    async (primPath: string) => {
      const captured = stageSessionHandle;
      if (captured === null) return;
      try {
        await unloadPayload(captured, primPath);
        if (stageSessionHandleRef.current !== captured) return;
        setUnloadedPayloadPaths((prev) => {
          const next = new Set(prev);
          next.add(primPath);
          return next;
        });
      } catch (err: unknown) {
        console.error("[usd] unload_payload failed:", err);
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
    ],
  );

  return {
    stageSessionHandle,
    payloadPrimPaths,
    unloadedPayloadPaths,
    sessionGlbBuffer,
    setSessionGlbBuffer,
    buildSessionExtractOptions,
    handleLoadPayload,
    handleUnloadPayload,
  };
}
