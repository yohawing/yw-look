import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { UpdateCard } from "../UpdateCard";
import type {
  UpdateCheckPayload,
  UpdateConfigurationPayload,
} from "../../lib/updater";

const configuration: UpdateConfigurationPayload = {
  currentVersion: "0.1.9",
  defaultEndpoint: "https://example.com/latest.json",
  defaultPubkeyAvailable: true,
  effectiveEndpoint: "https://example.com/latest.json",
  effectivePubkeyAvailable: true,
  usingOverrideEndpoint: false,
  usingOverridePubkey: false,
  allowInsecureUpdateEndpoint: false,
};

const updateCheck: UpdateCheckPayload = {
  configuration,
  update: {
    version: "0.2.0",
    currentVersion: "0.1.9",
    notes: "Release notes",
    pubDate: "2026-05-04T00:00:00Z",
    target: "windows-x86_64",
    downloadUrl: "https://example.com/yw-look.exe",
  },
};

describe("UpdateCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows current and available versions when an update exists", () => {
    const { getByText } = render(
      <UpdateCard
        isCheckingForUpdate={false}
        isInstallingUpdate={false}
        onCheckForUpdate={() => undefined}
        onInstallUpdate={() => undefined}
        onSaveOverride={() => undefined}
        updateCheck={updateCheck}
        updateConfiguration={configuration}
        updateError={null}
      />,
    );

    expect(getByText("Update available")).toBeTruthy();
    expect(getByText("0.1.9 -> 0.2.0")).toBeTruthy();
    expect(getByText("Release notes")).toBeTruthy();
  });

  it("calls install from the available update section", () => {
    const onInstallUpdate = vi.fn();
    const { getAllByRole } = render(
      <UpdateCard
        isCheckingForUpdate={false}
        isInstallingUpdate={false}
        onCheckForUpdate={() => undefined}
        onInstallUpdate={onInstallUpdate}
        onSaveOverride={() => undefined}
        updateCheck={updateCheck}
        updateConfiguration={configuration}
        updateError={null}
      />,
    );

    const installButtons = getAllByRole("button", { name: "Install Update" });
    fireEvent.click(installButtons[installButtons.length - 1]);

    expect(onInstallUpdate).toHaveBeenCalledTimes(1);
  });
});
