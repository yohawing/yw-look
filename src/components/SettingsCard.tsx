import type { SettingsPayload } from "../lib/settings";
import {
  SidebarEmpty,
  SidebarError,
  SidebarSection,
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

  return (
    <>
      <SidebarSection title="Integration">
        <div className="yl-kv">
          <FieldRow
            className="yl-kv-row"
            controlClassName="yl-kv-value"
            label="File associations"
            labelClassName="yl-kv-key"
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
            className="yl-kv-row"
            controlClassName="yl-kv-value"
            label="Auto-check updates"
            labelClassName="yl-kv-key"
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
