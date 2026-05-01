import "../styles/viewport.css";

type LoadingScreenProps = {
  fileName?: string | null;
};

export function LoadingScreen({ fileName }: LoadingScreenProps) {
  return (
    <div className="loader-root" role="status" aria-live="polite">
      <section className="loader-panel" aria-label="Loading asset">
        <span className="loader-spinner" aria-hidden="true" />
        <div className="loader-copy">
          <span className="loader-label">Loading</span>
          <strong className="loader-file">{fileName ?? "Asset preview"}</strong>
        </div>
        <div className="loader-progress" aria-hidden="true">
          <span />
        </div>
      </section>
    </div>
  );
}
