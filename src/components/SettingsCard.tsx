import type { SettingsPayload } from "../lib/settings";

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
      <article className="card">
        <p className="card-title">Local Settings</p>
        <p className="card-error">{settingsError}</p>
      </article>
    );
  }

  if (!settingsPayload) {
    return (
      <article className="card">
        <p className="card-title">Local Settings</p>
        <p className="card-empty">Loading settings.</p>
      </article>
    );
  }

  return (
    <article className="card">
      <p className="card-title">Local Settings</p>
      <p className="card-path">{settingsPayload.settingsPath}</p>
      <div className="card-rows">
        <div className="card-row">
          <span className="card-row-label">Schema version</span>
          <span className="card-row-badge-mono">
            {settingsPayload.settings.version}
          </span>
        </div>
        <div className="card-row">
          <span className="card-row-label">Recent files limit</span>
          <span className="card-row-value-num">
            {settingsPayload.settings.recentFilesLimit}
          </span>
        </div>
        <div className="card-row">
          <span className="card-row-label">Log level</span>
          <span className="card-row-badge">
            {settingsPayload.settings.diagnosticsLogLevel}
          </span>
        </div>
        <div className="card-row">
          <span className="card-row-label">File associations</span>
          <span
            className={`card-row-badge ${settingsPayload.settings.fileAssociationsEnabled ? "badge-active" : ""}`}
          >
            {settingsPayload.settings.fileAssociationsEnabled
              ? "Enabled"
              : "Disabled"}
          </span>
        </div>
        <div className="card-row">
          <span className="card-row-label">Auto-check for updates</span>
          <span
            className={`card-row-badge ${settingsPayload.settings.autoCheckForUpdates ? "badge-active" : ""}`}
          >
            {settingsPayload.settings.autoCheckForUpdates ? "On" : "Off"}
          </span>
        </div>
      </div>
      <div className="card-actions">
        <button
          className="btn-ghost"
          onClick={onToggleFileAssociations}
          type="button"
        >
          Toggle File Associations
        </button>
        <button
          className="btn-ghost"
          onClick={onToggleAutoCheckForUpdates}
          type="button"
        >
          {settingsPayload.settings.autoCheckForUpdates
            ? "Disable Auto-Update Check"
            : "Enable Auto-Update Check"}
        </button>
      </div>
    </article>
  );
}
