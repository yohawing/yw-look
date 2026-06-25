import { saveSettings, type SettingsPayload } from "../lib/settings";
import { errorMessage } from "../lib/invokeSafe";

type UseSettingsActionsOptions = {
  refreshUpdateConfiguration: () => Promise<void>;
  setSettingsError: (error: string | null) => void;
  setSettingsPayload: (payload: SettingsPayload | null) => void;
  setUpdateError: (error: string | null) => void;
  settingsPayload: SettingsPayload | null;
};

export function useSettingsActions({
  refreshUpdateConfiguration,
  setSettingsError,
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
    handleToggleAutoCheckForUpdates,
    handleToggleFileAssociations,
  };
}
