import type { AssetMetadata } from "./assetMetadata";
import {
  SidebarEmpty,
  SidebarKeyValueRows,
  SidebarSection,
  type SidebarKeyValueRow,
} from "./sidebarPrimitives";

type MetadataCardProps = {
  metadata: AssetMetadata | null;
};

function renderValue(value: string | number | boolean | null) {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return value ?? "n/a";
}

export function MetadataCard({ metadata }: MetadataCardProps) {
  if (!metadata) {
    return (
      <SidebarSection title="Asset Metadata">
        <SidebarEmpty>Open a supported file to inspect metadata.</SidebarEmpty>
      </SidebarSection>
    );
  }

  const rows: SidebarKeyValueRow[] = [
    { id: "format", label: "Format", value: renderValue(metadata.formatLabel) },
    {
      id: "version",
      label: "Version",
      value: renderValue(metadata.formatVersion),
      mono: true,
      tone: metadata.formatVersion ? "default" : "muted",
    },
    {
      id: "nodes",
      label: "Nodes",
      value: renderValue(metadata.nodeCount),
      mono: true,
    },
    {
      id: "meshes",
      label: "Meshes",
      value: renderValue(metadata.meshCount),
      mono: true,
    },
    {
      id: "materials",
      label: "Materials",
      value: renderValue(metadata.materialCount),
      mono: true,
    },
    {
      id: "textures",
      label: "Textures",
      value: renderValue(metadata.textureCount),
      mono: true,
    },
    {
      id: "animations",
      label: "Animations",
      value: renderValue(metadata.hasAnimation),
      tone: metadata.hasAnimation ? "ok" : "muted",
    },
  ];

  return (
    <SidebarSection title="Asset Metadata">
      <SidebarKeyValueRows rows={rows} />
    </SidebarSection>
  );
}
