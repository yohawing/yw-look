import { StrictMode, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsActions } from "../useSettingsActions";
import {
  installOptionalLoaderPack,
  removeOptionalLoaderPack,
  type OptionalLoaderPackManifest,
} from "../../lib/loaderPacks";
import { saveSettings, type SettingsPayload } from "../../lib/settings";
import {
  openDefaultAppsSettings,
  syncFileAssociations,
} from "../../lib/fileAssociations";

vi.mock("../../lib/loaderPacks", () => ({
  installOptionalLoaderPack: vi.fn(),
  removeOptionalLoaderPack: vi.fn(),
}));

vi.mock("../../lib/settings", () => ({
  saveSettings: vi.fn(),
}));

vi.mock("../../lib/fileAssociations", () => ({
  openDefaultAppsSettings: vi.fn(),
  syncFileAssociations: vi.fn(),
}));

const supportedFileAssociations = {
  platform: "windows",
  supported: true,
  effectiveExtensions: ["usd", "pmx"],
  requiresUserConfirmation: true,
  message: "Choose defaults in Windows Settings.",
};

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function StrictModeWrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

it("serializes language selection with other settings and permits retry after a failed save", async () => {
  const initial = makeSettingsPayload(true);
  const setSettingsPayload = vi.fn();
  const setSettingsError = vi.fn();
  vi.mocked(saveSettings).mockImplementation(async (settings) => ({
    ...initial,
    settings,
  }));
  const { result } = renderHook(() =>
    useSettingsActions({
      isTauri: false,
      refreshUpdateConfiguration: vi.fn(async () => {}),
      setSettingsError,
      setOptionalLoaderManifests: vi.fn(),
      setSettingsPayload,
      setUpdateError: vi.fn(),
      settingsPayload: initial,
    }),
  );
  await act(async () => {
    await Promise.all([
      result.current.handleChangeLanguage("ja"),
      result.current.handleToggleAutoCheckForUpdates(),
    ]);
  });
  expect(vi.mocked(saveSettings).mock.calls.at(-1)?.[0]).toMatchObject({
    language: "ja",
    autoCheckForUpdates: false,
  });
  vi.mocked(saveSettings).mockRejectedValueOnce(new Error("disk full"));
  await act(async () => {
    await result.current.handleChangeLanguage("ko");
  });
  expect(setSettingsError).toHaveBeenLastCalledWith("disk full");
  expect(setSettingsPayload.mock.calls.at(-1)?.[0].settings.language).toBe(
    "ja",
  );
  await act(async () => {
    await result.current.handleChangeLanguage("zh-Hans");
  });
  expect(setSettingsPayload.mock.calls.at(-1)?.[0].settings).toMatchObject({
    language: "zh-Hans",
    autoCheckForUpdates: false,
  });
});

