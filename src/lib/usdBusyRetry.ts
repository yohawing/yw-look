import { DEFERRED_PAYLOAD_PREVIEW_LIMITS } from "../config/viewerLimits";
import { isUsdTaskBusyError } from "./usd";

export function yieldDeferredPreviewFrame(
  delayMs: number = DEFERRED_PAYLOAD_PREVIEW_LIMITS.yieldMs,
): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

export async function retryWhileBusy<T>(
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
