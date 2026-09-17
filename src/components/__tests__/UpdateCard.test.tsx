import "@testing-library/jest-dom/vitest";
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

  it("waits for settings and reflects saved toggle values in App Updates", () => {
    const toggle = vi.fn();
    const props = {
      onToggleAutoCheckForUpdates: toggle,
      updateConfiguration: configuration,
      updateError: null,
      updateCheck: null,
      isCheckingForUpdate: false,
      isInstallingUpdate: false,
      onCheckForUpdate: vi.fn(),
      onInstallUpdate: vi.fn(),
    };
    const { getByRole, rerender } = render(
      <UpdateCard {...props} autoCheckForUpdates={null} />,
    );
    const control = () => getByRole("switch", { name: "Auto-check updates" });
    expect(control()).toBeDisabled();
    fireEvent.click(control());
    expect(toggle).not.toHaveBeenCalled();
    rerender(<UpdateCard {...props} autoCheckForUpdates={true} />);
    expect(control()).toHaveAttribute("aria-checked", "true");
    fireEvent.click(control());
    expect(toggle).toHaveBeenCalledTimes(1);
    rerender(<UpdateCard {...props} autoCheckForUpdates={false} />);
    expect(control()).toHaveAttribute("aria-checked", "false");
  });

  it.each([
    [null, "Up to date"],
    ["Network unavailable", "Update check failed"],
  ])("shows the check result in the single card (%s)", (error, state) => {
    const { getByText, queryByText, getAllByRole } = render(
      <UpdateCard
        autoCheckForUpdates={false}
        onToggleAutoCheckForUpdates={() => undefined}
        updateConfiguration={configuration}
        updateError={error}
        updateCheck={{ configuration, update: null }}
        isCheckingForUpdate={false}
        isInstallingUpdate={false}
        onCheckForUpdate={() => undefined}
        onInstallUpdate={() => undefined}
      />,
    );
    expect(getByText(state)).toBeTruthy();
    expect(queryByText("Available update")).toBeNull();
    expect(getAllByRole("button", { name: "Check for Updates" })).toHaveLength(
      1,
    );
    expect(getAllByRole("button", { name: "Install Update" })).toHaveLength(1);
  });

  it.each([
    { ...configuration, effectiveEndpoint: null },
    { ...configuration, effectivePubkeyAvailable: false },
  ])(
    "disables unsupported builds without showing a stale update or red failure",
    (unavailable) => {
      const check = vi.fn(),
        install = vi.fn();
      const { getByText, getByRole, queryByText } = render(
        <UpdateCard
          autoCheckForUpdates={true}
          onToggleAutoCheckForUpdates={() => undefined}
          updateConfiguration={unavailable}
          updateError="no updater endpoint configured"
          updateCheck={updateCheck}
          isCheckingForUpdate={false}
          isInstallingUpdate={false}
          onCheckForUpdate={check}
          onInstallUpdate={install}
        />,
      );
      expect(getByText("0.1.9")).toBeTruthy();
      expect(
        getByText("Update checks unavailable for this build"),
      ).toBeTruthy();
      const checkButton = getByRole("button", {
        name: "Check for Updates",
      }) as HTMLButtonElement;
      const installButton = getByRole("button", {
        name: "Install Update",
      }) as HTMLButtonElement;
      expect(checkButton.disabled).toBe(true);
      expect(installButton.disabled).toBe(true);
      fireEvent.click(checkButton);
      fireEvent.click(installButton);
      expect(check).not.toHaveBeenCalled();
      expect(install).not.toHaveBeenCalled();
      expect(queryByText("no updater endpoint configured")).toBeNull();
      expect(queryByText("Available update")).toBeNull();
      expect(queryByText("0.1.9 -> 0.2.0")).toBeNull();
    },
  );

  it("shows current and available versions when an update exists", () => {
    const { getByText, queryByText } = render(
      <UpdateCard
        autoCheckForUpdates={true}
        onToggleAutoCheckForUpdates={() => undefined}
        isCheckingForUpdate={false}
        isInstallingUpdate={false}
        onCheckForUpdate={() => undefined}
        onInstallUpdate={() => undefined}
        updateCheck={updateCheck}
        updateConfiguration={configuration}
        updateError={null}
      />,
    );

    expect(getByText("Update available")).toBeTruthy();
    expect(getByText("0.1.9")).toBeTruthy();
    expect(getByText("0.2.0")).toBeTruthy();
    expect(queryByText("Release notes")).toBeNull();
    expect(queryByText("Available update")).toBeNull();
  });

  it("calls install from the single App Updates action", () => {
    const onInstallUpdate = vi.fn();
    const { getAllByRole } = render(
      <UpdateCard
        autoCheckForUpdates={true}
        onToggleAutoCheckForUpdates={() => undefined}
        isCheckingForUpdate={false}
        isInstallingUpdate={false}
        onCheckForUpdate={() => undefined}
        onInstallUpdate={onInstallUpdate}
        updateCheck={updateCheck}
        updateConfiguration={configuration}
        updateError={null}
      />,
    );

    const installButtons = getAllByRole("button", { name: "Install Update" });
    expect(installButtons).toHaveLength(1);
    fireEvent.click(installButtons[0]);

    expect(onInstallUpdate).toHaveBeenCalledTimes(1);
  });
});
