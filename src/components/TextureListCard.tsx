import { useMemo, useState } from "react";
import type { TextureEntry } from "./assetMetadata";
import { SidebarEmpty, SidebarSection } from "./sidebarPrimitives";

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
  const [activeChannel, setActiveChannel] = useState("All");
  const channels = useMemo(() => {
    const seen = new Set<string>();
    for (const texture of textures) {
      if (texture.channel) {
        seen.add(texture.channel);
      }
    }
    return ["All", ...Array.from(seen).sort()];
  }, [textures]);
  const visibleTextures =
    activeChannel === "All"
      ? textures
      : textures.filter((texture) => texture.channel === activeChannel);
  const missingCount = textures.filter(
    (texture) => texture.sourceKind === "unresolved",
  ).length;
  const resolvedCount = textures.length - missingCount;

  return (
    <SidebarSection
      title="Textures"
      count={`${resolvedCount} / ${textures.length}`}
    >
      {textures.length > 0 ? (
        <>
          <div className="texture-channel-chips" aria-label="Texture channels">
            {channels.map((channel) => (
              <button
                key={channel}
                className={`texture-channel-chip${channel === activeChannel ? " is-active" : ""}`}
                onClick={() => setActiveChannel(channel)}
                type="button"
              >
                {channel}
              </button>
            ))}
          </div>
          <div className="texture-grid">
            {visibleTextures.map((texture) => {
              const isMissing = texture.sourceKind === "unresolved";
              return (
                <button
                  key={texture.id}
                  className={`texture-card${texture.id === activeTextureId ? " is-active" : ""}${isMissing ? " is-missing" : ""}`}
                  onClick={() => onSelectTexture(texture.id)}
                  type="button"
                >
                  <div className="texture-card-preview">
                    {texture.thumbnailUrl && !isMissing ? (
                      <img src={texture.thumbnailUrl} alt={texture.label} />
                    ) : (
                      <span className="texture-card-preview-placeholder">
                        {isMissing ? "!" : texture.channel}
                      </span>
                    )}
                  </div>
                  <div className="texture-card-info">
                    <span className="texture-card-label">{texture.label}</span>
                    <span className="texture-card-dimensions">
                      {texture.channel} · {texture.dimensions}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="texture-summary">
            <span>Resolved {resolvedCount}</span>
            <span className={missingCount > 0 ? "is-warning" : ""}>
              Missing {missingCount}
            </span>
          </div>
        </>
      ) : (
        <SidebarEmpty>No textures referenced.</SidebarEmpty>
      )}
    </SidebarSection>
  );
}
