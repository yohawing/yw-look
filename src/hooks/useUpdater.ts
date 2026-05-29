import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkForUpdate,
  installPendingUpdate,
  loadUpdateConfiguration,
  type UpdateCheckPayload,
  type UpdateConfigurationPayload,
} from "../lib/updater";
import type { SettingsPayload } from "../lib/settings";
import { errorMessage } from "../lib/invokeSafe";

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

    void refreshUpdateConfiguration();
  }, [shouldLoadDeferredData, refreshUpdateConfiguration]);

  const handleCheckForUpdate = useCallback(async () => {
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
  }, []);

  const autoUpdateCheckedRef = useRef(false);
  useEffect(() => {
    if (autoUpdateCheckedRef.current) return;
    if (!settingsPayload?.settings.autoCheckForUpdates) return;
    autoUpdateCheckedRef.current = true;
    void handleCheckForUpdate();
  }, [settingsPayload?.settings.autoCheckForUpdates, handleCheckForUpdate]);

  const handleInstallUpdate = useCallback(async () => {
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
  }, []);

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
