import { useCallback, useEffect, useState } from "react";
import { logDiagnosticEvent } from "../lib/diagnostics";
import { type SelectedFile } from "../lib/files";
import {
  loadOptionalLoaderManifests,
  type OptionalLoaderPackManifest,
} from "../lib/loaderPacks";
import { loadRecentFiles, type RecentFilesPayload } from "../lib/recentFiles";
import { loadSettings, type SettingsPayload } from "../lib/settings";
import { errorMessage } from "../lib/errors";

export function useDeferredData(
  isTauri: boolean,
  shouldLoadRecentFiles: boolean,
  shouldLoadDeferredData: boolean,
  currentFile: SelectedFile | null,
) {
  void isTauri;
  const [settingsPayload, setSettingsPayload] =
    useState<SettingsPayload | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [recentFilesPayload, setRecentFilesPayload] =
    useState<RecentFilesPayload | null>(null);
  const [recentFilesError, setRecentFilesError] = useState<string | null>(null);
  const [optionalLoaderManifests, setOptionalLoaderManifests] = useState<
    OptionalLoaderPackManifest[]
  >([]);
  const [optionalLoaderManifestsError, setOptionalLoaderManifestsError] =
    useState<string | null>(null);
  const replaceOptionalLoaderManifests = useCallback(
    (manifests: OptionalLoaderPackManifest[]) => {
      setOptionalLoaderManifests(manifests);
      setOptionalLoaderManifestsError(null);
    },
    [],
  );

  useEffect(() => {
    let isActive = true;

    loadSettings()
      .then((payload) => {
        if (!isActive) return;
        setSettingsPayload(payload);
        setSettingsError(null);
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        setSettingsError(errorMessage(error, "Failed to load settings."));
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!shouldLoadRecentFiles) return;

    let isActive = true;

    loadRecentFiles()
      .then((payload) => {
        if (!isActive) return;
        setRecentFilesPayload(payload);
        setRecentFilesError(null);
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        setRecentFilesError(
          errorMessage(error, "Failed to load recent files."),
        );
      });

    return () => {
      isActive = false;
    };
  }, [currentFile, shouldLoadRecentFiles]);

  const logDiagnosticEventAndRefresh = useCallback(
    async (params: {
      code: string;
      level: string;
      message: string;
      detail?: string | null;
      contextPath?: string | null;
    }) => {
      await logDiagnosticEvent({
        code: params.code,
        level: params.level,
        message: params.message,
        detail: params.detail,
        contextPath: params.contextPath ?? null,
      });
    },
    [],
  );

  useEffect(() => {
    if (!shouldLoadDeferredData) return;

    let isActive = true;

    loadOptionalLoaderManifests()
      .then((manifests) => {
        if (!isActive) return;
        replaceOptionalLoaderManifests(manifests);
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        setOptionalLoaderManifestsError(
          errorMessage(error, "Failed to load optional loader pack manifests."),
        );
        setOptionalLoaderManifests([]);
      });

    return () => {
      isActive = false;
    };
  }, [replaceOptionalLoaderManifests, shouldLoadDeferredData]);

  return {
    settingsPayload,
    settingsError,
    setSettingsPayload,
    setSettingsError,
    recentFilesPayload,
    recentFilesError,
    setRecentFilesError,
    setOptionalLoaderManifests: replaceOptionalLoaderManifests,
    optionalLoaderManifests,
    optionalLoaderManifestsError,
    logDiagnosticEventAndRefresh,
  };
}
