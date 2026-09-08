import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdater } from "../useUpdater";
import {
  checkForUpdate,
  installPendingUpdate,
  loadUpdateConfiguration,
  type UpdateConfigurationPayload,
} from "../../lib/updater";
import type { SettingsPayload } from "../../lib/settings";

vi.mock("../../lib/updater", async (original) => ({
  ...(await original<typeof import("../../lib/updater")>()),
  checkForUpdate: vi.fn(),
  installPendingUpdate: vi.fn(),
  loadUpdateConfiguration: vi.fn(),
}));
const configuration: UpdateConfigurationPayload = {
  currentVersion: "0.3.3",
  defaultEndpoint: null,
  defaultPubkeyAvailable: true,
  effectiveEndpoint: null,
  effectivePubkeyAvailable: true,
  usingOverrideEndpoint: false,
  usingOverridePubkey: false,
  allowInsecureUpdateEndpoint: false,
};
const settings = { settings: { autoCheckForUpdates: true } } as SettingsPayload;
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("useUpdater configuration gate", () => {
  it("skips automatic and manual update operations on an unconfigured build", async () => {
    vi.mocked(loadUpdateConfiguration).mockResolvedValue(configuration);
    const { result } = renderHook(() => useUpdater(true, settings));
    await waitFor(() =>
      expect(result.current.updateConfiguration).toEqual(configuration),
    );
    await act(async () => {
      await result.current.handleCheckForUpdate();
      await result.current.handleInstallUpdate();
    });
    expect(checkForUpdate).not.toHaveBeenCalled();
    expect(installPendingUpdate).not.toHaveBeenCalled();
    expect(result.current.updateError).toBeNull();
  });

  it("waits for configuration before auto-checking once and preserves real failures", async () => {
    let resolve!: (value: UpdateConfigurationPayload) => void;
    vi.mocked(loadUpdateConfiguration).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    vi.mocked(checkForUpdate).mockRejectedValue(
      new Error("Network unavailable"),
    );
    const { result, rerender } = renderHook(() => useUpdater(true, settings));
    expect(checkForUpdate).not.toHaveBeenCalled();
    await act(async () =>
      resolve({
        ...configuration,
        effectiveEndpoint: "https://example.com/latest.json",
      }),
    );
    await waitFor(() =>
      expect(result.current.updateError).toBe("Network unavailable"),
    );
    rerender();
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    await act(async () => result.current.handleInstallUpdate());
    expect(installPendingUpdate).not.toHaveBeenCalled();
  });
});
