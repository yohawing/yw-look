import { type LanguagePreference } from "../lib/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  installOptionalLoaderPack,
  removeOptionalLoaderPack,
  type OptionalLoaderPackManifest,
} from "../lib/loaderPacks";
import { errorMessage } from "../lib/errors";
import {
  openDefaultAppsSettings,
  syncFileAssociations,
  type FileAssociationSyncResult,
} from "../lib/fileAssociations";
import { saveSettings, type SettingsPayload } from "../lib/settings";

type UseSettingsActionsOptions = {
  isTauri: boolean;
  refreshUpdateConfiguration: () => Promise<void>;
  setSettingsError: (error: string | null) => void;
  setOptionalLoaderManifests: (manifests: OptionalLoaderPackManifest[]) => void;
  setSettingsPayload: (payload: SettingsPayload | null) => void;
  setUpdateError: (error: string | null) => void;
  settingsPayload: SettingsPayload | null;
};

type ScheduledFileAssociationSync = {
  generation: number;
  promise: Promise<FileAssociationSyncResult>;
};

export function useSettingsActions({
  isTauri,
  refreshUpdateConfiguration,
  setSettingsError,
  setOptionalLoaderManifests,
  setSettingsPayload,
  setUpdateError,
  settingsPayload,
}: UseSettingsActionsOptions) {
  const [fileAssociationResult, setFileAssociationResult] =
    useState<FileAssociationSyncResult | null>(null);
  const [fileAssociationError, setFileAssociationError] = useState<
    string | null
  >(null);
  const persistedSettingsPayloadRef = useRef(settingsPayload);
  const settingsMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const fileAssociationSyncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const fileAssociationSyncGenerationRef = useRef(0);
  const initialFileAssociationSyncRef =
    useRef<ScheduledFileAssociationSync | null>(null);
  const hasPersistedSettings = settingsPayload !== null;

  useEffect(() => {
    persistedSettingsPayloadRef.current = settingsPayload;
  }, [settingsPayload]);

  const enqueueSettingsMutation = useCallback(
    <T>(
      mutation: (payload: SettingsPayload | null) => Promise<T>,
    ): Promise<T> => {
      const task = settingsMutationQueueRef.current.then(() =>
        mutation(persistedSettingsPayloadRef.current),
      );
      settingsMutationQueueRef.current = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
    [],
  );

  const persistSettings = useCallback(
    async (
      current: SettingsPayload,
      update: (
        settings: SettingsPayload["settings"],
      ) => SettingsPayload["settings"],
    ) => {
      const nextPayload = await saveSettings(update(current.settings));
      persistedSettingsPayloadRef.current = nextPayload;
      setSettingsPayload(nextPayload);
      return nextPayload;
    },
    [setSettingsPayload],
  );

  const scheduleFileAssociationSync =
    useCallback((): ScheduledFileAssociationSync | null => {
      if (!isTauri) return null;
      const generation = ++fileAssociationSyncGenerationRef.current;
      const promise = fileAssociationSyncQueueRef.current.then(() =>
        syncFileAssociations(),
      );
      fileAssociationSyncQueueRef.current = promise.then(
        () => undefined,
        () => undefined,
      );
      return { generation, promise };
    }, [isTauri]);

  const applyFileAssociationSync = useCallback(
    async (scheduled: ScheduledFileAssociationSync) => {
      try {
        const result = await scheduled.promise;
        if (scheduled.generation === fileAssociationSyncGenerationRef.current) {
          setFileAssociationResult(result);
          setFileAssociationError(null);
        }
      } catch (error: unknown) {
        if (scheduled.generation === fileAssociationSyncGenerationRef.current) {
          setFileAssociationError(
            errorMessage(error, "Failed to synchronize file associations."),
          );
        }
      }
    },
    [],
  );

  const syncPersistedFileAssociations = useCallback(async () => {
    const scheduled = scheduleFileAssociationSync();
    if (scheduled) await applyFileAssociationSync(scheduled);
  }, [applyFileAssociationSync, scheduleFileAssociationSync]);

  useEffect(() => {
    if (!isTauri || !hasPersistedSettings) return;
    const scheduled =
      initialFileAssociationSyncRef.current ?? scheduleFileAssociationSync();
    if (!scheduled) return;
    initialFileAssociationSyncRef.current = scheduled;
    let active = true;
    void scheduled.promise.then(
      (result) => {
        if (
          active &&
          scheduled.generation === fileAssociationSyncGenerationRef.current
        ) {
          setFileAssociationResult(result);
          setFileAssociationError(null);
        }
      },
      (error: unknown) => {
        if (
          active &&
          scheduled.generation === fileAssociationSyncGenerationRef.current
        ) {
          setFileAssociationError(
            errorMessage(error, "Failed to synchronize file associations."),
          );
        }
      },
    );
    return () => {
      active = false;
    };
  }, [hasPersistedSettings, isTauri, scheduleFileAssociationSync]);

  const handleChangeLanguage = (language: LanguagePreference) =>
    enqueueSettingsMutation(async (current) => {
      if (!current) return;
      try {
        await persistSettings(current, (settings) => ({
          ...settings,
          language,
        }));
        setSettingsError(null);
      } catch (error: unknown) {
        setSettingsError(
          errorMessage(error, "Failed to save language setting."),
        );
      }
    });

  const handleToggleAutoCheckForUpdates = () =>
    enqueueSettingsMutation(async (current) => {
      if (!current) return;
      try {
        await persistSettings(current, (settings) => ({
          ...settings,
          autoCheckForUpdates: !settings.autoCheckForUpdates,
        }));
        setSettingsError(null);
      } catch (error: unknown) {
        setSettingsError(
          errorMessage(error, "Failed to update auto-update setting."),
        );
      }
    });

  const handleToggleFileAssociations = () =>
    enqueueSettingsMutation(async (current) => {
      if (!current) return;
      try {
        await persistSettings(current, (settings) => ({
          ...settings,
          fileAssociationsEnabled: !settings.fileAssociationsEnabled,
        }));
        setSettingsError(null);
      } catch (error: unknown) {
        setSettingsError(
          errorMessage(error, "Failed to update file association setting."),
        );
        return;
      }
      await syncPersistedFileAssociations();
    });

  const handleToggleOptionalLoaderPack = (packId: string) =>
    enqueueSettingsMutation(async (current) => {
      if (!current) return;
      try {
        await persistSettings(current, (settings) => {
          const enabled =
            settings.optionalLoaderPacks[packId]?.enabled !== false;
          return {
            ...settings,
            optionalLoaderPacks: {
              ...settings.optionalLoaderPacks,
              [packId]: { enabled: !enabled },
            },
          };
        });
        setSettingsError(null);
      } catch (error: unknown) {
        setSettingsError(
          errorMessage(error, "Failed to update loader pack setting."),
        );
        return;
      }
      await syncPersistedFileAssociations();
    });

  const mutateOptionalLoaderPack = (
    packId: string,
    enabled: boolean,
    mutateManifest: (packId: string) => Promise<OptionalLoaderPackManifest[]>,
    action: "install" | "remove",
  ) =>
    enqueueSettingsMutation(async (current) => {
      let manifests: OptionalLoaderPackManifest[];
      try {
        manifests = await mutateManifest(packId);
      } catch (error: unknown) {
        setSettingsError(
          errorMessage(error, `Failed to ${action} loader pack.`),
        );
        return;
      }
      setOptionalLoaderManifests(manifests);

      let persistenceError: unknown = null;
      if (current) {
        try {
          await persistSettings(current, (settings) => ({
            ...settings,
            optionalLoaderPacks: {
              ...settings.optionalLoaderPacks,
              [packId]: { enabled },
            },
          }));
        } catch (error: unknown) {
          persistenceError = error;
        }
      }

      await syncPersistedFileAssociations();
      if (persistenceError) {
        const completedAction = action === "install" ? "installed" : "removed";
        const detail = errorMessage(
          persistenceError,
          "The updated loader pack setting could not be saved.",
        );
        setSettingsError(
          `Loader pack was ${completedAction}, but its setting could not be saved: ${detail}`,
        );
      } else {
        setSettingsError(null);
      }
    });

  const handleInstallOptionalLoaderPack = (packId: string) =>
    mutateOptionalLoaderPack(
      packId,
      true,
      installOptionalLoaderPack,
      "install",
    );

  const handleRemoveOptionalLoaderPack = (packId: string) =>
    mutateOptionalLoaderPack(packId, false, removeOptionalLoaderPack, "remove");

  const handleSaveUpdateSettings = ({
    endpoint,
    publicKey,
    allowInsecure,
  }: {
    endpoint: string;
    publicKey: string;
    allowInsecure: boolean;
  }) =>
    enqueueSettingsMutation(async (current) => {
      if (!current) return;
      try {
        await persistSettings(current, (settings) => ({
          ...settings,
          updateEndpointOverride: endpoint.trim() || null,
          updatePublicKeyOverride: publicKey.trim() || null,
          allowInsecureUpdateEndpoint: allowInsecure,
        }));
        setSettingsError(null);
        await refreshUpdateConfiguration();
      } catch (error: unknown) {
        setUpdateError(errorMessage(error, "Failed to save updater settings."));
      }
    });

  const handleOpenDefaultAppsSettings = async () => {
    if (!isTauri) return;
    try {
      await openDefaultAppsSettings();
    } catch (error: unknown) {
      setFileAssociationError(
        errorMessage(error, "Failed to open Windows Default Apps settings."),
      );
    }
  };

  return {
    fileAssociationError,
    fileAssociationResult,
    fileAssociationsAvailable:
      isTauri &&
      (fileAssociationResult?.supported === true ||
        (fileAssociationResult === null && fileAssociationError !== null)),
    handleOpenDefaultAppsSettings,
    handleRetryFileAssociations: syncPersistedFileAssociations,
    handleSaveUpdateSettings,
    handleInstallOptionalLoaderPack,
    handleRemoveOptionalLoaderPack,
    handleChangeLanguage,
    handleToggleAutoCheckForUpdates,
    handleToggleFileAssociations,
    handleToggleOptionalLoaderPack,
  };
}
