import { useState } from "react";
import { loadDiagnosticsSnapshot, openAppLogDir } from "../lib/diagnostics";
import { buildDiagnosticsReport, ISSUE_REPORT_URL } from "../lib/reporting";
import type { SettingsPayload } from "../lib/settings";
import { backendCapabilities } from "../lib/usd";
import type { OptionalLoaderPackStatus } from "../viewer";
import {
  SidebarEmpty,
  SidebarError,
  SidebarSection,
} from "../lib/sidebarPrimitives";
import { Button } from "./ui/Button";
import { FieldRow } from "./ui/FieldRow";
import { ToggleSwitch } from "./ui/ToggleSwitch";
import "../styles/settings.css";

type SettingsCardProps = {
  settingsPayload: SettingsPayload | null;
  settingsError: string | null;
  optionalLoaderPacks?: readonly OptionalLoaderPackStatus[];
  optionalLoaderPacksError?: string | null;
  onToggleFileAssociations: () => void;
  /** #26: flips `autoCheckForUpdates` and persists via save_settings. */
  onToggleAutoCheckForUpdates: () => void;
  onInstallOptionalLoaderPack?: (packId: string) => void;
  onRemoveOptionalLoaderPack?: (packId: string) => void;
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

function formatOptionalLoaderPackStatus(pack: OptionalLoaderPackStatus) {
  if (!pack.runtimeAvailable) {
    return "Missing";
  }
  if (!pack.manifestInstalled) {
    return pack.enabled ? "Bundled" : "Disabled";
  }
  if (!canToggleOptionalLoaderPack(pack)) {
    return "Blocked";
  }
  return pack.enabled ? "Enabled" : "Disabled";
}

function canInstallOptionalLoaderPack(pack: OptionalLoaderPackStatus) {
  return pack.runtimeAvailable && !pack.manifestInstalled;
}

function canRemoveOptionalLoaderPack(pack: OptionalLoaderPackStatus) {
  return pack.manifestInstalled;
}

function confirmRemoveOptionalLoaderPack(pack: OptionalLoaderPackStatus) {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }
  return window.confirm(`Remove ${pack.name}?`);
}

export function SettingsCard({
  settingsPayload,
  settingsError,
  optionalLoaderPacks = [],
  optionalLoaderPacksError = null,
  onToggleFileAssociations,
  onToggleAutoCheckForUpdates,
  onInstallOptionalLoaderPack,
  onRemoveOptionalLoaderPack,
  onToggleOptionalLoaderPack,
}: SettingsCardProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const copyDiagnostics = async () => {
    const diagnostics = await loadDiagnosticsSnapshot();
    const capabilities = await backendCapabilities().catch(() => null);
    const report = buildDiagnosticsReport({
      capabilities,
      diagnostics,
      loaderPacks: optionalLoaderPacks,
    });
    try {
      await navigator.clipboard.writeText(report);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

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
            <span className="u-inline-flex u-items-center u-gap-8">
              <span className="settings-toggle-label">
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
            <span className="u-inline-flex u-items-center u-gap-8">
              <span className="settings-toggle-label">
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
      <SidebarSection title="Support" collapsible>
        <div className="card-actions">
          <Button
            onClick={() => void copyDiagnostics()}
            size="sm"
            variant="ghost"
          >
            {copyState === "copied"
              ? "Copied"
              : copyState === "failed"
                ? "Copy Failed"
                : "Copy Diagnostics"}
          </Button>
          <Button
            onClick={() => void openAppLogDir()}
            size="sm"
            variant="ghost"
          >
            Open Logs
          </Button>
          <Button
            onClick={() => window.open(ISSUE_REPORT_URL, "_blank", "noopener")}
            size="sm"
            variant="ghost"
          >
            Report Issue
          </Button>
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
                      pack.runtimeAvailable && canToggleOptionalLoaderPack(pack)
                        ? pack.enabled
                          ? "is-installed"
                          : "is-disabled"
                        : pack.runtimeAvailable
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
                  {canInstallOptionalLoaderPack(pack) ? (
                    <Button
                      aria-label={`Install ${pack.name}`}
                      disabled={!onInstallOptionalLoaderPack}
                      onClick={() => onInstallOptionalLoaderPack?.(pack.id)}
                      size="sm"
                      variant="ghost"
                    >
                      Install
                    </Button>
                  ) : null}
                  {canRemoveOptionalLoaderPack(pack) ? (
                    <Button
                      aria-label={`Remove ${pack.name}`}
                      disabled={!onRemoveOptionalLoaderPack}
                      onClick={() => {
                        if (confirmRemoveOptionalLoaderPack(pack)) {
                          onRemoveOptionalLoaderPack?.(pack.id);
                        }
                      }}
                      size="sm"
                      variant="ghost"
                    >
                      Remove
                    </Button>
                  ) : null}
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
