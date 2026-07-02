/* eslint-disable react-hooks/exhaustive-deps -- file-open effects preserve the original App.tsx listener lifetimes; useEffectEvent keeps event callbacks fresh. */
import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getStartupFile,
  inspectAsset,
  listSupportedSiblings,
  openFileDialog,
  registerBrowserFile,
  resolveSelectedFile,
  type SelectedFile,
} from "../lib/files";
import { prefetchAdjacent } from "../viewer";
import { useFileStore, type FileState } from "../stores/fileStore";
import { useUiStore } from "../stores/uiStore";
import { useViewerStore, type ViewerState } from "../stores/viewerStore";

const MMD_MODEL_EXTENSIONS = new Set(["pmx", "pmd"]);

function extensionFromPath(path: string) {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : "";
}

function selectedMotionFileFromPath(path: string): SelectedFile {
  const parts = path.split(/[\\/]/);
  const fileName = parts.pop() || path;
  const parentDirectory = parts.join("\\");
  return {
    path,
    fileName,
    extension: extensionFromPath(path),
    kind: "motion",
    parentDirectory,
  };
}

function canAttachMmdMotion(file: SelectedFile | null) {
  return file !== null && MMD_MODEL_EXTENSIONS.has(file.extension);
}

type OpenReason = "open" | "startup" | "navigation" | "retry" | "recent";

type UseAppFileOpenOptions = {
  assetMetadata: FileState["assetMetadata"];
  currentFile: FileState["currentFile"];
  isTauri: boolean;
  recordLoadTiming: (startedAt: number, reason: OpenReason) => void;
  setSessionGlbBuffer: (buffer: ArrayBuffer | null) => void;
  usdLoadPolicy: ViewerState["usdLoadPolicy"];
};