beforeEach(() => {
  vi.mocked(installOptionalLoaderPack).mockResolvedValue([manifest]);
  vi.mocked(removeOptionalLoaderPack).mockResolvedValue([]);
  vi.mocked(saveSettings).mockImplementation(async (settings) => ({
    settingsPath: "C:\\Users\\yohaw\\AppData\\Roaming\\yw-look\\settings.json",
    settings,
  }));
  vi.mocked(syncFileAssociations).mockResolvedValue(supportedFileAssociations);
  vi.mocked(openDefaultAppsSettings).mockResolvedValue({
    ...supportedFileAssociations,
    effectiveExtensions: [],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useSettingsActions", () => {
  it("does not synchronize file associations outside Tauri", async () => {
    renderHook(() =>
      useSettingsActions({
        isTauri: false,
        refreshUpdateConfiguration: vi.fn(() => Promise.resolve()),
        setSettingsError: vi.fn(),
        setOptionalLoaderManifests: vi.fn(),
        setSettingsPayload: vi.fn(),
        setUpdateError: vi.fn(),
        settingsPayload: makeSettingsPayload(false),
      }),
    );

    await act(async () => Promise.resolve());
    expect(syncFileAssociations).not.toHaveBeenCalled();
  });

  it("synchronizes once when the first persisted settings arrive in Tauri", async () => {
    const initialPayload = makeSettingsPayload(false);
    const { rerender } = renderHook(
      ({ payload }: { payload: SettingsPayload | null }) =>
        useSettingsActions({
          isTauri: true,
          refreshUpdateConfiguration: vi.fn(() => Promise.resolve()),
          setSettingsError: vi.fn(),
          setOptionalLoaderManifests: vi.fn(),
          setSettingsPayload: vi.fn(),
          setUpdateError: vi.fn(),
          settingsPayload: payload,
        }),
      { initialProps: { payload: null as SettingsPayload | null } },
    );

    expect(syncFileAssociations).not.toHaveBeenCalled();
    rerender({ payload: initialPayload });
    await waitFor(() => expect(syncFileAssociations).toHaveBeenCalledTimes(1));
    rerender({ payload: makeSettingsPayload(true) });
    await act(async () => Promise.resolve());
    expect(syncFileAssociations).toHaveBeenCalledTimes(1);
  });

  it("reattaches to one initial synchronization in StrictMode", async () => {
    const initialSync = deferred<typeof supportedFileAssociations>();
    vi.mocked(syncFileAssociations).mockReturnValueOnce(initialSync.promise);
    const { result } = renderHook(
      () =>
        useSettingsActions({
          isTauri: true,
          refreshUpdateConfiguration: vi.fn(() => Promise.resolve()),
          setSettingsError: vi.fn(),
          setOptionalLoaderManifests: vi.fn(),
          setSettingsPayload: vi.fn(),
          setUpdateError: vi.fn(),
          settingsPayload: makeSettingsPayload(false),
        }),
      { wrapper: StrictModeWrapper },
    );

    await waitFor(() => expect(syncFileAssociations).toHaveBeenCalledTimes(1));
    await act(async () => initialSync.resolve(supportedFileAssociations));
    await waitFor(() =>
      expect(result.current.fileAssociationResult).toEqual(
        supportedFileAssociations,
      ),
    );
    expect(syncFileAssociations).toHaveBeenCalledTimes(1);
  });

  it("keeps controls hidden while platform support is pending and after an unsupported result", async () => {
    const initialSync = deferred<typeof supportedFileAssociations>();
    vi.mocked(syncFileAssociations).mockReturnValueOnce(initialSync.promise);
    const { result } = renderHook(() =>
      useSettingsActions({
        isTauri: true,
        refreshUpdateConfiguration: vi.fn(() => Promise.resolve()),
        setSettingsError: vi.fn(),
        setOptionalLoaderManifests: vi.fn(),
        setSettingsPayload: vi.fn(),
        setUpdateError: vi.fn(),
        settingsPayload: makeSettingsPayload(false),
      }),
    );

    expect(result.current.fileAssociationsAvailable).toBe(false);
    await act(async () =>
      initialSync.resolve({
        ...supportedFileAssociations,
        platform: "macos",
        supported: false,
        effectiveExtensions: [],
        requiresUserConfirmation: false,
      }),
    );
    expect(result.current.fileAssociationsAvailable).toBe(false);
  });

  it("saves the association toggle before synchronizing", async () => {
    const settingsPayload = makeSettingsPayload(false);
    const setSettingsPayload = vi.fn();
    const { result } = renderHook(() =>
      useSettingsActions({
        isTauri: true,
        refreshUpdateConfiguration: vi.fn(() => Promise.resolve()),
        setSettingsError: vi.fn(),
        setOptionalLoaderManifests: vi.fn(),
        setSettingsPayload,
        setUpdateError: vi.fn(),
        settingsPayload,
      }),
    );
    await waitFor(() => expect(syncFileAssociations).toHaveBeenCalledTimes(1));
    vi.mocked(syncFileAssociations).mockClear();

    await act(async () => {
      await result.current.handleToggleFileAssociations();
    });

    expect(saveSettings).toHaveBeenCalledWith({
      ...settingsPayload.settings,
      fileAssociationsEnabled: true,
    });
    expect(setSettingsPayload).toHaveBeenCalled();
    expect(syncFileAssociations).toHaveBeenCalledTimes(1);
  });

  it("keeps a saved setting when association synchronization fails", async () => {
    const settingsPayload = makeSettingsPayload(false);
    const setSettingsError = vi.fn();
    const setSettingsPayload = vi.fn();
    const { result } = renderHook(() =>
      useSettingsActions({
        isTauri: true,
        refreshUpdateConfiguration: vi.fn(() => Promise.resolve()),
        setSettingsError,
        setOptionalLoaderManifests: vi.fn(),
        setSettingsPayload,
        setUpdateError: vi.fn(),
        settingsPayload,
      }),
    );
    await waitFor(() => expect(syncFileAssociations).toHaveBeenCalledTimes(1));
    vi.mocked(syncFileAssociations).mockRejectedValueOnce(
      new Error("registry unavailable"),
    );

    await act(async () => {
      await result.current.handleToggleFileAssociations();
    });

    expect(setSettingsPayload).toHaveBeenCalled();
    expect(setSettingsError).toHaveBeenCalledWith(null);
    expect(result.current.fileAssociationError).toContain(
      "registry unavailable",
    );
  });

  it("queues synchronization and only publishes the latest requested result", async () => {
    const initialSync = deferred<typeof supportedFileAssociations>();
    const latestResult = {
      ...supportedFileAssociations,
      effectiveExtensions: ["usd", "pmx", "vmd"],
      message: "latest",
    };
    vi.mocked(syncFileAssociations)
      .mockReturnValueOnce(initialSync.promise)
      .mockResolvedValueOnce(latestResult);
    const { result } = renderHook(() =>
      useSettingsActions({
        isTauri: true,
        refreshUpdateConfiguration: vi.fn(() => Promise.resolve()),
        setSettingsError: vi.fn(),
        setOptionalLoaderManifests: vi.fn(),
        setSettingsPayload: vi.fn(),
        setUpdateError: vi.fn(),
        settingsPayload: makeSettingsPayload(false),
      }),
    );
    await waitFor(() => expect(syncFileAssociations).toHaveBeenCalledTimes(1));

    let togglePromise!: Promise<void>;
    await act(async () => {
      togglePromise = result.current.handleToggleFileAssociations();
      await Promise.resolve();
    });
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    await act(async () => initialSync.resolve(supportedFileAssociations));
    await act(async () => togglePromise);

    expect(syncFileAssociations).toHaveBeenCalledTimes(2);
    expect(result.current.fileAssociationResult).toEqual(latestResult);
    expect(result.current.fileAssociationError).toBeNull();
  });

  it("does not publish a superseded initial synchronization failure", async () => {
    const initialSync = deferred<typeof supportedFileAssociations>();
    const latestResult = {
      ...supportedFileAssociations,
      message: "recovered",
    };
    vi.mocked(syncFileAssociations)
      .mockReturnValueOnce(initialSync.promise)
      .mockResolvedValueOnce(latestResult);
    const { result } = renderHook(() =>
      useSettingsActions({
        isTauri: true,
        refreshUpdateConfiguration: vi.fn(() => Promise.resolve()),
        setSettingsError: vi.fn(),
        setOptionalLoaderManifests: vi.fn(),
        setSettingsPayload: vi.fn(),
        setUpdateError: vi.fn(),
        settingsPayload: makeSettingsPayload(false),
      }),
    );
    await waitFor(() => expect(syncFileAssociations).toHaveBeenCalledTimes(1));

    let togglePromise!: Promise<void>;
    await act(async () => {
      togglePromise = result.current.handleToggleFileAssociations();
      await Promise.resolve();
    });
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    await act(async () => initialSync.reject(new Error("stale failure")));
    await act(async () => togglePromise);

    expect(result.current.fileAssociationResult).toEqual(latestResult);
    expect(result.current.fileAssociationError).toBeNull();
  });

  it("recovers an initial synchronization failure through retry", async () => {
    vi.mocked(syncFileAssociations)
      .mockRejectedValueOnce(new Error("registry unavailable"))
      .mockResolvedValueOnce(supportedFileAssociations);
    const { result } = renderHook(() =>
      useSettingsActions({
        isTauri: true,
        refreshUpdateConfiguration: vi.fn(() => Promise.resolve()),
        setSettingsError: vi.fn(),
        setOptionalLoaderManifests: vi.fn(),
        setSettingsPayload: vi.fn(),
        setUpdateError: vi.fn(),
        settingsPayload: makeSettingsPayload(false),
      }),
    );
    await waitFor(() =>
      expect(result.current.fileAssociationError).toContain(
        "registry unavailable",
      ),
    );
    expect(result.current.fileAssociationsAvailable).toBe(true);

    await act(async () => result.current.handleRetryFileAssociations());

    expect(result.current.fileAssociationResult).toEqual(
      supportedFileAssociations,
    );
    expect(result.current.fileAssociationError).toBeNull();
  });

  it("keeps an initial synchronization error after opening Default Apps succeeds", async () => {
    vi.mocked(syncFileAssociations).mockRejectedValueOnce(
      new Error("registry unavailable"),
    );
    const { result } = renderHook(() =>
      useSettingsActions({
        isTauri: true,
        refreshUpdateConfiguration: vi.fn(() => Promise.resolve()),
        setSettingsError: vi.fn(),
        setOptionalLoaderManifests: vi.fn(),
        setSettingsPayload: vi.fn(),
        setUpdateError: vi.fn(),
        settingsPayload: makeSettingsPayload(false),
      }),
    );
    await waitFor(() =>
      expect(result.current.fileAssociationError).toContain(
        "registry unavailable",
      ),
    );

    await act(async () => result.current.handleOpenDefaultAppsSettings());

    expect(openDefaultAppsSettings).toHaveBeenCalledTimes(1);
    expect(result.current.fileAssociationError).toContain(
      "registry unavailable",
    );
    expect(result.current.fileAssociationsAvailable).toBe(true);
  });

  it("serializes rapid toggles against the latest persisted payload", async () => {
    const initialPayload = makeSettingsPayload(false);
    const { result } = renderHook(() =>
      useSettingsActions({
        isTauri: false,
        refreshUpdateConfiguration: vi.fn(() => Promise.resolve()),
        setSettingsError: vi.fn(),
        setOptionalLoaderManifests: vi.fn(),
        setSettingsPayload: vi.fn(),
        setUpdateError: vi.fn(),
        settingsPayload: initialPayload,
      }),
    );

    await act(async () => {
      await Promise.all([
        result.current.handleToggleFileAssociations(),
        result.current.handleToggleFileAssociations(),
      ]);
    });

    expect(saveSettings).toHaveBeenNthCalledWith(1, {
      ...initialPayload.settings,
      fileAssociationsEnabled: true,
    });
    expect(saveSettings).toHaveBeenNthCalledWith(2, initialPayload.settings);
  });

  it("preserves association changes across a concurrent loader pack toggle", async () => {
    const initialPayload = makeSettingsPayload(true);
    const { result } = renderHook(() =>
      useSettingsActions({
        isTauri: false,
        refreshUpdateConfiguration: vi.fn(() => Promise.resolve()),
        setSettingsError: vi.fn(),
        setOptionalLoaderManifests: vi.fn(),
        setSettingsPayload: vi.fn(),
        setUpdateError: vi.fn(),
        settingsPayload: initialPayload,
      }),
    );

    await act(async () => {
      await Promise.all([
        result.current.handleToggleFileAssociations(),
        result.current.handleToggleOptionalLoaderPack("mmd-loader-pack"),
      ]);
    });

    expect(saveSettings).toHaveBeenNthCalledWith(2, {
      ...initialPayload.settings,
      fileAssociationsEnabled: true,
      optionalLoaderPacks: {
        "mmd-loader-pack": { enabled: false },
      },
    });
  });

  it("enables a loader pack setting after installing its manifest", async () => {
    const settingsPayload = makeSettingsPayload(false);
    const setOptionalLoaderManifests = vi.fn();
    const setSettingsError = vi.fn();
    const setSettingsPayload = vi.fn();
    const { result } = renderHook(() =>
      useSettingsActions({
        isTauri: false,
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
        isTauri: false,
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

  it("synchronizes after a loader pack manifest and setting persist", async () => {
    const settingsPayload = makeSettingsPayload(false);
    const { result } = renderHook(() =>
      useSettingsActions({
        isTauri: true,
        refreshUpdateConfiguration: vi.fn(() => Promise.resolve()),
        setSettingsError: vi.fn(),
        setOptionalLoaderManifests: vi.fn(),
        setSettingsPayload: vi.fn(),
        setUpdateError: vi.fn(),
        settingsPayload,
      }),
    );
    await waitFor(() => expect(syncFileAssociations).toHaveBeenCalledTimes(1));
    vi.mocked(syncFileAssociations).mockClear();

    await act(async () => {
      await result.current.handleInstallOptionalLoaderPack("mmd-loader-pack");
    });

    expect(installOptionalLoaderPack).toHaveBeenCalled();
    expect(saveSettings).toHaveBeenCalled();
    expect(syncFileAssociations).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["install", installOptionalLoaderPack, "installed"],
    ["remove", removeOptionalLoaderPack, "removed"],
  ] as const)(
    "synchronizes after %s succeeds even when saving its setting fails",
    async (action, _mutation, completedAction) => {
      const settingsPayload = makeSettingsPayload(action === "remove");
      const setSettingsError = vi.fn();
      const { result } = renderHook(() =>
        useSettingsActions({
          isTauri: true,
          refreshUpdateConfiguration: vi.fn(() => Promise.resolve()),
          setSettingsError,
          setOptionalLoaderManifests: vi.fn(),
          setSettingsPayload: vi.fn(),
          setUpdateError: vi.fn(),
          settingsPayload,
        }),
      );
      await waitFor(() =>
        expect(syncFileAssociations).toHaveBeenCalledTimes(1),
      );
      vi.mocked(syncFileAssociations).mockClear();
      vi.mocked(saveSettings).mockRejectedValueOnce(new Error("disk full"));

      await act(async () => {
        if (action === "install") {
          await result.current.handleInstallOptionalLoaderPack(
            "mmd-loader-pack",
          );
        } else {
          await result.current.handleRemoveOptionalLoaderPack(
            "mmd-loader-pack",
          );
        }
      });

      expect(syncFileAssociations).toHaveBeenCalledTimes(1);
      expect(setSettingsError).toHaveBeenLastCalledWith(
        `Loader pack was ${completedAction}, but its setting could not be saved: disk full`,
      );
    },
  );

  it("synchronizes after toggling an optional loader pack setting", async () => {
    const settingsPayload = makeSettingsPayload(true);
    const { result } = renderHook(() =>
      useSettingsActions({
        isTauri: true,
        refreshUpdateConfiguration: vi.fn(() => Promise.resolve()),
        setSettingsError: vi.fn(),
        setOptionalLoaderManifests: vi.fn(),
        setSettingsPayload: vi.fn(),
        setUpdateError: vi.fn(),
        settingsPayload,
      }),
    );
    await waitFor(() => expect(syncFileAssociations).toHaveBeenCalledTimes(1));
    vi.mocked(syncFileAssociations).mockClear();

    await act(async () => {
      await result.current.handleToggleOptionalLoaderPack("mmd-loader-pack");
    });

    expect(saveSettings).toHaveBeenCalledWith({
      ...settingsPayload.settings,
      optionalLoaderPacks: {
        "mmd-loader-pack": { enabled: false },
      },
    });
    expect(syncFileAssociations).toHaveBeenCalledTimes(1);
  });
});
