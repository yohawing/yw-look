/**
 * Unit tests for src/viewer/prefetchCache.ts.
 *
 * `prefetchAdjacent` is the navigation helper that pre-loads the files
 * adjacent to the current position in a directory listing. We test it
 * in isolation by mocking the `readBinaryFile` Tauri call that backs the
 * internal `fetchAndCache` function, and by inspecting `getCachedBuffer`.
 *
 * Navigation boundary conditions (first file, last file, single-file
 * directory, null index) are covered without any WebGL or Tauri dependency.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  prefetchAdjacent,
  getCachedBuffer,
  evictAll,
} from "../prefetchCache";
import type { SelectedFile } from "../../lib/files";

const mockInvoke = vi.mocked(invoke);

/** Creates a minimal SelectedFile for testing */
function makeFile(name: string): SelectedFile {
  return {
    path: `/models/${name}`,
    fileName: name,
    extension: name.split(".").pop() ?? "glb",
    kind: "model",
    parentDirectory: "/models",
  };
}

/** Creates a small ArrayBuffer-like byte array for mock readBinaryFile */
function makeFakeBytes(size = 8): number[] {
  return Array.from({ length: size }, (_, i) => i);
}

beforeEach(() => {
  evictAll();
  vi.clearAllMocks();
});

describe("prefetchAdjacent – boundary conditions", () => {
  it("does nothing when currentIndex is null", () => {
    const files = [makeFile("a.glb"), makeFile("b.glb")];
    prefetchAdjacent(files, null);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("does nothing when the files list is empty", () => {
    prefetchAdjacent([], 0);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("does not prefetch prev when at the first file", async () => {
    const files = [makeFile("a.glb"), makeFile("b.glb"), makeFile("c.glb")];
    mockInvoke.mockResolvedValue(makeFakeBytes());

    prefetchAdjacent(files, 0);

    // Give the microtask queue a tick to start async work
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());

    // Only the next file (index 1) should have been fetched
    const calls = mockInvoke.mock.calls;
    const fetchedPaths = calls
      .filter(([cmd]) => cmd === "read_binary_file")
      .map(([, args]) => (args as { path: string }).path);

    expect(fetchedPaths).toContain(files[1].path);
    expect(fetchedPaths).not.toContain(files[0].path);
  });

  it("does not prefetch next when at the last file", async () => {
    const files = [makeFile("a.glb"), makeFile("b.glb"), makeFile("c.glb")];
    mockInvoke.mockResolvedValue(makeFakeBytes());

    prefetchAdjacent(files, 2);

    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());

    const calls = mockInvoke.mock.calls;
    const fetchedPaths = calls
      .filter(([cmd]) => cmd === "read_binary_file")
      .map(([, args]) => (args as { path: string }).path);

    expect(fetchedPaths).toContain(files[1].path);
    expect(fetchedPaths).not.toContain(files[2].path);
  });

  it("prefetches both prev and next for a middle index", async () => {
    const files = [makeFile("a.glb"), makeFile("b.glb"), makeFile("c.glb")];
    mockInvoke.mockResolvedValue(makeFakeBytes());

    prefetchAdjacent(files, 1);

    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2));

    const calls = mockInvoke.mock.calls;
    const fetchedPaths = calls
      .filter(([cmd]) => cmd === "read_binary_file")
      .map(([, args]) => (args as { path: string }).path);

    expect(fetchedPaths).toContain(files[0].path);
    expect(fetchedPaths).toContain(files[2].path);
  });

  it("does nothing for a single-file directory", () => {
    const files = [makeFile("a.glb")];
    prefetchAdjacent(files, 0);
    // No adjacent files exist — no fetch should be triggered
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("getCachedBuffer", () => {
  it("returns null when a path has not been prefetched", () => {
    expect(getCachedBuffer("/models/notfetched.glb")).toBeNull();
  });

  it("returns the buffer after a successful prefetch", async () => {
    const files = [makeFile("first.glb"), makeFile("second.glb")];
    const bytes = makeFakeBytes(16);
    mockInvoke.mockResolvedValue(bytes);

    prefetchAdjacent(files, 0);

    // Wait until the cache is populated
    await vi.waitFor(() => {
      expect(getCachedBuffer(files[1].path)).not.toBeNull();
    });

    const buf = getCachedBuffer(files[1].path);
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(buf!.byteLength).toBe(bytes.length);
  });
});

describe("evictAll", () => {
  it("clears all cached entries", async () => {
    const files = [makeFile("x.glb"), makeFile("y.glb")];
    mockInvoke.mockResolvedValue(makeFakeBytes());

    prefetchAdjacent(files, 0);
    await vi.waitFor(() =>
      expect(getCachedBuffer(files[1].path)).not.toBeNull(),
    );

    evictAll();

    expect(getCachedBuffer(files[1].path)).toBeNull();
  });
});
