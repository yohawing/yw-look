import { SelectField } from "./ui/SelectField";
import { t, useLocale, type LanguagePreference } from "../lib/i18n";
import type { SettingsPayload } from "../lib/settings";
import type { FileAssociationSyncResult } from "../lib/fileAssociations";
import type { OptionalLoaderPackStatus } from "../viewer";
import {
  SidebarEmpty,
  SidebarError,
  SidebarSection,
} from "../lib/sidebarPrimitives";
import { FieldRow } from "./ui/FieldRow";
import { ToggleSwitch } from "./ui/ToggleSwitch";
import { Button } from "./ui/Button";

type SettingsCardProps = {
  settingsPayload: SettingsPayload | null;
  onChangeLanguage?: (language: LanguagePreference) => void;
  settingsError: string | null;
  optionalLoaderPacks?: readonly OptionalLoaderPackStatus[];
  optionalLoaderPacksError?: string | null;
  fileAssociationResult?: FileAssociationSyncResult | null;
  fileAssociationError?: string | null;
  fileAssociationsAvailable?: boolean;
  /** #26: flips `autoCheckForUpdates` and persists via save_settings. */
  onToggleAutoCheckForUpdates: () => void;
  onToggleFileAssociations?: () => void;
  onToggleOptionalLoaderPack: (packId: string) => void;
  onOpenDefaultAppsSettings?: () => void;
  onRetryFileAssociations?: () => void;
};

function canToggleOptionalLoaderPack(pack: OptionalLoaderPackStatus) {
  return (
    pack.runtimeAvailable &&
    pack.compatibility.state !== "requiresNewerApp" &&
    pack.compatibility.state !== "requiresOlderApp" &&
    pack.compatibility.state !== "unknown" &&
    pack.compatibility.state !== "runtimeMissing"
  );
}

export function SettingsCard({
  settingsPayload,
  onChangeLanguage,
  settingsError,
  optionalLoaderPacks = [],
  optionalLoaderPacksError = null,
  fileAssociationResult = null,
  fileAssociationError = null,
  fileAssociationsAvailable = false,
  onToggleAutoCheckForUpdates,
  onToggleFileAssociations,
  onToggleOptionalLoaderPack,
  onOpenDefaultAppsSettings,
  onRetryFileAssociations,
}: SettingsCardProps) {
  useLocale();
  if (settingsError && !settingsPayload) {
    return (
      <SidebarSection title={t("local_settings")}>
        <SidebarError>{settingsError}</SidebarError>
      </SidebarSection>
    );
  }

  if (!settingsPayload) {
    return (
      <SidebarSection title={t("local_settings")}>
        <SidebarEmpty>{t("loading_settings")}</SidebarEmpty>
      </SidebarSection>
    );
  }

  return (
    <>
      {settingsError ? (
        <SidebarError>
          {t("settings.saveFailed")} {settingsError}
        </SidebarError>
      ) : null}
      <SidebarSection title={t("local_settings")}>
        <FieldRow
          label={t("settings.language")}
          className="yl-kv-row"
          labelClassName="yl-kv-key"
          controlClassName="yl-kv-value"
        >
          <SelectField
            aria-label={t("settings.language")}
            value={settingsPayload.settings.language ?? "system"}
            onChange={(event) =>
              onChangeLanguage?.(event.target.value as LanguagePreference)
            }
          >
            <option value="system">{t("settings.systemLanguage")}</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="zh-Hans">简体中文</option>
            <option value="ko">한국어</option>
          </SelectField>
        </FieldRow>
      </SidebarSection>
      <SidebarSection title={t("update_preferences")}>
        <div className="yl-kv">
          <FieldRow
            className="yl-kv-row"
            controlClassName="yl-kv-value"
            label={t("auto_check_updates")}
            labelClassName="yl-kv-key"
          >
            <ToggleSwitch
              aria-label={t("auto_check_updates")}
              checked={settingsPayload.settings.autoCheckForUpdates}
              onCheckedChange={() => onToggleAutoCheckForUpdates()}
              size="sm"
            />
          </FieldRow>
        </div>
      </SidebarSection>
      {fileAssociationsAvailable &&
      fileAssociationResult?.supported !== false ? (
        <SidebarSection title={t("file_associations")}>
          {fileAssociationError ? (
            <SidebarError>{fileAssociationError}</SidebarError>
          ) : null}
          <div className="yl-kv">
            <FieldRow
              className="yl-kv-row"
              controlClassName="yl-kv-value"
              label={t("offer_enabled_formats_as_windows_app_candidates")}
              labelClassName="yl-kv-key"
            >
              <ToggleSwitch
                aria-label={t(
                  "offer_enabled_formats_as_windows_app_candidates",
                )}
                checked={settingsPayload.settings.fileAssociationsEnabled}
                onCheckedChange={() => onToggleFileAssociations?.()}
                size="sm"
              />
            </FieldRow>
          </div>
          <Button
            onClick={() => onOpenDefaultAppsSettings?.()}
            size="sm"
            variant="subtle"
          >
            {t("open_windows_default_apps")}
          </Button>
          {fileAssociationError ? (
            <Button
              onClick={() => onRetryFileAssociations?.()}
              size="sm"
              variant="subtle"
            >
              {t("retry_file_associations")}
            </Button>
          ) : null}
        </SidebarSection>
      ) : null}
      <SidebarSection title={t("optional_loader_packs")} collapsible>
        {optionalLoaderPacksError ? (
          <SidebarError>{optionalLoaderPacksError}</SidebarError>
        ) : null}
        {optionalLoaderPacks.length > 0 ? (
          <div className="yl-kv">
            {optionalLoaderPacks.map((pack) => (
              <FieldRow
                className="yl-kv-row"
                controlClassName="yl-kv-value"
                key={pack.id}
                label={pack.name}
                labelClassName="yl-kv-key"
              >
                <ToggleSwitch
                  aria-label={`${pack.name} loader pack`}
                  checked={pack.installed && pack.enabled}
                  disabled={!canToggleOptionalLoaderPack(pack)}
                  onCheckedChange={() => onToggleOptionalLoaderPack(pack.id)}
                  size="sm"
                />
              </FieldRow>
            ))}
          </div>
        ) : (
          <SidebarEmpty>
            {t("no_optional_loader_packs_registered")}
          </SidebarEmpty>
        )}
      </SidebarSection>
    </>
  );
}
