import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAsyncFetch } from "../useAsyncFetch";

describe("useAsyncFetch", () => {
  it("loads data and clears errors around a fetch", async () => {
    const fetcher = vi.fn().mockResolvedValue("loaded");
    const { result } = renderHook(() =>
      useAsyncFetch(fetcher, [], {
        errorFallback: "failed",
      }),
    );

    await waitFor(() => {
      expect(result.current.data).toBe("loaded");
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("formats rejected errors", async () => {
    const fetcher = vi.fn().mockRejectedValue({ kind: "usd", message: "bad" });
    const { result } = renderHook(() =>
      useAsyncFetch(fetcher, [], {
        errorFallback: "failed",
      }),
    );

    await waitFor(() => {
      expect(result.current.error).toBe("bad");
    });
    expect(result.current.loading).toBe(false);
  });

  it("defers reset when disabled", async () => {
    const onReset = vi.fn();
    const { result } = renderHook(() =>
      useAsyncFetch(null, [], {
        errorFallback: "failed",
        onReset,
      }),
    );

    await waitFor(() => {
      expect(onReset).toHaveBeenCalled();
    });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("ignores stale fetch completions after deps change", async () => {
    let resolveFirst: (value: string) => void = () => {};
    const first = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const fetcher = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce("second");
    const { result, rerender } = renderHook(
      ({ version }) =>
        useAsyncFetch(fetcher, [version], {
          errorFallback: "failed",
        }),
      { initialProps: { version: 1 } },
    );

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
    rerender({ version: 2 });
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
    resolveFirst("first");

    await waitFor(() => {
      expect(result.current.data).toBe("second");
    });
  });

  it("supports initial loading state", () => {
    const { result } = renderHook(() =>
      useAsyncFetch(null, [], {
        errorFallback: "failed",
        initialLoading: true,
      }),
    );

    expect(result.current.loading).toBe(true);
  });

  it("keeps previous data while a dependency-triggered fetch is loading", async () => {
    let resolveSecond: (value: string) => void = () => {};
    const second = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });
    const { result, rerender } = renderHook(
      ({ version }) =>
        useAsyncFetch(
          () => (version === 1 ? Promise.resolve("first") : second),
          [version],
          {
            errorFallback: "failed",
          },
        ),
      { initialProps: { version: 1 } },
    );

    await waitFor(() => {
      expect(result.current.data).toBe("first");
    });

    rerender({ version: 2 });
    await waitFor(() => {
      expect(result.current.loading).toBe(true);
    });
    expect(result.current.data).toBe("first");

    resolveSecond("second");
    await waitFor(() => {
      expect(result.current.data).toBe("second");
    });
  });

  it("does not refetch when lifecycle callbacks change identity", async () => {
    const fetcher = vi.fn().mockResolvedValue("loaded");
    const onBeforeFetch = vi.fn();
    const onReset = vi.fn();
    const { rerender } = renderHook(
      ({ tick }) =>
        useAsyncFetch(fetcher, [], {
          errorFallback: "failed",
          onBeforeFetch: () => onBeforeFetch(tick),
          onReset: () => onReset(tick),
        }),
      { initialProps: { tick: 1 } },
    );

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    rerender({ tick: 2 });
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onBeforeFetch).toHaveBeenCalledTimes(1);
  });

  it("clears loading when a fetch resolves undefined", async () => {
    const fetcher = vi
      .fn<() => Promise<undefined>>()
      .mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAsyncFetch(fetcher, [], {
        errorFallback: "failed",
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
