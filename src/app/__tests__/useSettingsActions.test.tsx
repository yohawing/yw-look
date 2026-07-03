import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsActions } from "../useSettingsActions";
import {
  installOptionalLoaderPack,
  removeOptionalLoaderPack,
  type OptionalLoaderPackManifest,
} from "../../lib/loaderPacks";
import { saveSettings, type SettingsPayload } from "../../lib/settings";

vi.mock("../../lib/loaderPacks", () => ({
  installOptionalLoaderPack: vi.fn(),
  removeOptionalLoaderPack: vi.fn(),
}));

vi.mock("../../lib/settings", () => ({
  saveSettings: vi.fn(),
}));

const manifest: OptionalLoaderPackManifest = {
  id: "mmd-loader-pack",
  name: "MMD Loader Pack",
  version: "0.2.0",
  compatibility: {
    state: "compatible",
    message: null,
  },
  extensions: ["pmx", "vmd"],
  entry: "index.js",
  packPath: "C:\\Users\\yohaw\\AppData\\Local\\yw-look\\loader-packs\\mmd",
  entryPath:
    "C:\\Users\\yohaw\\AppData\\Local\\yw-look\\loader-packs\\mmd\\index.js",
};

function makeSettingsPayload(enabled: boolean): SettingsPayload {
  return {
    settingsPath: "C:\\Users\\yohaw\\AppData\\Roaming\\yw-look\\settings.json",
    settings: {
      version: 1,
      recentFilesLimit: 10,
      diagnosticsLogLevel: "warn",
      fileAssociationsEnabled: false,
      optionalLoaderPacks: {
        "mmd-loader-pack": { enabled },
      },
      updateEndpointOverride: null,
      updatePublicKeyOverride: null,
      allowInsecureUpdateEndpoint: false,
      autoCheckForUpdates: true,
    },
  };
}

beforeEach(() => {
  vi.mocked(installOptionalLoaderPack).mockResolvedValue([manifest]);
  vi.mocked(removeOptionalLoaderPack).mockResolvedValue([]);
  vi.mocked(saveSettings).mockImplementation(async (settings) => ({
    settingsPath: "C:\\Users\\yohaw\\AppData\\Roaming\\yw-look\\settings.json",
    settings,
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useSettingsActions", () => {
  it("enables a loader pack setting after installing its manifest", async () => {
    const settingsPayload = makeSettingsPayload(false);
    const setOptionalLoaderManifests = vi.fn();
    const setSettingsError = vi.fn();
    const setSettingsPayload = vi.fn();
    const { result } = renderHook(() =>
      useSettingsActions({
        refreshUpdateConfiguration: vi.fn(() => Promise.resolve()),
        setSettingsError,
        setOptionalLoaderManifests,
        setSettingsPayload,
        setUpdateError: vi.fn(),
        settingsPayload,
      }),
    );

    await act(async () => {
      await result.current.handleInstallOptionalLoaderPack("mmd-loader-pack");
    });

    expect(installOptionalLoaderPack).toHaveBeenCalledWith("mmd-loader-pack");
    expect(setOptionalLoaderManifests).toHaveBeenCalledWith([manifest]);
    expect(saveSettings).toHaveBeenCalledWith({
      ...settingsPayload.settings,
      optionalLoaderPacks: {
        "mmd-loader-pack": { enabled: true },
      },
    });
    expect(setSettingsPayload).toHaveBeenCalledWith({
      settingsPath: settingsPayload.settingsPath,
      settings: {
        ...settingsPayload.settings,
        optionalLoaderPacks: {
          "mmd-loader-pack": { enabled: true },
        },
      },
    });
    expect(setSettingsError).toHaveBeenLastCalledWith(null);
  });

  it("disables a loader pack setting after removing its manifest", async () => {
    const settingsPayload = makeSettingsPayload(true);
    const setOptionalLoaderManifests = vi.fn();
    const setSettingsError = vi.fn();
    const { result } = renderHook(() =>
      useSettingsActions({
        refreshUpdateConfiguration: vi.fn(() => Promise.resolve()),
        setSettingsError,
        setOptionalLoaderManifests,
        setSettingsPayload: vi.fn(),
        setUpdateError: vi.fn(),
        settingsPayload,
      }),
    );

    await act(async () => {
      await result.current.handleRemoveOptionalLoaderPack("mmd-loader-pack");
    });

    expect(removeOptionalLoaderPack).toHaveBeenCalledWith("mmd-loader-pack");
    expect(setOptionalLoaderManifests).toHaveBeenCalledWith([]);
    expect(saveSettings).toHaveBeenCalledWith({
      ...settingsPayload.settings,
      optionalLoaderPacks: {
        "mmd-loader-pack": { enabled: false },
      },
    });
    expect(setSettingsError).toHaveBeenLastCalledWith(null);
  });
});
