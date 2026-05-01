import type { SettingsPayload } from "../lib/settings";
import {
  SidebarEmpty,
  SidebarError,
  SidebarKeyValueRows,
  SidebarSection,
  type SidebarKeyValueRow,
} from "./sidebarPrimitives";

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
          <div className="sidebar-kv-row">
            <span className="sidebar-kv-key">File associations</span>
            <span className="sidebar-kv-value">
              <button
                aria-pressed={settingsPayload.settings.fileAssociationsEnabled}
                className={`settings-switch ${
                  settingsPayload.settings.fileAssociationsEnabled
                    ? "is-on"
                    : ""
                }`}
                onClick={onToggleFileAssociations}
                type="button"
              >
                <span className="settings-switch-label">
                  {settingsPayload.settings.fileAssociationsEnabled
                    ? "Enabled"
                    : "Disabled"}
                </span>
                <span className="settings-switch-track" aria-hidden="true" />
              </button>
            </span>
          </div>
          <div className="sidebar-kv-row">
            <span className="sidebar-kv-key">Auto-check updates</span>
            <span className="sidebar-kv-value">
              <button
                aria-pressed={settingsPayload.settings.autoCheckForUpdates}
                className={`settings-switch ${
                  settingsPayload.settings.autoCheckForUpdates ? "is-on" : ""
                }`}
                onClick={onToggleAutoCheckForUpdates}
                type="button"
              >
                <span className="settings-switch-label">
                  {settingsPayload.settings.autoCheckForUpdates ? "On" : "Off"}
                </span>
                <span className="settings-switch-track" aria-hidden="true" />
              </button>
            </span>
          </div>
        </div>
      </SidebarSection>
    </>
  );
}
