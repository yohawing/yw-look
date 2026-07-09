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

  it("renders update preferences as a label and toggle row", () => {
    const { getByRole, getByText, queryByText } = render(
      <SettingsCard
        settingsPayload={settingsPayload}
        settingsError={null}
        optionalLoaderPacks={[]}
        onToggleAutoCheckForUpdates={() => undefined}
        onToggleOptionalLoaderPack={() => undefined}
      />,
    );

    expect(getByText("Update Preferences")).toBeTruthy();
    expect(getByText("Auto-check updates")).toBeTruthy();
    expect(getByRole("switch", { name: "Auto-check updates" })).toBeTruthy();
    expect(queryByText("File associations")).toBeNull();
    expect(queryByText("Support")).toBeNull();
    expect(queryByText("Enabled")).toBeNull();
    expect(queryByText("Disabled")).toBeNull();
    expect(queryByText("On")).toBeNull();
    expect(queryByText("Off")).toBeNull();
  });

  it("renders optional loader packs as label and toggle rows", () => {
    const { getByRole, getByText, queryByText } = render(
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
            compatibility: {
              state: "compatible",
              label: "Compatible",
            },
          },
          {
            id: "gaussian-splat-loader-pack",
            name: "Gaussian Splat Loader Pack",
            extensions: ["splat", "spz"],
            installed: false,
            enabled: true,
            manifestInstalled: false,
            runtimeAvailable: false,
            compatibility: {
              state: "runtimeMissing",
              label: "Runtime missing",
              detail:
                "This build does not include the loader runtime for this pack.",
            },
          },
        ]}
        onToggleAutoCheckForUpdates={() => undefined}
        onToggleOptionalLoaderPack={() => undefined}
      />,
    );

    expect(getByText("Optional Loader Packs")).toBeTruthy();
    expect(getByText("MMD Loader Pack")).toBeTruthy();
    expect(getByText("Gaussian Splat Loader Pack")).toBeTruthy();
    expect(
      getByRole("switch", { name: "MMD Loader Pack loader pack" }),
    ).toBeTruthy();
    expect(
      getByRole("switch", { name: "Gaussian Splat Loader Pack loader pack" }),
    ).toBeTruthy();
    expect(queryByText("Enabled")).toBeNull();
    expect(queryByText("Missing")).toBeNull();
    expect(queryByText(".pmd .pmx .vmd")).toBeNull();
    expect(queryByText("Managed 0.2.0")).toBeNull();
    expect(queryByText("Compatible")).toBeNull();
    expect(queryByText("Runtime missing")).toBeNull();
    expect(queryByText("Install")).toBeNull();
    expect(queryByText("Remove")).toBeNull();
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
            compatibility: {
              state: "disabled",
              label: "Disabled",
            },
          },
        ]}
        onToggleAutoCheckForUpdates={() => undefined}
        onToggleOptionalLoaderPack={onToggleOptionalLoaderPack}
      />,
    );

    fireEvent.click(
      getByRole("switch", { name: "MMD Loader Pack loader pack" }),
    );

    expect(onToggleOptionalLoaderPack).toHaveBeenCalledWith("mmd-loader-pack");
  });

  it("does not render the removed About section in settings", () => {
    const { queryByText } = render(
      <SettingsCard
        settingsPayload={settingsPayload}
        settingsError={null}
        optionalLoaderPacks={[]}
        onToggleAutoCheckForUpdates={() => undefined}
        onToggleOptionalLoaderPack={() => undefined}
      />,
    );

    expect(queryByText("About")).toBeNull();
    expect(queryByText("Application")).toBeNull();
    expect(queryByText("License")).toBeNull();
  });

  it("keeps settings loading state short without About", () => {
    const { getByText, queryByText } = render(
      <SettingsCard
        settingsPayload={null}
        settingsError={null}
        optionalLoaderPacks={[]}
        onToggleAutoCheckForUpdates={() => undefined}
        onToggleOptionalLoaderPack={() => undefined}
      />,
    );

    expect(getByText("Loading settings.")).toBeTruthy();
    expect(queryByText("About")).toBeNull();
    expect(queryByText("yw-look")).toBeNull();
  });

  it("reports optional loader pack manifest load failures", () => {
    const { getByText } = render(
      <SettingsCard
        settingsPayload={settingsPayload}
        settingsError={null}
        optionalLoaderPacks={[]}
        optionalLoaderPacksError="Failed to load optional loader pack manifests."
        onToggleAutoCheckForUpdates={() => undefined}
        onToggleOptionalLoaderPack={() => undefined}
      />,
    );

    expect(
      getByText("Failed to load optional loader pack manifests."),
    ).toBeTruthy();
  });
});
