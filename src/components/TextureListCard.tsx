import { useMemo, useState } from "react";
import type { TextureEntry } from "./assetMetadata";
import { SidebarEmpty } from "../lib/sidebarPrimitives";
import { SelectableListItem } from "./ui";
import { Badge, BadgeButton } from "./ui/Badge";
import { KeyValueRows, type KeyValueRow } from "./ui/KeyValueRows";
import { SidebarSplitPanel } from "./ui/SidebarSplitPanel";
import "../styles/texture-list.css";

type TextureListCardProps = {
  textures: TextureEntry[];
  activeTextureId: string | null;
  onSelectTexture: (textureId: string) => void;
};

function textureExtension(label: string): string | null {
  const cleanLabel = label.split(/[?#]/, 1)[0];
  const dotIndex = cleanLabel.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === cleanLabel.length - 1) return null;
  const extension = cleanLabel.slice(dotIndex + 1);
  return extension.length <= 8 ? extension.toUpperCase() : null;
}

function textureRowMetadata(texture: TextureEntry): string {
  const dimensions = texture.dimensions.replace(/(\d)x(\d)/i, "$1×$2");
  return [textureExtension(texture.label), texture.channel, dimensions]
    .filter(Boolean)
    .join(" · ");
}

function TextureDetailPanel({ texture }: { texture: TextureEntry }) {
  const extension = textureExtension(texture.label);
  const rows: KeyValueRow[] = [
    { id: "name", label: "Name", value: texture.label, mono: true },
    extension && { id: "type", label: "Type", value: extension, mono: true },
    { id: "channel", label: "Channel", value: texture.channel, mono: true },
    { id: "dimensions", label: "Size", value: texture.dimensions, mono: true },
    {
      id: "source",
      label: "Source",
      value: texture.sourceKind,
      tone: texture.sourceKind === "unresolved" ? "warn" : "muted",
      mono: true,
    },
    texture.previewFlipY && {
      id: "orientation",
      label: "Preview",
      value: "Flip Y",
      mono: true,
    },
  ].filter(Boolean) as KeyValueRow[];

  return (
    <section className="texture-selected-panel" aria-label="Selected texture">
      <p className="texture-selected-title">Selected texture</p>
      <KeyValueRows
        className="texture-detail-grid"
        density="regular"
        rows={rows}
      />
    </section>
  );
}

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
  const selectedTexture =
    textures.find((texture) => texture.id === activeTextureId) ??
    visibleTextures[0] ??
    null;

  const textureList =
    textures.length > 0 ? (
      <div className="texture-list-layout">
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
        <div className="texture-list">
          {visibleTextures.map((texture) => {
            const isMissing = texture.sourceKind === "unresolved";
            return (
              <SelectableListItem
                key={texture.id}
                className={`texture-row${texture.id === activeTextureId ? " is-active" : ""}${isMissing ? " is-missing" : ""}`}
                onClick={() => onSelectTexture(texture.id)}
              >
                <span className="texture-row-preview">
                  {texture.thumbnailUrl && !isMissing ? (
                    <img
                      className={
                        texture.previewFlipY ? "is-preview-flipped-y" : ""
                      }
                      src={texture.thumbnailUrl}
                      alt={texture.label}
                    />
                  ) : (
                    <span
                      aria-label={isMissing ? "Missing texture" : "No preview"}
                      className="texture-row-preview-placeholder"
                    >
                      {isMissing ? "!" : ""}
                    </span>
                  )}
                </span>
                <span className="texture-row-info">
                  <span className="texture-row-label">{texture.label}</span>
                  <span className="texture-row-meta">
                    {textureRowMetadata(texture)}
                  </span>
                </span>
              </SelectableListItem>
            );
          })}
        </div>
      </div>
    ) : (
      <SidebarEmpty>No textures referenced.</SidebarEmpty>
    );

  const textureDetails = (
    <div className="texture-detail-layout">
      {selectedTexture ? (
        <TextureDetailPanel texture={selectedTexture} />
      ) : (
        <SidebarEmpty>Select a texture to inspect it.</SidebarEmpty>
      )}
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
    </div>
  );

  return (
    <SidebarSplitPanel
      className="texture-split-panel"
      handleClassName="texture-resize-handle"
      primary={{
        bodyClassName: "texture-list-scroll",
        children: textureList,
        className: "texture-grid-pane",
        count: `${resolvedCount} / ${textures.length}`,
        defaultSize: 62,
        id: "texture-grid",
        minSize: 24,
        title: "Textures",
      }}
      resizeLabel="Resize texture details"
      secondary={{
        bodyClassName: "texture-detail-scroll",
        children: textureDetails,
        className: "texture-detail-pane",
        defaultSize: 38,
        id: "texture-detail",
        minSize: 20,
        title: "Selected",
      }}
    />
  );
}
