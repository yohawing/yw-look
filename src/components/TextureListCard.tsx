import type { TextureEntry } from "./assetMetadata";

type TextureListCardProps = {
  textures: TextureEntry[];
  activeTextureId: string | null;
  onSelectTexture: (textureId: string) => void;
};

function getSourceLabel(sourceKind: TextureEntry["sourceKind"]) {
  switch (sourceKind) {
    case "embedded":
      return "embedded";
    case "external":
      return "external";
    case "standalone":
      return "standalone";
    case "unresolved":
      return "unresolved";
    default:
      return "unknown";
  }
}

export function TextureListCard({
  textures,
  activeTextureId,
  onSelectTexture,
}: TextureListCardProps) {
  return (
    <article className="card">
      <p className="card-title">Textures</p>
      {textures.length > 0 ? (
        <ul className="texture-list">
          {textures.map((texture) => (
            <li key={texture.id}>
              <button
                className={
                  texture.id === activeTextureId
                    ? "texture-entry is-active"
                    : "texture-entry"
                }
                onClick={() => onSelectTexture(texture.id)}
                type="button"
              >
                <span>{texture.label}</span>
                <span className="muted">
                  {texture.channel} / {texture.dimensions} /{" "}
                  {getSourceLabel(texture.sourceKind)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          No material textures are referenced by the current preview object.
        </p>
      )}
    </article>
  );
}
