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
      {updateError ? <p className="error-text">{updateError}</p> : null}
      {updateConfiguration ? (
        <>
          <p className="muted">Current version: {updateConfiguration.currentVersion}</p>
          <p className="muted">
            Effective endpoint: {updateConfiguration.effectiveEndpoint ?? "not configured"}
          </p>
          <p className="muted">
            Public key:{" "}
            {updateConfiguration.effectivePubkeyAvailable ? "configured" : "missing"}
          </p>
          <p className="muted">
            Source:{" "}
            {updateConfiguration.usingOverrideEndpoint ||
            updateConfiguration.usingOverridePubkey
              ? "local override"
              : "bundled release settings"}
          </p>
        </>
      ) : (
        <p className="muted">Loading updater configuration.</p>
      )}

      <label className="text-control">
        <span>Local update feed URL</span>
        <input
          onChange={(event) =>
            setDraft((previous) => ({ ...previous, endpoint: event.target.value }))
          }
          placeholder="http://127.0.0.1:8765/latest.json"
          type="text"
          value={draft.endpoint}
        />
      </label>

      <label className="text-control">
        <span>Local updater public key</span>
        <textarea
          onChange={(event) =>
            setDraft((previous) => ({ ...previous, publicKey: event.target.value }))
          }
          placeholder="Paste the PEM public key for local update signing."
          rows={5}
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
        <span>Allow local HTTP update feed on localhost only</span>
      </label>

      <div className="card-actions">
        <button onClick={() => onSaveOverride(draft)} type="button">
          Save Update Settings
        </button>
        <button onClick={onCheckForUpdate} type="button">
          {isCheckingForUpdate ? "Checking..." : "Check for Updates"}
        </button>
        <button
          disabled={!hasUpdate || isInstallingUpdate}
          onClick={onInstallUpdate}
          type="button"
        >
          {isInstallingUpdate ? "Installing..." : "Install Update"}
        </button>
      </div>

      {updateCheck?.update ? (
        <>
          <p className="muted">Available version: {updateCheck.update.version}</p>
          <p className="muted">Target: {updateCheck.update.target}</p>
          {updateCheck.update.pubDate ? (
            <p className="muted">Published: {updateCheck.update.pubDate}</p>
          ) : null}
          {updateCheck.update.notes ? (
            <pre className="log-preview">{updateCheck.update.notes}</pre>
          ) : (
            <p className="muted">No release notes were included with this update.</p>
          )}
        </>
      ) : updateCheck ? (
        <p className="muted">No newer update is currently available.</p>
      ) : (
        <p className="muted">
          Bundled releases use the build-time GitHub endpoint. The fields above
          are for local development feeds.
        </p>
      )}
    </article>
  );
}
