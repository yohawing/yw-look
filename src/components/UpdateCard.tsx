import { useState } from "react";
import type {
  UpdateCheckPayload,
  UpdateConfigurationPayload,
} from "../lib/updater";
import {
  SidebarEmpty,
  SidebarError,
  SidebarKeyValueRows,
  SidebarSection,
  type SidebarKeyValueRow,
} from "./sidebarPrimitives";

type UpdateDraft = {
  endpoint: string;
  publicKey: string;
  allowInsecure: boolean;
};

type UpdateCardProps = {
  updateConfiguration: UpdateConfigurationPayload | null;
  updateError: string | null;
  updateCheck: UpdateCheckPayload | null;
  isCheckingForUpdate: boolean;
  isInstallingUpdate: boolean;
  onCheckForUpdate: () => void;
  onInstallUpdate: () => void;
  onSaveOverride: (draft: UpdateDraft) => void;
};

export function UpdateCard({
  updateConfiguration,
  updateError,
  updateCheck,
  isCheckingForUpdate,
  isInstallingUpdate,
  onCheckForUpdate,
  onInstallUpdate,
  onSaveOverride,
}: UpdateCardProps) {
  const [draft, setDraft] = useState<UpdateDraft>({
    endpoint: "",
    publicKey: "",
    allowInsecure: false,
  });

  const hasUpdate = Boolean(updateCheck?.update);
  const updateState = updateError
    ? "failed"
    : isInstallingUpdate
      ? "installing"
      : isCheckingForUpdate
        ? "checking"
        : updateCheck?.update
          ? "available"
          : updateCheck
            ? "up-to-date"
            : "idle";
  const updateStateText = {
    failed: "Update check failed",
    installing: "Installing update",
    checking: "Checking for updates",
    available: "Update available",
    "up-to-date": "Up to date",
    idle: "Ready to check",
  }[updateState];
  const configRows: SidebarKeyValueRow[] = updateConfiguration
    ? [
        {
          id: "version",
          label: "Version",
          value: updateConfiguration.currentVersion,
          mono: true,
        },
        {
          id: "endpoint",
          label: "Endpoint",
          value: updateConfiguration.effectiveEndpoint ?? "not configured",
          mono: true,
          tone: updateConfiguration.effectiveEndpoint ? "default" : "muted",
        },
        {
          id: "public-key",
          label: "Public key",
          value: updateConfiguration.effectivePubkeyAvailable
            ? "Configured"
            : "Missing",
          tone: updateConfiguration.effectivePubkeyAvailable ? "ok" : "warn",
        },
        {
          id: "source",
          label: "Source",
          value:
            updateConfiguration.usingOverrideEndpoint ||
            updateConfiguration.usingOverridePubkey
              ? "Local override"
              : "Bundled",
          tone: "muted",
        },
      ]
    : [];

  const updateRows: SidebarKeyValueRow[] = updateCheck?.update
    ? [
        {
          id: "current",
          label: "Current",
          value: updateCheck.update.currentVersion,
          mono: true,
          tone: "muted",
        },
        {
          id: "available",
          label: "Available",
          value: updateCheck.update.version,
          mono: true,
        },
        { id: "target", label: "Target", value: updateCheck.update.target },
        {
          id: "download-url",
          label: "Download",
          value: updateCheck.update.downloadUrl,
          mono: true,
        },
        ...(updateCheck.update.pubDate
          ? [
              {
                id: "published",
                label: "Published",
                value: updateCheck.update.pubDate,
                tone: "muted" as const,
              },
            ]
          : []),
      ]
    : [];
  const statusRows: SidebarKeyValueRow[] = [
    {
      id: "state",
      label: "State",
      value: updateStateText,
      tone:
        updateState === "available"
          ? "warn"
          : updateState === "failed"
            ? "danger"
            : updateState === "up-to-date"
              ? "ok"
              : "muted",
    },
    ...(updateCheck?.update
      ? [
          {
            id: "version-path",
            label: "Version",
            value: `${updateCheck.update.currentVersion} -> ${updateCheck.update.version}`,
            mono: true,
          } satisfies SidebarKeyValueRow,
        ]
      : []),
  ];

  return (
    <>
      <SidebarSection title="App Updates">
        {updateError ? <SidebarError>{updateError}</SidebarError> : null}
        <SidebarKeyValueRows rows={statusRows} />
        {updateConfiguration ? (
          <SidebarKeyValueRows rows={configRows} />
        ) : (
          <SidebarEmpty>Loading updater configuration.</SidebarEmpty>
        )}
      </SidebarSection>

      <SidebarSection title="Local override">
        <div className="sidebar-form">
          <label className="text-control">
            <span>Update feed URL</span>
            <input
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  endpoint: event.target.value,
                }))
              }
              placeholder="http://127.0.0.1:8765/latest.json"
              type="text"
              value={draft.endpoint}
            />
          </label>

          <label className="text-control">
            <span>Updater public key</span>
            <textarea
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  publicKey: event.target.value,
                }))
              }
              placeholder="Paste PEM public key for local update signing."
              rows={4}
              value={draft.publicKey}
            />
          </label>

          <label className="checkbox-control">
            <input
              checked={draft.allowInsecure}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  allowInsecure: event.target.checked,
                }))
              }
              type="checkbox"
            />
            <span>Allow HTTP on localhost</span>
          </label>

          <div className="card-actions">
            <button
              className="btn-ghost"
              onClick={() => onSaveOverride(draft)}
              type="button"
            >
              Save
            </button>
            <button
              className="btn-ghost"
              onClick={onCheckForUpdate}
              type="button"
            >
              {isCheckingForUpdate ? "Checking..." : "Check for Updates"}
            </button>
            <button
              className="btn-primary"
              disabled={!hasUpdate || isInstallingUpdate}
              onClick={onInstallUpdate}
              type="button"
            >
              {isInstallingUpdate ? "Installing..." : "Install Update"}
            </button>
          </div>
        </div>
      </SidebarSection>

      {updateCheck?.update ? (
        <SidebarSection
          title="Available update"
          count={updateCheck.update.version}
        >
          <SidebarKeyValueRows rows={updateRows} />
          {updateCheck.update.notes ? (
            <pre className="log-preview">{updateCheck.update.notes}</pre>
          ) : null}
          <div className="card-actions">
            <button
              className="btn-primary"
              disabled={isInstallingUpdate}
              onClick={onInstallUpdate}
              type="button"
            >
              {isInstallingUpdate ? "Installing..." : "Install Update"}
            </button>
          </div>
        </SidebarSection>
      ) : updateCheck ? (
        <SidebarSection title="Available update">
          <SidebarEmpty>No newer update available.</SidebarEmpty>
        </SidebarSection>
      ) : null}
    </>
  );
}
