import type { MaterialEntry } from "./assetMetadata";

type MaterialListCardProps = {
  materials: MaterialEntry[];
};

export function MaterialListCard({ materials }: MaterialListCardProps) {
  return (
    <article className="card">
      <p className="card-title">Materials</p>
      {materials.length > 0 ? (
        <ul className="material-list">
          {materials.map((mat) => (
            <li key={mat.id} className="material-item">
              <div className="material-swatch-wrap">
                {mat.color ? (
                  <span
                    className="material-swatch"
                    style={{ background: mat.color }}
                  />
                ) : (
                  <span className="material-swatch material-swatch-none" />
                )}
              </div>
              <div className="material-info">
                <span className="material-name">{mat.name}</span>
                <span className="material-meta">
                  <span className="card-row-badge">{mat.type}</span>
                  {mat.textureCount > 0 ? (
                    <span className="material-detail">
                      {mat.textureCount} tex
                    </span>
                  ) : null}
                  {mat.transparent ? (
                    <span className="material-detail">
                      a:{mat.opacity.toFixed(2)}
                    </span>
                  ) : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="card-empty">No materials found.</p>
      )}
    </article>
  );
}
