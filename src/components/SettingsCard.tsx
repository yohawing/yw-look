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
  onToggleFileAssociations: () => void;
  /** #26: flips `autoCheckForUpdates` and persists via save_settings. */
  onToggleAutoCheckForUpdates: () => void;
  onToggleOptionalLoaderPack: (packId: string) => void;
};

function formatOptionalLoaderPackSource(
  pack: OptionalLoaderPackStatus,
): string {
  if (pack.manifestInstalled && pack.version) {
    return `Managed ${pack.version}`;
  }
  if (pack.manifestInstalled) {
    return "Managed";
  }
  if (pack.runtimeAvailable) {
    return "Bundled";
  }
  return "Not installed";
}

export function SettingsCard({
  settingsPayload,
  settingsError,
  optionalLoaderPacks = [],
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
        {optionalLoaderPacks.length > 0 ? (
          <div className="yl-kv">
            {optionalLoaderPacks.map((pack) => (
              <FieldRow
                className="yl-kv-row"
                controlClassName="yl-kv-value optional-loader-pack-value"
                key={pack.id}
                label={pack.name}
                labelClassName="yl-kv-key"
              >
                <span
                  className={`optional-loader-pack-status ${
                    pack.installed
                      ? pack.enabled
                        ? "is-installed"
                        : "is-disabled"
                      : "is-missing"
                  }`}
                >
                  {pack.installed
                    ? pack.enabled
                      ? "Enabled"
                      : "Disabled"
                    : "Missing"}
                </span>
                <ToggleSwitch
                  aria-label={`${pack.name} loader pack`}
                  checked={pack.installed && pack.enabled}
                  disabled={!pack.installed}
                  onCheckedChange={() => onToggleOptionalLoaderPack(pack.id)}
                  size="sm"
                />
                <span className="optional-loader-pack-extensions">
                  {pack.extensions
                    .map((extension) => `.${extension}`)
                    .join(" ")}
                </span>
                <span className="optional-loader-pack-source">
                  {formatOptionalLoaderPackSource(pack)}
                </span>
              </FieldRow>
            ))}
          </div>
        ) : (
          <SidebarEmpty>No optional loader packs registered.</SidebarEmpty>
        )}
      </SidebarSection>
    </>
  );
}
