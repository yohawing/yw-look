import type { SettingsPayload } from "../lib/settings";
import {
  SidebarEmpty,
  SidebarError,
  SidebarKeyValueRows,
  SidebarSection,
  type SidebarKeyValueRow,
} from "./sidebarPrimitives";
import { FieldRow } from "./ui/FieldRow";
import { ToggleSwitch } from "./ui/ToggleSwitch";

type SettingsCardProps = {
  settingsPayload: SettingsPayload | null;
  settingsError: string | null;
  onToggleFileAssociations: () => void;
  /** #26: flips `autoCheckForUpdates` and persists via save_settings. */
  onToggleAutoCheckForUpdates: () => void;
};

export function SettingsCard({
  settingsPayload,
  settingsError,
  onToggleFileAssociations,
  onToggleAutoCheckForUpdates,
}: SettingsCardProps) {
  if (settingsError) {
    return (
      <SidebarSection title="Local Settings">
        <SidebarError>{settingsError}</SidebarError>
      </SidebarSection>
    );
  }

  if (!settingsPayload) {
    return (
      <SidebarSection title="Local Settings">
        <SidebarEmpty>Loading settings.</SidebarEmpty>
      </SidebarSection>
    );
  }

  const configRows: SidebarKeyValueRow[] = [
    {
      id: "schema",
      label: "Schema version",
      value: settingsPayload.settings.version,
      mono: true,
    },
    {
      id: "recent",
      label: "Recent files limit",
      value: settingsPayload.settings.recentFilesLimit,
      mono: true,
    },
    {
      id: "log",
      label: "Log level",
      value: settingsPayload.settings.diagnosticsLogLevel,
      tone: "muted",
    },
  ];

  return (
    <>
      <SidebarSection title="Local Settings">
        <p className="sidebar-path">{settingsPayload.settingsPath}</p>
        <SidebarKeyValueRows rows={configRows} />
      </SidebarSection>
      <SidebarSection title="Integration">
        <div className="sidebar-kv">
          <FieldRow
            className="sidebar-kv-row"
            controlClassName="sidebar-kv-value"
            label="File associations"
            labelClassName="sidebar-kv-key"
          >
            <span
              className={`settings-switch ${
                settingsPayload.settings.fileAssociationsEnabled ? "is-on" : ""
              }`}
            >
              <span className="settings-switch-label">
                {settingsPayload.settings.fileAssociationsEnabled
                  ? "Enabled"
                  : "Disabled"}
              </span>
              <ToggleSwitch
                aria-label="File associations"
                checked={settingsPayload.settings.fileAssociationsEnabled}
                onCheckedChange={() => onToggleFileAssociations()}
                size="sm"
              />
            </span>
          </FieldRow>
          <FieldRow
            className="sidebar-kv-row"
            controlClassName="sidebar-kv-value"
            label="Auto-check updates"
            labelClassName="sidebar-kv-key"
          >
            <span
              className={`settings-switch ${
                settingsPayload.settings.autoCheckForUpdates ? "is-on" : ""
              }`}
            >
              <span className="settings-switch-label">
                {settingsPayload.settings.autoCheckForUpdates ? "On" : "Off"}
              </span>
              <ToggleSwitch
                aria-label="Auto-check updates"
                checked={settingsPayload.settings.autoCheckForUpdates}
                onCheckedChange={() => onToggleAutoCheckForUpdates()}
                size="sm"
              />
            </span>
          </FieldRow>
        </div>
      </SidebarSection>
    </>
  );
}
