import type {
  UpdateCheckPayload,
  UpdateConfigurationPayload,
} from "../lib/updater";
import { Button } from "./ui/Button";
import {
  SidebarEmpty,
  SidebarError,
  SidebarKeyValueRows,
  SidebarSection,
  type SidebarKeyValueRow,
} from "../lib/sidebarPrimitives";

type UpdateCardProps = {
  updateConfiguration: UpdateConfigurationPayload | null;
  updateError: string | null;
  updateCheck: UpdateCheckPayload | null;
  isCheckingForUpdate: boolean;
  isInstallingUpdate: boolean;
  onCheckForUpdate: () => void;
  onInstallUpdate: () => void;
};

export function UpdateCard({
  updateConfiguration,
  updateError,
  updateCheck,
  isCheckingForUpdate,
  isInstallingUpdate,
  onCheckForUpdate,
  onInstallUpdate,
}: UpdateCardProps) {
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
          <div className="card-actions">
            <Button variant="ghost" size="sm" onClick={onCheckForUpdate}>
              {isCheckingForUpdate ? "Checking..." : "Check for Updates"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!hasUpdate || isInstallingUpdate}
              onClick={onInstallUpdate}
            >
              {isInstallingUpdate ? "Installing..." : "Install Update"}
            </Button>
          </div>
        ) : (
          <SidebarEmpty>Loading updater configuration.</SidebarEmpty>
        )}
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
            <Button
              variant="primary"
              size="sm"
              disabled={isInstallingUpdate}
              onClick={onInstallUpdate}
            >
              {isInstallingUpdate ? "Installing..." : "Install Update"}
            </Button>
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
