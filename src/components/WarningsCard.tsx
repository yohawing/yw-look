type WarningsCardProps = {
  warnings: string[];
};

export function WarningsCard({ warnings }: WarningsCardProps) {
  return (
    <article className="card">
      <p className="card-title">Warnings</p>
      {warnings.length > 0 ? (
        <ul className="warning-list">
          {warnings.map((warning) => (
            <li key={warning} className="warning-item">
              <svg
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                className="warning-icon"
              >
                <path
                  d="M8 1.5L1.5 13.5h13L8 1.5Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
                <path
                  d="M8 6v4"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
                <circle cx="8" cy="11.5" r="0.6" fill="currentColor" />
              </svg>
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="card-empty">No active warnings.</p>
      )}
    </article>
  );
}
