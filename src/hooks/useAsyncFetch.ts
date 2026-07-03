import { useEffect, useRef, useState } from "react";
import { deferEffectStateUpdate } from "../lib/deferEffectStateUpdate";
import { errorMessage } from "../lib/errors";

type UseAsyncFetchOptions = {
  enabled?: boolean;
  errorFallback: string;
  initialLoading?: boolean;
  onBeforeFetch?: () => void;
  onReset?: () => void;
};

type UseAsyncFetchResult<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
};

export function useAsyncFetch<T>(
  fetcher: (() => Promise<T>) | null,
  deps: readonly unknown[],
  {
    enabled = fetcher !== null,
    errorFallback,
    initialLoading = false,
    onBeforeFetch,
    onReset,
  }: UseAsyncFetchOptions,
): UseAsyncFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(initialLoading);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  const onBeforeFetchRef = useRef(onBeforeFetch);
  const onResetRef = useRef(onReset);

  useEffect(() => {
    fetcherRef.current = fetcher;
    onBeforeFetchRef.current = onBeforeFetch;
    onResetRef.current = onReset;
  });

  useEffect(() => {
    if (!enabled || fetcherRef.current === null) {
      return deferEffectStateUpdate(() => {
        setData(null);
        setError(null);
        onResetRef.current?.();
      });
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const currentFetcher = fetcherRef.current;
      if (currentFetcher === null) return;
      setLoading(true);
      setError(null);
      onBeforeFetchRef.current?.();
      currentFetcher()
        .then((result) => {
          if (!cancelled) {
            if (result !== undefined) {
              setData(result);
            }
            setLoading(false);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(errorMessage(err, errorFallback));
            setLoading(false);
          }
        });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers provide explicit deps for the async fetch lifecycle.
  }, [enabled, errorFallback, ...deps]);

  return { data, error, loading };
}
