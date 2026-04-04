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
        <p className="error-text">{integrationError}</p>
      ) : integrationPayload ? (
        <>
          <p className="muted">{integrationPayload.installStrategy}</p>
          <p className="muted">
            File associations:{" "}
            {integrationPayload.fileAssociationsEnabled ? "enabled" : "disabled"}
          </p>
          <ul>
            {integrationPayload.supportedExtensions.map((extension) => (
              <li key={extension}>{extension}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">Loading Windows integration details.</p>
      )}
    </article>
  );
}
