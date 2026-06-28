import { useCallback, useEffect, useRef, useState } from "react";
/* eslint-disable react-hooks/set-state-in-effect -- deferred data effects intentionally reset state synchronously */
import {
  loadDiagnosticsSnapshot,
  loadProcessMemoryMetrics,
  logDiagnosticEvent,
  type DiagnosticsPayload,
  type ProcessMemoryMetrics,
  type ResourceDiagnosticsSnapshot,
} from "../lib/diagnostics";
import { type SelectedFile } from "../lib/files";
import {
  loadSupportedExtensions,
  type IntegrationPayload,
} from "../lib/integrations";
import { loadRecentFiles, type RecentFilesPayload } from "../lib/recentFiles";
import { loadSettings, type SettingsPayload } from "../lib/settings";
import { errorMessage } from "../lib/invokeSafe";

export function useDeferredData(
  isTauri: boolean,
  shouldLoadRecentFiles: boolean,
  shouldLoadDeferredData: boolean,
  currentFile: SelectedFile | null,
  resourceDiagnostics: ResourceDiagnosticsSnapshot | null,
) {
  const [settingsPayload, setSettingsPayload] =
    useState<SettingsPayload | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [recentFilesPayload, setRecentFilesPayload] =
    useState<RecentFilesPayload | null>(null);
  const [recentFilesError, setRecentFilesError] = useState<string | null>(null);
  const [diagnosticsPayload, setDiagnosticsPayload] =
    useState<DiagnosticsPayload | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [processMemoryMetrics, setProcessMemoryMetrics] =
    useState<ProcessMemoryMetrics | null>(null);
  const [integrationPayload, setIntegrationPayload] =
    useState<IntegrationPayload | null>(null);
  const [integrationError, setIntegrationError] = useState<string | null>(null);

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

  const refreshDiagnosticsRef = useRef(async () => {
    try {
      const payload = await loadDiagnosticsSnapshot();
      setDiagnosticsPayload(payload);
      setDiagnosticsError(null);
    } catch (error: unknown) {
      setDiagnosticsError(
        errorMessage(error, "Failed to load diagnostics snapshot."),
      );
    }
  });

  useEffect(() => {
    if (!shouldLoadDeferredData) return;
    void refreshDiagnosticsRef.current();
  }, [shouldLoadDeferredData]);

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
      void refreshDiagnosticsRef.current();
    },
    [],
  );

  const refreshProcessMemoryRef = useRef(async () => {
    if (!isTauri) {
      setProcessMemoryMetrics(null);
      return;
    }
    try {
      const metrics = await loadProcessMemoryMetrics();
      setProcessMemoryMetrics(metrics);
    } catch {
      setProcessMemoryMetrics(null);
    }
  });

  useEffect(() => {
    if (!isTauri) {
      setProcessMemoryMetrics(null);
      return;
    }

    void refreshProcessMemoryRef.current();
    const interval = window.setInterval(() => {
      void refreshProcessMemoryRef.current();
    }, 2000);
    return () => {
      window.clearInterval(interval);
    };
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri || !resourceDiagnostics) return;
    void refreshProcessMemoryRef.current();
  }, [isTauri, resourceDiagnostics]);

  useEffect(() => {
    if (!shouldLoadDeferredData) return;

    let isActive = true;

    loadSupportedExtensions()
      .then((payload) => {
        if (!isActive) return;
        setIntegrationPayload(payload);
        setIntegrationError(null);
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        setIntegrationError(
          errorMessage(error, "Failed to load Windows integration details."),
        );
      });

    return () => {
      isActive = false;
    };
  }, [
    settingsPayload?.settings.fileAssociationsEnabled,
    settingsPayload?.settings.optionalLoaderPacks,
    shouldLoadDeferredData,
  ]);

  return {
    settingsPayload,
    settingsError,
    setSettingsPayload,
    setSettingsError,
    recentFilesPayload,
    recentFilesError,
    setRecentFilesError,
    diagnosticsPayload,
    diagnosticsError,
    processMemoryMetrics,
    integrationPayload,
    integrationError,
    logDiagnosticEventAndRefresh,
  };
}
