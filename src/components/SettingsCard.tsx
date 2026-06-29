import type { SettingsPayload } from "../lib/settings";
import type { OptionalLoaderPackStatus } from "../viewer";
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
  optionalLoaderPacks?: readonly OptionalLoaderPackStatus[];
  optionalLoaderPacksError?: string | null;
  onToggleFileAssociations: () => void;
  /** #26: flips `autoCheckForUpdates` and persists via save_settings. */
  onToggleAutoCheckForUpdates: () => void;
  onToggleOptionalLoaderPack: (packId: string) => void;
};

function canToggleOptionalLoaderPack(pack: OptionalLoaderPackStatus) {
  return (
    pack.installed &&
    pack.compatibility.state !== "requiresNewerApp" &&
    pack.compatibility.state !== "requiresOlderApp" &&
    pack.compatibility.state !== "unknown" &&
    pack.compatibility.state !== "runtimeMissing"
  );
}

function formatOptionalLoaderPackStatus(pack: OptionalLoaderPackStatus) {
  if (!pack.installed) {
    return "Missing";
  }
  if (!canToggleOptionalLoaderPack(pack)) {
    return "Blocked";
  }
  return pack.enabled ? "Enabled" : "Disabled";
}

export function SettingsCard({
  settingsPayload,
  settingsError,
  optionalLoaderPacks = [],
  optionalLoaderPacksError = null,
  onToggleFileAssociations,
  onToggleAutoCheckForUpdates,
  onToggleOptionalLoaderPack,
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
      <SidebarSection title="Optional Loader Packs" collapsible>
        {optionalLoaderPacksError ? (
          <SidebarError>{optionalLoaderPacksError}</SidebarError>
        ) : null}
        {optionalLoaderPacks.length > 0 ? (
          <div className="yl-kv">
            {optionalLoaderPacks.map((pack) => {
              const statusLabel = formatOptionalLoaderPackStatus(pack);

              return (
                <FieldRow
                  className="yl-kv-row"
                  controlClassName="yl-kv-value optional-loader-pack-value"
                  key={pack.id}
                  label={pack.name}
                  labelClassName="yl-kv-key"
                >
                  <span
                    className={`optional-loader-pack-status ${
                      pack.installed && canToggleOptionalLoaderPack(pack)
                        ? pack.enabled
                          ? "is-installed"
                          : "is-disabled"
                        : pack.installed
                          ? "is-blocked"
                          : "is-missing"
                    }`}
                  >
                    {statusLabel}
                  </span>
                  <ToggleSwitch
                    aria-label={`${pack.name} loader pack`}
                    checked={pack.installed && pack.enabled}
                    disabled={!canToggleOptionalLoaderPack(pack)}
                    onCheckedChange={() => onToggleOptionalLoaderPack(pack.id)}
                    size="sm"
                  />
                </FieldRow>
              );
            })}
          </div>
        ) : (
          <SidebarEmpty>No optional loader packs registered.</SidebarEmpty>
        )}
      </SidebarSection>
    </>
  );
}
