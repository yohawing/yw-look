import { t, useLocale } from "../lib/i18n";
import { version as packageVersion } from "../../package.json";
import type {
  UpdateCheckPayload,
  UpdateConfigurationPayload,
} from "../lib/updater";
import { isUpdaterConfigured } from "../lib/updater";
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
  useLocale();
  const configured = isUpdaterConfigured(updateConfiguration);
  const unavailable = updateConfiguration !== null && !configured;
  const hasUpdate = configured && Boolean(updateCheck?.update);
  const updateState = unavailable
    ? "unavailable"
    : updateError
      ? "failed"
      : isInstallingUpdate
        ? "installing"
        : isCheckingForUpdate
          ? "checking"
          : updateCheck?.update
            ? "available"
            : updateCheck
              ? "up-to-date"
              : updateConfiguration
                ? "idle"
                : "loading";
  const updateStateText = t(`update.${updateState}`);
  const updateRows: SidebarKeyValueRow[] = updateCheck?.update
    ? [
        {
          id: "current",
          label: t("current"),
          value: updateCheck.update.currentVersion,
          mono: true,
          tone: "muted",
        },
        {
          id: "available",
          label: t("available"),
          value: updateCheck.update.version,
          mono: true,
        },
        { id: "target", label: t("target"), value: updateCheck.update.target },
        {
          id: "download-url",
          label: t("download"),
          value: updateCheck.update.downloadUrl,
          mono: true,
        },
        ...(updateCheck.update.pubDate
          ? [
              {
                id: "published",
                label: t("published"),
                value: updateCheck.update.pubDate,
                tone: "muted" as const,
              },
            ]
          : []),
      ]
    : [];
  const statusRows: SidebarKeyValueRow[] = [
    {
      id: "current-version",
      label: t("version"),
      value: updateConfiguration?.currentVersion ?? packageVersion,
      mono: true,
    },
    {
      id: "state",
      label: t("state"),
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
    ...(configured && updateCheck?.update
      ? [
          {
            id: "version-path",
            label: t("update"),
            value: `${updateCheck.update.currentVersion} -> ${updateCheck.update.version}`,
            mono: true,
          } satisfies SidebarKeyValueRow,
        ]
      : []),
  ];

  return (
    <>
      <SidebarSection title={t("app_updates")}>
        {updateError && !unavailable ? (
          <SidebarError>{updateError}</SidebarError>
        ) : null}
        <SidebarKeyValueRows rows={statusRows} />
        {unavailable ? (
          <SidebarEmpty>
            {t("update_checks_unavailable_for_this_build")}
          </SidebarEmpty>
        ) : null}
        {updateConfiguration ? (
          <div className="card-actions">
            <Button
              variant="ghost"
              size="sm"
              disabled={
                !configured || isCheckingForUpdate || isInstallingUpdate
              }
              onClick={onCheckForUpdate}
            >
              {isCheckingForUpdate ? t("checking") : t("check_for_updates")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!hasUpdate || isCheckingForUpdate || isInstallingUpdate}
              onClick={onInstallUpdate}
            >
              {isInstallingUpdate ? t("installing") : t("install_update")}
            </Button>
          </div>
        ) : (
          <SidebarEmpty>{t("loading_updater_configuration")}</SidebarEmpty>
        )}
      </SidebarSection>

      {configured && updateCheck?.update ? (
        <SidebarSection
          title={t("available_update")}
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
              disabled={
                !configured || isCheckingForUpdate || isInstallingUpdate
              }
              onClick={onInstallUpdate}
            >
              {isInstallingUpdate ? t("installing") : t("install_update")}
            </Button>
          </div>
        </SidebarSection>
      ) : configured && updateCheck ? (
        <SidebarSection title={t("available_update")}>
          <SidebarEmpty>{t("no_newer_update_available")}</SidebarEmpty>
        </SidebarSection>
      ) : null}
    </>
  );
}
