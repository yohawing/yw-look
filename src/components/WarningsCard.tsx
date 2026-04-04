type WarningsCardProps = {
  warnings: string[];
};

export function WarningsCard({ warnings }: WarningsCardProps) {
  return (
    <article className="card">
      <p className="card-title">Warnings</p>
      {warnings.length > 0 ? (
        <ul>
          {warnings.map((warning) => (
            <li key={warning} className="warning-text">
              {warning}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No active viewer warnings.</p>
      )}
    </article>
  );
}
