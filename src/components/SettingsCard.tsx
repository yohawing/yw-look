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
      {fileAssociationsAvailable &&
      fileAssociationResult?.supported !== false ? (
        <SidebarSection title="File Associations">
          {fileAssociationError ? (
            <SidebarError>{fileAssociationError}</SidebarError>
          ) : null}
          <div className="yl-kv">
            <FieldRow
              className="yl-kv-row"
              controlClassName="yl-kv-value"
              label="Offer enabled formats as Windows app candidates"
              labelClassName="yl-kv-key"
            >
              <ToggleSwitch
                aria-label="Offer enabled formats as Windows app candidates"
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
            Open Windows Default Apps
          </Button>
          {fileAssociationError ? (
            <Button
              onClick={() => onRetryFileAssociations?.()}
              size="sm"
              variant="subtle"
            >
              Retry File Associations
            </Button>
          ) : null}
        </SidebarSection>
      ) : null}
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
