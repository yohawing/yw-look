import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryListing, SelectedFile } from "../../lib/files";
import { useFileStore } from "../../stores/fileStore";
import { useViewerStore } from "../../stores/viewerStore";

const mocks = vi.hoisted(() => ({
  getStartupFile: vi.fn(),
  inspectAsset: vi.fn(),
  listSupportedSiblings: vi.fn(),
  openFileDialog: vi.fn(),
  registerBrowserFile: vi.fn(),
  resolveSelectedFile: vi.fn(),
  prefetchAdjacent: vi.fn(),
  createPackFileRequest: vi.fn(),
  listenHandler: undefined as
    | ((event: { payload: string }) => void)
    | undefined,
  dragDropHandler: undefined as
    | ((event: {
        payload:
          | { type: "enter" | "over" | "leave" }
          | { type: "drop"; paths: string[] };
      }) => void)
    | undefined,
  unlisten: vi.fn(),
  unlistenDragDrop: vi.fn(),
}));

vi.mock("../../lib/files", () => ({
  getStartupFile: mocks.getStartupFile,
  inspectAsset: mocks.inspectAsset,
  listSupportedSiblings: mocks.listSupportedSiblings,
  openFileDialog: mocks.openFileDialog,
  registerBrowserFile: mocks.registerBrowserFile,
  resolveSelectedFile: mocks.resolveSelectedFile,
}));

vi.mock("../../viewer", () => ({
  prefetchAdjacent: mocks.prefetchAdjacent,
}));

vi.mock("../../packs", () => ({
  createPackFileRequest: mocks.createPackFileRequest,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (
      _eventName: string,
      handler: (event: { payload: string }) => void,
    ) => {
      mocks.listenHandler = handler;
      return mocks.unlisten;
    },
  ),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    onDragDropEvent: vi.fn(
      async (
        handler: NonNullable<typeof mocks.dragDropHandler>,
      ): Promise<() => void> => {
        mocks.dragDropHandler = handler;
        return mocks.unlistenDragDrop;
      },
    ),
  })),
}));

import { useAppFileOpen } from "../useAppFileOpen";

function selected(path: string): SelectedFile {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  return {
    path,
    fileName,
    extension: fileName.split(".").pop()?.toLowerCase() ?? "",
    kind: "model",
    parentDirectory: "C:\\assets",
  };
}

