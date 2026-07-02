import { useMemo, useState } from "react";
import type { TextureEntry } from "./assetMetadata";
import { SidebarEmpty, SidebarSection } from "./sidebarPrimitives";
import { SelectableListItem } from "./SelectableListItem";
import { Badge, BadgeButton } from "./ui/Badge";
import "../styles/texture-list.css";

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
          <div
            className="texture-channel-filters u-flex u-flex-wrap u-gap-4"
            aria-label="Texture channels"
          >
            {channels.map((channel) => (
              <BadgeButton
                key={channel}
                className="texture-channel-filter"
                variant={channel === activeChannel ? "info" : "neutral"}
                mono
                onClick={() => setActiveChannel(channel)}
                size="sm"
              >
                {channel}
              </BadgeButton>
            ))}
          </div>
          <div className="texture-grid u-grid u-gap-6">
            {visibleTextures.map((texture) => {
              const isMissing = texture.sourceKind === "unresolved";
              return (
                <SelectableListItem
                  key={texture.id}
                  className={`texture-card u-relative u-aspect-square u-overflow-hidden u-p-0${texture.id === activeTextureId ? " is-active" : ""}${isMissing ? " is-missing" : ""}`}
                  onClick={() => onSelectTexture(texture.id)}
                >
                  <div className="texture-card-preview u-absolute u-inset-0 u-size-full u-overflow-hidden u-flex u-items-center u-justify-center">
                    {texture.thumbnailUrl && !isMissing ? (
                      <img
                        className={
                          texture.previewFlipY ? "is-preview-flipped-y" : ""
                        }
                        src={texture.thumbnailUrl}
                        alt={texture.label}
                      />
                    ) : (
                      <span className="texture-card-preview-placeholder">
                        {isMissing ? "!" : texture.channel}
                      </span>
                    )}
                  </div>
                  <div className="texture-card-info u-absolute u-flex u-items-end u-justify-between u-gap-4">
                    <span className="texture-card-label u-min-w-0 u-truncate">
                      {texture.label}
                    </span>
                    <span className="texture-card-dimensions u-nowrap">
                      {texture.channel} · {texture.dimensions}
                    </span>
                  </div>
                </SelectableListItem>
              );
            })}
          </div>
          <div className="texture-summary u-flex u-justify-between">
            <Badge variant="success" size="sm">
              Resolved {resolvedCount}
            </Badge>
            <Badge
              className={missingCount > 0 ? "is-warning" : ""}
              variant={missingCount > 0 ? "warning" : "neutral"}
              size="sm"
            >
              Missing {missingCount}
            </Badge>
          </div>
        </>
      ) : (
        <SidebarEmpty>No textures referenced.</SidebarEmpty>
      )}
    </SidebarSection>
  );
}
