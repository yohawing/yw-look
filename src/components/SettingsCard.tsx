import {
  projectLicense,
  projectName,
  projectVersion,
  runtimeLicenseAttributions,
  type LicenseAttribution,
} from "../generated/licenseAttributions";
import type { SettingsPayload } from "../lib/settings";
import type { OptionalLoaderPackStatus } from "../viewer";
import {
  SidebarEmpty,
  SidebarError,
  SidebarKeyValueRows,
  SidebarSection,
  type SidebarKeyValueRow,
} from "../lib/sidebarPrimitives";
import { FieldRow } from "./ui/FieldRow";
import { ToggleSwitch } from "./ui/ToggleSwitch";

const aboutRows: readonly SidebarKeyValueRow[] = [
  {
    id: "about-application",
    label: "Application",
    value: projectName,
  },
  {
    id: "about-version",
    label: "Version",
    value: projectVersion,
    mono: true,
  },
  {
    id: "about-license",
    label: "License",
    value: projectLicense,
  },
];

function formatAttributionLabel(attribution: LicenseAttribution) {
  return `${attribution.source === "native" ? "Native" : "Web"}: ${attribution.name}`;
}

function formatAttributionValue(attribution: LicenseAttribution) {
  return `${attribution.license} @ ${attribution.version}`;
}

const dependencyLicenseRows: readonly SidebarKeyValueRow[] =
  runtimeLicenseAttributions.map((attribution) => ({
    id: `dependency-license-${attribution.name}`,
    label: formatAttributionLabel(attribution),
    value: formatAttributionValue(attribution),
    mono: true,
  }));

function AboutSection() {
  return (
    <SidebarSection title="About" collapsible defaultOpen>
      <SidebarKeyValueRows rows={aboutRows} />
      <SidebarKeyValueRows rows={dependencyLicenseRows} />
    </SidebarSection>
  );
}

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
      <>
        <SidebarSection title="Local Settings">
          <SidebarError>{settingsError}</SidebarError>
        </SidebarSection>
        <AboutSection />
      </>
    );
  }

  if (!settingsPayload) {
    return (
      <>
        <SidebarSection title="Local Settings">
          <SidebarEmpty>Loading settings.</SidebarEmpty>
        </SidebarSection>
        <AboutSection />
      </>
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
      <AboutSection />
    </>
  );
}
