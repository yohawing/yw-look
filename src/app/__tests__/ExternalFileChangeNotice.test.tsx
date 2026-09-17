import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExternalFileChangeNotice } from "../ExternalFileChangeNotice";
import { useFileStore } from "../../stores/fileStore";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  resolve: vi.fn(),
  evict: vi.fn(),
  handler: vi.fn<(event: { payload: unknown }) => void>(),
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name, handler) => {
    mocks.handler = handler;
    return mocks.unlisten;
  }),
}));
vi.mock("../../lib/files", () => ({ resolveSelectedFile: mocks.resolve }));
vi.mock("../../viewer/prefetchCache", () => ({ evictAll: mocks.evict }));
vi.mock("../../lib/i18n", () => ({
  t: (key: string) => key,
  useLocale: () => {},
}));

const file = {
  path: "C:/asset.glb",
  fileName: "asset.glb",
  parentDirectory: "C:/",
  extension: "glb",
  kind: "model" as const,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockResolvedValue(undefined);
  mocks.resolve.mockResolvedValue(file);
  useFileStore.setState({ currentFile: file, externalReload: null });
});
afterEach(cleanup);

async function changed(revision = 1, kind = "modified") {
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith(
      "start_file_watch",
      expect.anything(),
    ),
  );
  const watchId = mocks.invoke.mock.calls.find(
    ([command]) => command === "start_file_watch",
  )![1].watchId;
  act(() =>
    mocks.handler({ payload: { watchId, revision, kind, detail: null } }),
  );
}

it("keeps the preview on detection and Later, ignores duplicates, and shows a later save", async () => {
  render(<ExternalFileChangeNotice enabled />);
  await changed();
  expect(mocks.resolve).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("externalFile.later"));
  expect(screen.queryByRole("status")).toBeNull();
  await changed();
  expect(screen.queryByRole("status")).toBeNull();
  await changed(2);
  expect(screen.getByRole("status")).toBeTruthy();
  expect(useFileStore.getState().currentFile).toBe(file);
});

it("reloads only on click and keeps a newer change pending after success", async () => {
  render(<ExternalFileChangeNotice enabled />);
  await changed();
  fireEvent.click(screen.getByText("externalFile.reload"));
  await waitFor(() =>
    expect(useFileStore.getState().externalReload?.status).toBe("loading"),
  );
  expect(mocks.evict).toHaveBeenCalledOnce();
  await changed(2, "replaced");
  act(() => useFileStore.getState().finishExternalReload(1));
  expect(screen.getByText("externalFile.replaced")).toBeTruthy();
  fireEvent.click(screen.getByText("externalFile.reload"));
  await waitFor(() =>
    expect(useFileStore.getState().externalReload?.revision).toBe(2),
  );
  act(() => useFileStore.getState().finishExternalReload(2));
  expect(screen.queryByRole("status")).toBeNull();
});

it("keeps the current file on resolution failure and offers retry", async () => {
  mocks.resolve.mockRejectedValueOnce(new Error("Access denied"));
  render(<ExternalFileChangeNotice enabled />);
  await changed(1, "deleted");
  fireEvent.click(screen.getByText("externalFile.reload"));
  await screen.findByText("Access denied");
  expect(useFileStore.getState().currentFile).toBe(file);
  expect(useFileStore.getState().externalReload).toBeNull();
  fireEvent.click(screen.getByText("externalFile.reload"));
  await waitFor(() =>
    expect(useFileStore.getState().externalReload?.status).toBe("loading"),
  );
  act(() => useFileStore.getState().finishExternalReload(1, "Invalid GLB"));
  expect(screen.getByText("Invalid GLB")).toBeTruthy();
});

it("does not acknowledge a later save using the previous reload's success", async () => {
  render(<ExternalFileChangeNotice enabled />);
  await changed();
  fireEvent.click(screen.getByText("externalFile.reload"));
  await waitFor(() =>
    expect(useFileStore.getState().externalReload?.status).toBe("loading"),
  );
  act(() => useFileStore.getState().finishExternalReload(1));
  await changed(2);
  let resolve!: (value: typeof file) => void;
  mocks.resolve.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  fireEvent.click(screen.getByText("externalFile.reload"));
  expect(screen.getByRole("status")).toBeTruthy();
  await act(async () => resolve(file));
  act(() => useFileStore.getState().finishExternalReload(2, "Corrupt file"));
  expect(screen.getByText("Corrupt file")).toBeTruthy();
  expect(screen.getByText("externalFile.reload")).toBeTruthy();
});

it("ignores stale resolve completion after switching files and stops its watch", async () => {
  let finish!: (value: typeof file) => void;
  mocks.resolve.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<ExternalFileChangeNotice enabled />);
  await changed();
  fireEvent.click(screen.getByText("externalFile.reload"));
  const next = { ...file, path: "C:/next.fbx" };
  act(() => useFileStore.getState().setCurrentFile(next));
  await act(async () => finish(file));
  expect(useFileStore.getState().currentFile).toBe(next);
  expect(useFileStore.getState().externalReload).toBeNull();
  expect(mocks.invoke).toHaveBeenCalledWith(
    "stop_file_watch",
    expect.anything(),
  );
});
