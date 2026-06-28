import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsCard } from "../SettingsCard";
import type { SettingsPayload } from "../../lib/settings";

const settingsPayload: SettingsPayload = {
  settingsPath: "C:\\Users\\yohaw\\AppData\\Roaming\\yw-look\\settings.json",
  settings: {
    version: 1,
    recentFilesLimit: 10,
    diagnosticsLogLevel: "warn",
    fileAssociationsEnabled: false,
    optionalLoaderPacks: {},
    updateEndpointOverride: null,
    updatePublicKeyOverride: null,
    allowInsecureUpdateEndpoint: false,
    autoCheckForUpdates: true,
  },
};

describe("SettingsCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("reports optional loader pack installation state", () => {
    const { getByText } = render(
      <SettingsCard
        settingsPayload={settingsPayload}
        settingsError={null}
        optionalLoaderPacks={[
          {
            id: "mmd-loader-pack",
            name: "MMD Loader Pack",
            extensions: ["pmd", "pmx", "vmd"],
            installed: true,
            enabled: true,
            manifestInstalled: true,
            runtimeAvailable: true,
            version: "0.2.0",
          },
          {
            id: "gaussian-splat-loader-pack",
            name: "Gaussian Splat Loader Pack",
            extensions: ["splat", "spz"],
            installed: false,
            enabled: true,
            manifestInstalled: false,
            runtimeAvailable: false,
          },
        ]}
        onToggleAutoCheckForUpdates={() => undefined}
        onToggleFileAssociations={() => undefined}
        onInstallOptionalLoaderPack={() => undefined}
        onRemoveOptionalLoaderPack={() => undefined}
        onToggleOptionalLoaderPack={() => undefined}
      />,
    );

    expect(getByText("Optional Loader Packs")).toBeTruthy();
    expect(getByText("MMD Loader Pack")).toBeTruthy();
    expect(getByText("Gaussian Splat Loader Pack")).toBeTruthy();
    expect(getByText("Enabled")).toBeTruthy();
    expect(getByText("Missing")).toBeTruthy();
    expect(getByText(".pmd .pmx .vmd")).toBeTruthy();
    expect(getByText("Managed 0.2.0")).toBeTruthy();
  });

  it("requests optional loader pack toggles for installed packs", () => {
    const onToggleOptionalLoaderPack = vi.fn();
    const { getByRole } = render(
      <SettingsCard
        settingsPayload={settingsPayload}
        settingsError={null}
        optionalLoaderPacks={[
          {
            id: "mmd-loader-pack",
            name: "MMD Loader Pack",
            extensions: ["pmd", "pmx", "vmd"],
            installed: true,
            enabled: false,
            manifestInstalled: false,
            runtimeAvailable: true,
          },
        ]}
        onToggleAutoCheckForUpdates={() => undefined}
        onToggleFileAssociations={() => undefined}
        onInstallOptionalLoaderPack={() => undefined}
        onRemoveOptionalLoaderPack={() => undefined}
        onToggleOptionalLoaderPack={onToggleOptionalLoaderPack}
      />,
    );

    fireEvent.click(
      getByRole("switch", { name: "MMD Loader Pack loader pack" }),
    );

    expect(onToggleOptionalLoaderPack).toHaveBeenCalledWith("mmd-loader-pack");
  });

  it("requests optional loader pack install and removal", () => {
    const onInstallOptionalLoaderPack = vi.fn();
    const onRemoveOptionalLoaderPack = vi.fn();
    const { getByRole } = render(
      <SettingsCard
        settingsPayload={settingsPayload}
        settingsError={null}
        optionalLoaderPacks={[
          {
            id: "mmd-loader-pack",
            name: "MMD Loader Pack",
            extensions: ["pmd", "pmx", "vmd"],
            installed: true,
            enabled: true,
            manifestInstalled: false,
            runtimeAvailable: true,
          },
          {
            id: "gaussian-splat-loader-pack",
            name: "Gaussian Splat Loader Pack",
            extensions: ["splat", "spz"],
            installed: true,
            enabled: true,
            manifestInstalled: true,
            runtimeAvailable: true,
            version: "0.2.0",
          },
        ]}
        onToggleAutoCheckForUpdates={() => undefined}
        onToggleFileAssociations={() => undefined}
        onInstallOptionalLoaderPack={onInstallOptionalLoaderPack}
        onRemoveOptionalLoaderPack={onRemoveOptionalLoaderPack}
        onToggleOptionalLoaderPack={() => undefined}
      />,
    );

    fireEvent.click(getByRole("button", { name: "Install" }));
    fireEvent.click(getByRole("button", { name: "Remove" }));
    expect(onRemoveOptionalLoaderPack).not.toHaveBeenCalled();
    fireEvent.click(getByRole("button", { name: "Confirm" }));

    expect(onInstallOptionalLoaderPack).toHaveBeenCalledWith("mmd-loader-pack");
    expect(onRemoveOptionalLoaderPack).toHaveBeenCalledWith(
      "gaussian-splat-loader-pack",
    );
  });
});
