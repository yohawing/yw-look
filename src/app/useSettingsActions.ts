import {
  installOptionalLoaderPack,
  removeOptionalLoaderPack,
  type OptionalLoaderPackManifest,
} from "../lib/loaderPacks";
import { saveSettings, type SettingsPayload } from "../lib/settings";
import { errorMessage } from "../lib/invokeSafe";

type UseSettingsActionsOptions = {
  refreshUpdateConfiguration: () => Promise<void>;
  setSettingsError: (error: string | null) => void;
  setOptionalLoaderManifests: (manifests: OptionalLoaderPackManifest[]) => void;
  setSettingsPayload: (payload: SettingsPayload | null) => void;
  setUpdateError: (error: string | null) => void;
  settingsPayload: SettingsPayload | null;
};

export function useSettingsActions({
  refreshUpdateConfiguration,
  setSettingsError,
  setOptionalLoaderManifests,
  setSettingsPayload,
  setUpdateError,
  settingsPayload,
}: UseSettingsActionsOptions) {
  const handleToggleFileAssociations = async () => {
    if (!settingsPayload) {
      return;
    }

    try {
      const nextPayload = await saveSettings({
        ...settingsPayload.settings,
        fileAssociationsEnabled:
          !settingsPayload.settings.fileAssociationsEnabled,
      });
      setSettingsPayload(nextPayload);
      setSettingsError(null);
    } catch (error: unknown) {
      setSettingsError(
        error instanceof Error
          ? error.message
          : "Failed to update file association setting.",
      );
    }
  };

  const handleToggleAutoCheckForUpdates = async () => {
    if (!settingsPayload) {
      return;
    }

    try {
      const nextPayload = await saveSettings({
        ...settingsPayload.settings,
        autoCheckForUpdates: !settingsPayload.settings.autoCheckForUpdates,
      });
      setSettingsPayload(nextPayload);
      setSettingsError(null);
    } catch (error: unknown) {
      setSettingsError(
        error instanceof Error
          ? error.message
          : "Failed to update auto-update setting.",
      );
    }
  };

  const handleToggleOptionalLoaderPack = async (packId: string) => {
    if (!settingsPayload) {
      return;
    }

    const current =
      settingsPayload.settings.optionalLoaderPacks[packId]?.enabled !== false;

    try {
      const nextPayload = await saveSettings({
        ...settingsPayload.settings,
        optionalLoaderPacks: {
          ...settingsPayload.settings.optionalLoaderPacks,
          [packId]: { enabled: !current },
        },
      });
      setSettingsPayload(nextPayload);
      setSettingsError(null);
    } catch (error: unknown) {
      setSettingsError(
        error instanceof Error
          ? error.message
          : "Failed to update loader pack setting.",
      );
    }
  };

  const handleInstallOptionalLoaderPack = async (packId: string) => {
    try {
      const manifests = await installOptionalLoaderPack(packId);
      setOptionalLoaderManifests(manifests);
      setSettingsError(null);
    } catch (error: unknown) {
      setSettingsError(errorMessage(error, "Failed to install loader pack."));
    }
  };

  const handleRemoveOptionalLoaderPack = async (packId: string) => {
    try {
      const manifests = await removeOptionalLoaderPack(packId);
      setOptionalLoaderManifests(manifests);
      setSettingsError(null);
    } catch (error: unknown) {
      setSettingsError(errorMessage(error, "Failed to remove loader pack."));
    }
  };

  const handleSaveUpdateSettings = async ({
    endpoint,
    publicKey,
    allowInsecure,
  }: {
    endpoint: string;
    publicKey: string;
    allowInsecure: boolean;
  }) => {
    if (!settingsPayload) {
      return;
    }

    try {
      const nextPayload = await saveSettings({
        ...settingsPayload.settings,
        updateEndpointOverride: endpoint.trim() || null,
        updatePublicKeyOverride: publicKey.trim() || null,
        allowInsecureUpdateEndpoint: allowInsecure,
      });
      setSettingsPayload(nextPayload);
      setSettingsError(null);
      await refreshUpdateConfiguration();
    } catch (error: unknown) {
      setUpdateError(errorMessage(error, "Failed to save updater settings."));
    }
  };

  return {
    handleSaveUpdateSettings,
    handleInstallOptionalLoaderPack,
    handleRemoveOptionalLoaderPack,
    handleToggleAutoCheckForUpdates,
    handleToggleFileAssociations,
    handleToggleOptionalLoaderPack,
  };
}
