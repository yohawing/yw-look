import { readBinaryFile, type SelectedFile } from "../lib/files";

type CacheEntry = {
  path: string;
  data: ArrayBuffer;
  fetchedAt: number;
};

const MAX_ENTRIES = 3;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB limit per file

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<ArrayBuffer | null>>();

export function getCachedBuffer(path: string): ArrayBuffer | null {
  const entry = cache.get(path);
  return entry?.data ?? null;
}

export function evictAll() {
  cache.clear();
  pending.clear();
}

function evictOldest() {
  if (cache.size < MAX_ENTRIES) {
    return;
  }

  let oldestKey: string | null = null;
  let oldestTime = Infinity;

  for (const [key, entry] of cache) {
    if (entry.fetchedAt < oldestTime) {
      oldestTime = entry.fetchedAt;
      oldestKey = key;
    }
  }

  if (oldestKey) {
    cache.delete(oldestKey);
  }
}

async function fetchAndCache(path: string): Promise<ArrayBuffer | null> {
  try {
    const bytes = await readBinaryFile(path);
    if (bytes.length > MAX_FILE_SIZE_BYTES) {
      return null;
    }
    const buffer = Uint8Array.from(bytes).buffer;
    evictOldest();
    cache.set(path, { path, data: buffer, fetchedAt: Date.now() });
    return buffer;
  } catch {
    return null;
  } finally {
    pending.delete(path);
  }
}

function prefetchOne(path: string) {
  if (cache.has(path) || pending.has(path)) {
    return;
  }

  const promise = fetchAndCache(path);
  pending.set(path, promise);
}

export function prefetchAdjacent(
  files: SelectedFile[],
  currentIndex: number | null,
) {
  if (currentIndex === null || files.length === 0) {
    return;
  }

  const prevIndex = currentIndex > 0 ? currentIndex - 1 : null;
  const nextIndex = currentIndex < files.length - 1 ? currentIndex + 1 : null;

  if (nextIndex !== null) {
    prefetchOne(files[nextIndex].path);
  }

  if (prevIndex !== null) {
    prefetchOne(files[prevIndex].path);
  }
}
