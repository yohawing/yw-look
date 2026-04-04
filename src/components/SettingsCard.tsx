import type { SettingsPayload } from "../lib/settings";

type SettingsCardProps = {
  settingsPayload: SettingsPayload | null;
  settingsError: string | null;
  onToggleFileAssociations: () => void;
};

export function SettingsCard({
  settingsPayload,
  settingsError,
  onToggleFileAssociations,
}: SettingsCardProps) {
  if (settingsError) {
    return (
      <article className="card">
        <p className="card-title">Local Settings</p>
        <p className="error-text">{settingsError}</p>
      </article>
    );
  }

  if (!settingsPayload) {
    return (
      <article className="card">
        <p className="card-title">Local Settings</p>
        <p className="muted">
          Loading settings from the Tauri app config directory.
        </p>
      </article>
    );
  }

  return (
    <article className="card">
      <p className="card-title">Local Settings</p>
      <ul>
        <li>Path: {settingsPayload.settingsPath}</li>
        <li>Schema version: {settingsPayload.settings.version}</li>
        <li>Recent files limit: {settingsPayload.settings.recentFilesLimit}</li>
        <li>
          Diagnostics log level: {settingsPayload.settings.diagnosticsLogLevel}
        </li>
        <li>
          File associations:{" "}
          {settingsPayload.settings.fileAssociationsEnabled
            ? "enabled"
            : "disabled"}
        </li>
      </ul>
      <button onClick={onToggleFileAssociations} type="button">
        Toggle File Associations
      </button>
      <p className="muted">
        Settings are persisted in a JSON file under the per-user app config
        directory.
      </p>
    </article>
  );
}