function listingFor(file: SelectedFile): DirectoryListing {
  return { files: [file], currentIndex: 0 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderFileOpen(isTauri = false) {
  const recordLoadTiming = vi.fn();
  const setSessionGlbBuffer = vi.fn();
  const hook = renderHook(() =>
    useAppFileOpen({
      assetMetadata: null,
      currentFile: null,
      isTauri,
      recordLoadTiming,
      setSessionGlbBuffer,
      usdLoadPolicy: "loadAll",
    }),
  );
  return { ...hook, recordLoadTiming };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listenHandler = undefined;
  mocks.dragDropHandler = undefined;
  mocks.getStartupFile.mockResolvedValue(null);
  mocks.inspectAsset.mockResolvedValue(null);
  mocks.openFileDialog.mockResolvedValue(null);
  mocks.createPackFileRequest.mockReturnValue(null);
  useFileStore.setState({
    currentFile: null,
    packFileRequest: null,
    packMetadata: null,
    assetInspection: null,
    directoryListing: null,
    openError: "previous error",
    assetMetadata: null,
  });
  useViewerStore.setState({
    viewerFeedback: {
      mode: "empty",
      message: "empty",
      warning: null,
      canResetCamera: false,
    },
    selectedTextureId: null,
    viewerSurfaceMode: "asset",
  });
});

afterEach(() => {
  cleanup();
});

describe("useAppFileOpen", () => {
  it("opens a path and publishes loading feedback before committing the result", async () => {
    const path = "C:\\assets\\a.glb";
    const file = selected(path);
    const pendingFile = deferred<SelectedFile>();
    mocks.resolveSelectedFile.mockReturnValue(pendingFile.promise);
    mocks.listSupportedSiblings.mockResolvedValue(listingFor(file));
    const { result, recordLoadTiming } = renderFileOpen();

    let selection!: Promise<void>;
    act(() => {
      selection = result.current.performSelectFilePath(path);
    });

    expect(useFileStore.getState().openError).toBeNull();
    expect(useViewerStore.getState().viewerFeedback).toMatchObject({
      mode: "loading",
      message: `Resolving ${path}`,
    });
    expect(useFileStore.getState().currentFile).toBeNull();

    await act(async () => {
      pendingFile.resolve(file);
      await selection;
    });

    expect(useFileStore.getState().currentFile).toEqual(file);
    expect(useFileStore.getState().directoryListing).toEqual(listingFor(file));
    expect(mocks.prefetchAdjacent).toHaveBeenCalledWith([file], 0);
    expect(recordLoadTiming).toHaveBeenCalledWith(expect.any(Number), "open");
  });

  it("reports a resolve failure from the open-dialog flow without replacing the file", async () => {
    const previous = selected("C:\\assets\\previous.glb");
    const next = selected("C:\\assets\\broken.glb");
    useFileStore.setState({ currentFile: previous });
    mocks.openFileDialog.mockResolvedValue(next);
    mocks.resolveSelectedFile.mockRejectedValue(new Error("resolve exploded"));
    mocks.listSupportedSiblings.mockResolvedValue(listingFor(next));
    const { result } = renderFileOpen();

    await act(async () => {
      await result.current.handleOpenFile();
    });

    expect(useFileStore.getState().openError).toContain("resolve exploded");
    expect(useFileStore.getState().currentFile).toEqual(previous);
    expect(useViewerStore.getState().viewerFeedback.mode).toBe("loadFailed");
  });

  it("deduplicates repeated external opens while allowing a different path", async () => {
    const first = selected("C:\\assets\\a.glb");
    const second = selected("C:\\assets\\b.glb");
    mocks.resolveSelectedFile.mockImplementation(async (path: string) =>
      path === first.path ? first : second,
    );
    mocks.listSupportedSiblings.mockImplementation(async (path: string) =>
      listingFor(path === first.path ? first : second),
    );
    renderFileOpen(true);
    await waitFor(() => expect(mocks.listenHandler).toBeDefined());

    await act(async () => {
      mocks.listenHandler?.({ payload: first.path });
      mocks.listenHandler?.({ payload: first.path });
      mocks.listenHandler?.({ payload: second.path });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(mocks.resolveSelectedFile).toHaveBeenCalledTimes(2),
    );
    expect(mocks.resolveSelectedFile).toHaveBeenNthCalledWith(1, first.path);
    expect(mocks.resolveSelectedFile).toHaveBeenNthCalledWith(2, second.path);
  });

  it("opens the startup file on mount", async () => {
    const file = selected("C:\\assets\\startup.glb");
    mocks.getStartupFile.mockResolvedValue(file);
    mocks.resolveSelectedFile.mockResolvedValue(file);
    mocks.listSupportedSiblings.mockResolvedValue(listingFor(file));
    const { recordLoadTiming } = renderFileOpen();

    await waitFor(() =>
      expect(useFileStore.getState().currentFile).toEqual(file),
    );
    expect(recordLoadTiming).toHaveBeenCalledWith(
      expect.any(Number),
      "startup",
    );
  });

  it("opens the first file from a Tauri drop event", async () => {
    const file = selected("C:\\assets\\dropped.glb");
    mocks.resolveSelectedFile.mockResolvedValue(file);
    mocks.listSupportedSiblings.mockResolvedValue(listingFor(file));
    renderFileOpen(true);
    await waitFor(() => expect(mocks.dragDropHandler).toBeDefined());

    act(() => {
      mocks.dragDropHandler?.({
        payload: { type: "drop", paths: [file.path] },
      });
    });

    await waitFor(() =>
      expect(useFileStore.getState().currentFile).toEqual(file),
    );
  });

  it("drops results of superseded selections that resolve out of order", async () => {
    const first = selected("C:\\assets\\slow.glb");
    const second = selected("C:\\assets\\fast.glb");
    const firstResult = deferred<SelectedFile>();
    const secondResult = deferred<SelectedFile>();
    mocks.resolveSelectedFile.mockImplementation((path: string) =>
      path === first.path ? firstResult.promise : secondResult.promise,
    );
    mocks.listSupportedSiblings.mockImplementation(async (path: string) =>
      listingFor(path === first.path ? first : second),
    );
    const { result } = renderFileOpen();

    let firstSelection!: Promise<void>;
    let secondSelection!: Promise<void>;
    act(() => {
      firstSelection = result.current.performSelectFilePath(first.path);
      secondSelection = result.current.performSelectFilePath(second.path);
    });

    await act(async () => {
      secondResult.resolve(second);
      await secondSelection;
    });
    expect(useFileStore.getState().currentFile).toEqual(second);

    await act(async () => {
      firstResult.resolve(first);
      await firstSelection;
    });
    expect(useFileStore.getState().currentFile).toEqual(second);
    expect(useFileStore.getState().directoryListing).toEqual(
      listingFor(second),
    );
  });

  it("keeps the newest selection when overlapping requests resolve in order", async () => {
    const first = selected("C:\\assets\\first.glb");
    const second = selected("C:\\assets\\second.glb");
    const firstResult = deferred<SelectedFile>();
    const secondResult = deferred<SelectedFile>();
    mocks.resolveSelectedFile.mockImplementation((path: string) =>
      path === first.path ? firstResult.promise : secondResult.promise,
    );
    mocks.listSupportedSiblings.mockImplementation(async (path: string) =>
      listingFor(path === first.path ? first : second),
    );
    const { result } = renderFileOpen();

    let firstSelection!: Promise<void>;
    let secondSelection!: Promise<void>;
    act(() => {
      firstSelection = result.current.performSelectFilePath(first.path);
      secondSelection = result.current.performSelectFilePath(second.path);
    });

    await act(async () => {
      firstResult.resolve(first);
      await firstSelection;
      secondResult.resolve(second);
      await secondSelection;
    });

    expect(useFileStore.getState().currentFile).toEqual(second);
    expect(useFileStore.getState().directoryListing).toEqual(
      listingFor(second),
    );
  });
});
