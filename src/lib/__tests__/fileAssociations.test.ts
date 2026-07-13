import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  openDefaultAppsSettings,
  syncFileAssociations,
} from "../fileAssociations";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({
    platform: "windows",
    supported: true,
    effectiveExtensions: ["usd"],
    requiresUserConfirmation: true,
    message: "Choose a default app in Windows Settings.",
  });
});

describe("file association IPC", () => {
  it("invokes the association synchronization command", async () => {
    await syncFileAssociations();

    expect(invokeMock).toHaveBeenCalledWith("sync_file_associations");
  });

  it("invokes the Windows Default Apps command", async () => {
    await openDefaultAppsSettings();

    expect(invokeMock).toHaveBeenCalledWith("open_default_apps_settings");
  });
});
