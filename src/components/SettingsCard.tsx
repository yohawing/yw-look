import type { SettingsPayload } from "../lib/settings";
import type { OptionalLoaderPackStatus } from "../viewer";
import {
  SidebarEmpty,
  SidebarError,
  SidebarSection,
} from "../lib/sidebarPrimitives";
import { FieldRow } from "./ui/FieldRow";
import { ToggleSwitch } from "./ui/ToggleSwitch";

type SettingsCardProps = {
  settingsPayload: SettingsPayload | null;
  settingsError: string | null;
  optionalLoaderPacks?: readonly OptionalLoaderPackStatus[];
  optionalLoaderPacksError?: string | null;
  /** #26: flips `autoCheckForUpdates` and persists via save_settings. */
  onToggleAutoCheckForUpdates: () => void;
  onToggleOptionalLoaderPack: (packId: string) => void;
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
  settingsError,
  optionalLoaderPacks = [],
  optionalLoaderPacksError = null,
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
      <SidebarSection title="Update Preferences">
        <div className="yl-kv">
          <FieldRow
            className="yl-kv-row"
            controlClassName="yl-kv-value"
            label="Auto-check updates"
            labelClassName="yl-kv-key"
          >
            <ToggleSwitch
              aria-label="Auto-check updates"
              checked={settingsPayload.settings.autoCheckForUpdates}
              onCheckedChange={() => onToggleAutoCheckForUpdates()}
              size="sm"
            />
          </FieldRow>
        </div>
      </SidebarSection>
      <SidebarSection title="Optional Loader Packs" collapsible>
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
          <SidebarEmpty>No optional loader packs registered.</SidebarEmpty>
        )}
      </SidebarSection>
    </>
  );
}