export function useAppFileOpen({
  assetMetadata,
  currentFile,
  isTauri,
  recordLoadTiming,
  setSessionGlbBuffer,
  usdLoadPolicy,
}: UseAppFileOpenOptions) {
  const mmdMotionRequest = useFileStore((state) => state.mmdMotionRequest);
  const setAssetInspection = useFileStore((state) => state.setAssetInspection);
  const setCurrentFile = useFileStore((state) => state.setCurrentFile);
  const setDirectoryListing = useFileStore(
    (state) => state.setDirectoryListing,
  );
  const setMmdMotionRequest = useFileStore(
    (state) => state.setMmdMotionRequest,
  );
  const setOpenError = useFileStore((state) => state.setOpenError);
  const setIsDragActive = useUiStore((state) => state.setIsDragActive);
  const selectedTextureId = useViewerStore((state) => state.selectedTextureId);
  const viewerSurfaceMode = useViewerStore((state) => state.viewerSurfaceMode);
  const recentExternalOpenRef = useRef<{
    path: string;
    requestedAt: number;
  } | null>(null);

  useEffect(() => {
    useViewerStore.getState().setMorphTargetValues({});
  }, [currentFile?.path]);

  useEffect(() => {
    const { setVariantSelectionError, setVariantSelections } =
      useViewerStore.getState();
    setVariantSelections([]);
    setVariantSelectionError(null);
    setSessionGlbBuffer(null);
  }, [currentFile, usdLoadPolicy, setSessionGlbBuffer]);

  useEffect(() => {
    // #33: a fresh file invalidates the prior viewport pick. The
    // selection refers to a Three.js Object3D.name, and the next
    // asset's hierarchy will not contain the same node.
    const { setActiveCameraId, setSelectedMeshName, setSelectedUsdPrimPath } =
      useViewerStore.getState();
    setSelectedMeshName(null);
    // #28: also clear the USD prim path selection so the property
    // panel does not query the new file with the old prim path.
    setSelectedUsdPrimPath(null);
    // #34: reset active camera to free orbit when a new file is opened so
    // the camera list in the new asset does not inherit a stale override.
    setActiveCameraId(null);
  }, [currentFile?.path]);

  useEffect(() => {
    if (!isTauri || !currentFile) {
      setAssetInspection(null);
      return;
    }

    let isActive = true;
    setAssetInspection(null);
    void inspectAsset(currentFile.path)
      .then((inspection) => {
        if (isActive) {
          setAssetInspection(inspection);
        }
      })
      .catch((error: unknown) => {
        console.warn("[file] inspect_asset failed:", error);
      });

    return () => {
      isActive = false;
    };
  }, [currentFile, isTauri, setAssetInspection]);

  useEffect(() => {
    if (!currentFile) {
      if (selectedTextureId !== null) {
        useViewerStore.getState().setSelectedTextureId(null);
      }
      if (viewerSurfaceMode !== "asset") {
        useViewerStore.getState().setViewerSurfaceMode("asset");
      }
      return;
    }

    const firstTextureId = assetMetadata?.textures[0]?.id ?? null;

    if (currentFile.kind === "texture") {
      if (selectedTextureId !== firstTextureId) {
        useViewerStore.getState().setSelectedTextureId(firstTextureId);
      }
      if (viewerSurfaceMode !== "texture") {
        useViewerStore.getState().setViewerSurfaceMode("texture");
      }
      return;
    }

    const hasSelectedTexture = assetMetadata?.textures.some(
      (texture) => texture.id === selectedTextureId,
    );

    if (!hasSelectedTexture && selectedTextureId !== firstTextureId) {
      useViewerStore.getState().setSelectedTextureId(firstTextureId);
    }

    if (!firstTextureId && viewerSurfaceMode === "texture") {
      useViewerStore.getState().setViewerSurfaceMode("asset");
    }
  }, [assetMetadata, currentFile, selectedTextureId, viewerSurfaceMode]);

  const performSelectFilePath = useCallback(
    async (path: string, reason: OpenReason = "open") => {
      const startedAt = performance.now();
      setOpenError(null);
      useViewerStore.getState().updateViewerFeedback({
        mode: "loading",
        message: `Resolving ${path}`,
        warning: null,
        canResetCamera: false,
      });

      const [resolvedFile, listing] = await Promise.all([
        resolveSelectedFile(path),
        listSupportedSiblings(path),
      ]);

      setCurrentFile(resolvedFile);
      setMmdMotionRequest(null);
      setDirectoryListing(listing);
      prefetchAdjacent(listing.files, listing.currentIndex);
      recordLoadTiming(startedAt, reason);
    },
    [
      recordLoadTiming,
      setCurrentFile,
      setDirectoryListing,
      setMmdMotionRequest,
      setOpenError,
    ],
  );

  const selectExternalFilePathFromEffect = useEffectEvent(
    async (path: string) => {
      const now = performance.now();
      const recent = recentExternalOpenRef.current;
      if (recent?.path === path && now - recent.requestedAt < 2000) {
        return;
      }

      recentExternalOpenRef.current = { path, requestedAt: now };
      await performSelectFilePath(path, "startup");
    },
  );

  const handleDroppedFilePathFromEffect = useEffectEvent(
    async (path: string) => {
      if (extensionFromPath(path) === "vmd") {
        if (!canAttachMmdMotion(currentFile)) {
          await performSelectFilePath(path, "open");
          return;
        }

        setMmdMotionRequest({
          file: selectedMotionFileFromPath(path),
          version: (mmdMotionRequest?.version ?? 0) + 1,
        });
        return;
      }

      await performSelectFilePath(path, "open");
    },
  );

  useEffect(() => {
    let isActive = true;

    getStartupFile()
      .then((startupFile) => {
        if (!isActive || !startupFile) {
          return;
        }

        return selectExternalFilePathFromEffect(startupFile.path);
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        setOpenError(
          error instanceof Error
            ? error.message
            : "Failed to resolve startup file.",
        );
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!isTauri) {
      return;
    }

    let isDisposed = false;
    let unlisten: UnlistenFn | undefined;

    listen<string>("yw-look://open-file", (event) => {
      const path = event.payload;
      if (!path) {
        return;
      }
      void selectExternalFilePathFromEffect(path);
    })
      .then((dispose) => {
        if (isDisposed) {
          dispose();
          return;
        }
        unlisten = dispose;

        // macOS can deliver the Opened event while the webview is still
        // mounting. The backend queues those paths; drain once after the
        // listener is live so Finder / extension-association opens are not
        // lost between the initial startup check and event subscription.
        void getStartupFile()
          .then((startupFile) => {
            if (!isDisposed && startupFile) {
              void selectExternalFilePathFromEffect(startupFile.path);
            }
          })
          .catch((error: unknown) => {
            if (isDisposed) {
              return;
            }
            setOpenError(
              error instanceof Error
                ? error.message
                : "Failed to resolve startup file.",
            );
          });
      })
      .catch(() => {
        // Tauri API unavailable (browser dev mode)
      });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) {
      const handleDragOver = (event: DragEvent) => {
        if (!event.dataTransfer?.types.includes("Files")) {
          return;
        }
        event.preventDefault();
        setIsDragActive(true);
      };

      const handleDragLeave = (event: DragEvent) => {
        if (event.relatedTarget === null) {
          setIsDragActive(false);
        }
      };

      const handleDrop = (event: DragEvent) => {
        if (!event.dataTransfer?.files.length) {
          return;
        }
        event.preventDefault();
        setIsDragActive(false);
        try {
          const selectedFile = registerBrowserFile(event.dataTransfer.files[0]);
          if (
            selectedFile.extension === "vmd" &&
            canAttachMmdMotion(currentFile)
          ) {
            setMmdMotionRequest({
              file: selectedFile,
              version: (mmdMotionRequest?.version ?? 0) + 1,
            });
            return;
          }
          void performSelectFilePath(selectedFile.path, "open");
        } catch (error: unknown) {
          setOpenError(
            error instanceof Error
              ? error.message
              : "Failed to open dropped file.",
          );
          useViewerStore.getState().updateViewerFeedback({
            mode: "loadFailed",
            message: "Dropped file could not be resolved.",
          });
        }
      };

      window.addEventListener("dragover", handleDragOver);
      window.addEventListener("dragleave", handleDragLeave);
      window.addEventListener("drop", handleDrop);
      return () => {
        window.removeEventListener("dragover", handleDragOver);
        window.removeEventListener("dragleave", handleDragLeave);
        window.removeEventListener("drop", handleDrop);
      };
    }

    let unlisten: (() => void) | undefined;

    try {
      getCurrentWindow()
        .onDragDropEvent((event) => {
          if (event.payload.type === "enter" || event.payload.type === "over") {
            setIsDragActive(true);
            return;
          }

          if (event.payload.type === "leave") {
            setIsDragActive(false);
            return;
          }

          setIsDragActive(false);
          const [firstPath] = event.payload.paths;

          if (!firstPath) {
            return;
          }

          handleDroppedFilePathFromEffect(firstPath).catch((error: unknown) => {
            setOpenError(
              error instanceof Error
                ? error.message
                : "Failed to open dropped file.",
            );
            useViewerStore.getState().updateViewerFeedback({
              mode: "loadFailed",
              message: "Dropped file could not be resolved.",
            });
          });
        })
        .then((dispose) => {
          unlisten = dispose;
        })
        .catch(() => {
          // Tauri API unavailable (browser dev mode)
        });
    } catch {
      // Tauri API unavailable (browser dev mode)
    }

    return () => {
      unlisten?.();
    };
  }, [
    currentFile,
    isTauri,
    mmdMotionRequest?.version,
    performSelectFilePath,
    setIsDragActive,
    setMmdMotionRequest,
    setOpenError,
  ]);

  const handleOpenFile = useCallback(async () => {
    try {
      const selectedFile = await openFileDialog();
      if (!selectedFile) return;
      await performSelectFilePath(selectedFile.path, "open");
    } catch (error: unknown) {
      setOpenError(
        error instanceof Error ? error.message : "Failed to open file dialog.",
      );
      useViewerStore.getState().updateViewerFeedback({
        mode: "loadFailed",
        message: "File dialog operation failed.",
      });
    }
  }, [performSelectFilePath, setOpenError]);

  return {
    handleOpenFile,
    performSelectFilePath,
  };
}
