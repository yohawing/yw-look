import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkForUpdate,
  installPendingUpdate,
  isUpdaterConfigured,
  loadUpdateConfiguration,
  type UpdateCheckPayload,
  type UpdateConfigurationPayload,
} from "../lib/updater";
import type { SettingsPayload } from "../lib/settings";
import { errorMessage } from "../lib/errors";

export function useUpdater(
  shouldLoadDeferredData: boolean,
  settingsPayload: SettingsPayload | null,
) {
  const [updateConfiguration, setUpdateConfiguration] =
    useState<UpdateConfigurationPayload | null>(null);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckPayload | null>(
    null,
  );
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [isCheckingForUpdate, setIsCheckingForUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const canCheckForUpdate = isUpdaterConfigured(updateConfiguration);

  const refreshUpdateConfiguration = useCallback(async () => {
    try {
      const payload = await loadUpdateConfiguration();
      setUpdateConfiguration(payload);
      setUpdateError(null);
    } catch (error: unknown) {
      setUpdateError(
        errorMessage(error, "Failed to load updater configuration."),
      );
    }
  }, []);

  useEffect(() => {
    if (!shouldLoadDeferredData) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- initiates async update configuration load which calls setState in its callbacks; cannot be deferred to render since it triggers a Tauri RPC
    void refreshUpdateConfiguration();
  }, [shouldLoadDeferredData, refreshUpdateConfiguration]);

  const handleCheckForUpdate = useCallback(async () => {
    if (!canCheckForUpdate) return;
    try {
      setIsCheckingForUpdate(true);
      const payload = await checkForUpdate();
      setUpdateCheck(payload);
      setUpdateConfiguration(payload.configuration);
      setUpdateError(null);
    } catch (error: unknown) {
      setUpdateError(errorMessage(error, "Failed to check for updates."));
    } finally {
      setIsCheckingForUpdate(false);
    }
  }, [canCheckForUpdate]);

  const autoUpdateCheckedRef = useRef(false);
  useEffect(() => {
    if (autoUpdateCheckedRef.current) return;
    if (!canCheckForUpdate) return;
    if (!settingsPayload?.settings.autoCheckForUpdates) return;
    autoUpdateCheckedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initiates async update check which calls setState in its callbacks; auto-check must fire once at mount after settings load and cannot be derived during render
    void handleCheckForUpdate();
  }, [
    settingsPayload?.settings.autoCheckForUpdates,
    handleCheckForUpdate,
    canCheckForUpdate,
  ]);

  const handleInstallUpdate = useCallback(async () => {
    if (!canCheckForUpdate || !updateCheck?.update) return;
    try {
      setIsInstallingUpdate(true);
      setUpdateError(
        "Installing update. On Windows, yw-look may close and relaunch before this panel receives a final result.",
      );
      const payload = await installPendingUpdate();
      setUpdateError(payload.note);
      setUpdateCheck(null);
    } catch (error: unknown) {
      setUpdateError(errorMessage(error, "Failed to install update."));
    } finally {
      setIsInstallingUpdate(false);
    }
  }, [canCheckForUpdate, updateCheck?.update]);

  return {
    updateConfiguration,
    updateCheck,
    updateError,
    isCheckingForUpdate,
    isInstallingUpdate,
    setUpdateError,
    refreshUpdateConfiguration,
    handleCheckForUpdate,
    handleInstallUpdate,
  };
}
