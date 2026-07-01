export const USD_SOURCE_RENDER_LIMITS = {
  maxRenderChars: 256_000,
  flattenWarnBytes: 1_000_000,
} as const;

export const PREFETCH_CACHE_LIMITS = {
  maxEntries: 3,
  maxFileSizeBytes: 50 * 1024 * 1024,
} as const;

export const DEFERRED_PAYLOAD_PREVIEW_LIMITS = {
  batchSize: 1,
  maxAutoLoad: 512,
  extractEveryPayloads: 64,
  startDelayMs: 750,
  yieldMs: 16,
} as const;
