import type { IntegrationPayload } from "../lib/integrations";

type IntegrationCardProps = {
  integrationPayload: IntegrationPayload | null;
  integrationError: string | null;
};

export function IntegrationCard({
  integrationPayload,
  integrationError,
}: IntegrationCardProps) {
  return (
    <article className="card">
      <p className="card-title">Windows Integration</p>
      {integrationError ? (
        <p className="card-error">{integrationError}</p>
      ) : integrationPayload ? (
        <>
          <div className="card-rows">
            <div className="card-row">
              <span className="card-row-label">Install strategy</span>
              <span className="card-row-badge">{integrationPayload.installStrategy}</span>
            </div>
            <div className="card-row">
              <span className="card-row-label">File associations</span>
              <span className={`card-row-badge ${integrationPayload.fileAssociationsEnabled ? "badge-active" : ""}`}>
                {integrationPayload.fileAssociationsEnabled ? "Enabled" : "Disabled"}
              </span>
            </div>
          </div>
          <div className="card-section-label">Supported extensions</div>
          <div className="extension-badges">
            {integrationPayload.supportedExtensions.map((ext) => (
              <span key={ext} className="card-row-badge-mono">{ext}</span>
            ))}
          </div>
        </>
      ) : (
        <p className="card-empty">Loading Windows integration details.</p>
      )}
    </article>
  );
}
