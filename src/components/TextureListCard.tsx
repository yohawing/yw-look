import type { TextureEntry } from "./assetMetadata";

type TextureListCardProps = {
  textures: TextureEntry[];
  activeTextureId: string | null;
  onSelectTexture: (textureId: string) => void;
};

export function TextureListCard({
  textures,
  activeTextureId,
  onSelectTexture,
}: TextureListCardProps) {
  return (
    <article className="card">
      <p className="card-title">Textures</p>
      {textures.length > 0 ? (
        <div className="texture-grid">
          {textures.map((texture) => (
            <button
              key={texture.id}
              className={`texture-card${texture.id === activeTextureId ? " is-active" : ""}`}
              onClick={() => onSelectTexture(texture.id)}
              type="button"
            >
              <div className="texture-card-preview">
                {texture.thumbnailUrl ? (
                  <img
                    src={texture.thumbnailUrl}
                    alt={texture.label}
                  />
                ) : (
                  <span className="texture-card-preview-placeholder">
                    {texture.channel}
                  </span>
                )}
              </div>
              <div className="texture-card-info">
                <span className="texture-card-label">{texture.label}</span>
                <span className="texture-card-dimensions">
                  {texture.dimensions}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">No textures referenced.</p>
      )}
    </article>
  );
}
