import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsCard } from "../SettingsCard";
import type { SettingsPayload } from "../../lib/settings";

const settingsPayload: SettingsPayload = {
  settingsPath: "C:\\Users\\yohaw\\AppData\\Roaming\\yw-look\\settings.json",
  settings: {
    version: 1,
    recentFilesLimit: 10,
    diagnosticsLogLevel: "warn",
    fileAssociationsEnabled: false,
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
          },
          {
            id: "gaussian-splat-loader-pack",
            name: "Gaussian Splat Loader Pack",
            extensions: ["splat", "spz"],
            installed: false,
          },
        ]}
        onToggleAutoCheckForUpdates={() => undefined}
        onToggleFileAssociations={() => undefined}
      />,
    );

    expect(getByText("Optional Loader Packs")).toBeTruthy();
    expect(getByText("MMD Loader Pack")).toBeTruthy();
    expect(getByText("Gaussian Splat Loader Pack")).toBeTruthy();
    expect(getByText("Installed")).toBeTruthy();
    expect(getByText("Missing")).toBeTruthy();
    expect(getByText(".pmd .pmx .vmd")).toBeTruthy();
  });
});
