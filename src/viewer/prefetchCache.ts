import { PREFETCH_CACHE_LIMITS } from "../config/viewerLimits";
import { readBinaryFile, type SelectedFile } from "../lib/files";

type CacheEntry = {
  data: ArrayBuffer;
};

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<ArrayBuffer | null>>();
let totalCachedBytes = 0;

function touchEntry(path: string, entry: CacheEntry) {
  cache.delete(path);
  cache.set(path, entry);
}

function evictLeastRecentlyUsed() {
  const oldestKey = cache.keys().next().value;
  if (!oldestKey) {
    return;
  }

  const oldest = cache.get(oldestKey);
  if (!oldest) {
    return;
  }

  totalCachedBytes -= oldest.data.byteLength;
  cache.delete(oldestKey);
}

function evictUntilWithinLimits(incomingBytes = 0) {
  while (
    cache.size >= PREFETCH_CACHE_LIMITS.maxEntries ||
    totalCachedBytes + incomingBytes > PREFETCH_CACHE_LIMITS.maxTotalBytes
  ) {
    if (cache.size === 0) {
      break;
    }
    evictLeastRecentlyUsed();
  }
}

export function getCachedBuffer(path: string): ArrayBuffer | null {
  const entry = cache.get(path);
  if (!entry) {
    return null;
  }

  touchEntry(path, entry);
  return entry.data;
}

export function evictAll() {
  cache.clear();
  pending.clear();
  totalCachedBytes = 0;
}

async function fetchAndCache(path: string): Promise<ArrayBuffer | null> {
  try {
    const buffer = await readBinaryFile(path);
    if (buffer.byteLength > PREFETCH_CACHE_LIMITS.maxFileSizeBytes) {
      return null;
    }

    evictUntilWithinLimits(buffer.byteLength);
    cache.set(path, { data: buffer });
    totalCachedBytes += buffer.byteLength;
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
