import { t, useLocale } from "../lib/i18n";
import { version as packageVersion } from "../../package.json";
import type {
  UpdateCheckPayload,
  UpdateConfigurationPayload,
} from "../lib/updater";
import { isUpdaterConfigured } from "../lib/updater";
import { FieldRow } from "./ui/FieldRow";
import { ToggleSwitch } from "./ui/ToggleSwitch";
import { Button } from "./ui/Button";
import {
  SidebarEmpty,
  SidebarError,
  SidebarKeyValueRows,
  SidebarSection,
  type SidebarKeyValueRow,
} from "../lib/sidebarPrimitives";

type UpdateCardProps = {
  autoCheckForUpdates: boolean | null;
  onToggleAutoCheckForUpdates: () => void;
  updateConfiguration: UpdateConfigurationPayload | null;
  updateError: string | null;
  updateCheck: UpdateCheckPayload | null;
  isCheckingForUpdate: boolean;
  isInstallingUpdate: boolean;
  onCheckForUpdate: () => void;
  onInstallUpdate: () => void;
};

export function UpdateCard({
  autoCheckForUpdates,
  onToggleAutoCheckForUpdates,
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
            id: "available-version",
            label: t("available"),
            value: updateCheck.update.version,
            mono: true,
          } satisfies SidebarKeyValueRow,
        ]
      : []),
  ];

  return (
    <SidebarSection title={t("app_updates")}>
      <div className="yl-kv">
        <FieldRow
          className="yl-kv-row"
          controlClassName="yl-kv-value"
          label={t("auto_check_updates")}
          labelClassName="yl-kv-key"
        >
          <ToggleSwitch
            aria-label={t("auto_check_updates")}
            checked={autoCheckForUpdates ?? false}
            disabled={autoCheckForUpdates === null}
            onCheckedChange={onToggleAutoCheckForUpdates}
            size="sm"
          />
        </FieldRow>
      </div>
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
            disabled={!configured || isCheckingForUpdate || isInstallingUpdate}
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
  );
}
