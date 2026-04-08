import { useState } from "react";
import type {
  UpdateCheckPayload,
  UpdateConfigurationPayload,
} from "../lib/updater";

type UpdateDraft = {
  endpoint: string;
  publicKey: string;
  allowInsecure: boolean;
};

type UpdateCardProps = {
  updateConfiguration: UpdateConfigurationPayload | null;
  updateError: string | null;
  updateCheck: UpdateCheckPayload | null;
  isCheckingForUpdate: boolean;
  isInstallingUpdate: boolean;
  onCheckForUpdate: () => void;
  onInstallUpdate: () => void;
  onSaveOverride: (draft: UpdateDraft) => void;
};

export function UpdateCard({
  updateConfiguration,
  updateError,
  updateCheck,
  isCheckingForUpdate,
  isInstallingUpdate,
  onCheckForUpdate,
  onInstallUpdate,
  onSaveOverride,
}: UpdateCardProps) {
  const [draft, setDraft] = useState<UpdateDraft>({
    endpoint: "",
    publicKey: "",
    allowInsecure: false,
  });

  const hasUpdate = Boolean(updateCheck?.update);

  return (
    <article className="card">
      <p className="card-title">App Updates</p>
      {updateError ? <p className="card-error">{updateError}</p> : null}
      {updateConfiguration ? (
        <div className="card-rows">
          <div className="card-row">
            <span className="card-row-label">Version</span>
            <span className="card-row-badge-mono">
              {updateConfiguration.currentVersion}
            </span>
          </div>
          <div className="card-row">
            <span className="card-row-label">Endpoint</span>
            <span className="card-row-value-mono">
              {updateConfiguration.effectiveEndpoint ?? "not configured"}
            </span>
          </div>
          <div className="card-row">
            <span className="card-row-label">Public key</span>
            <span
              className={`card-row-badge ${updateConfiguration.effectivePubkeyAvailable ? "badge-active" : ""}`}
            >
              {updateConfiguration.effectivePubkeyAvailable
                ? "Configured"
                : "Missing"}
            </span>
          </div>
          <div className="card-row">
            <span className="card-row-label">Source</span>
            <span className="card-row-badge">
              {updateConfiguration.usingOverrideEndpoint ||
              updateConfiguration.usingOverridePubkey
                ? "Local override"
                : "Bundled"}
            </span>
          </div>
        </div>
      ) : (
        <p className="card-empty">Loading updater configuration.</p>
      )}

      <div className="card-section-label">Local override</div>

      <label className="text-control">
        <span>Update feed URL</span>
        <input
          onChange={(event) =>
            setDraft((previous) => ({
              ...previous,
              endpoint: event.target.value,
            }))
          }
          placeholder="http://127.0.0.1:8765/latest.json"
          type="text"
          value={draft.endpoint}
        />
      </label>

      <label className="text-control">
        <span>Updater public key</span>
        <textarea
          onChange={(event) =>
            setDraft((previous) => ({
              ...previous,
              publicKey: event.target.value,
            }))
          }
          placeholder="Paste PEM public key for local update signing."
          rows={4}
          value={draft.publicKey}
        />
      </label>

      <label className="checkbox-control">
        <input
          checked={draft.allowInsecure}
          onChange={(event) =>
            setDraft((previous) => ({
              ...previous,
              allowInsecure: event.target.checked,
            }))
          }
          type="checkbox"
        />
        <span>Allow HTTP on localhost</span>
      </label>

      <div className="card-actions">
        <button
          className="btn-ghost"
          onClick={() => onSaveOverride(draft)}
          type="button"
        >
          Save
        </button>
        <button className="btn-ghost" onClick={onCheckForUpdate} type="button">
          {isCheckingForUpdate ? "Checking..." : "Check for Updates"}
        </button>
        <button
          className="btn-primary"
          disabled={!hasUpdate || isInstallingUpdate}
          onClick={onInstallUpdate}
          type="button"
        >
          {isInstallingUpdate ? "Installing..." : "Install Update"}
        </button>
      </div>

      {updateCheck?.update ? (
        <div className="card-rows" style={{ marginTop: 12 }}>
          <div className="card-row">
            <span className="card-row-label">Available</span>
            <span className="card-row-badge-mono">
              {updateCheck.update.version}
            </span>
          </div>
          <div className="card-row">
            <span className="card-row-label">Target</span>
            <span className="card-row-value">{updateCheck.update.target}</span>
          </div>
          {updateCheck.update.pubDate ? (
            <div className="card-row">
              <span className="card-row-label">Published</span>
              <span className="card-row-value">
                {updateCheck.update.pubDate}
              </span>
            </div>
          ) : null}
          {updateCheck.update.notes ? (
            <pre className="log-preview">{updateCheck.update.notes}</pre>
          ) : null}
        </div>
      ) : updateCheck ? (
        <p className="card-empty" style={{ marginTop: 8 }}>
          No newer update available.
        </p>
      ) : null}
    </article>
  );
}
