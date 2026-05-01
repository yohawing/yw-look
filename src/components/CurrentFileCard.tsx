import type { SelectedFile } from "../lib/files";
import type { AssetMetadata } from "./assetMetadata";
import {
  SidebarEmpty,
  SidebarKeyValueRows,
  SidebarSection,
  type SidebarKeyValueRow,
} from "./sidebarPrimitives";

type CurrentFileCardProps = {
  currentFile: SelectedFile | null;
  metadata: AssetMetadata | null;
};

function renderValue(value: string | number | boolean | null) {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return value ?? "—";
}

export function CurrentFileCard({
  currentFile,
  metadata,
}: CurrentFileCardProps) {
  if (!currentFile) {
    return (
      <SidebarSection title="File">
        <SidebarEmpty>
          No file selected. Drop a file or use File to open.
        </SidebarEmpty>
      </SidebarSection>
    );
  }

  const fileRows: SidebarKeyValueRow[] = [
    { id: "name", label: "Name", value: currentFile.fileName, mono: true },
    {
      id: "type",
      label: "Type",
      value: currentFile.kind === "model" ? "3D Model" : "Texture",
      tone: "muted",
    },
    {
      id: "folder",
      label: "Folder",
      value: currentFile.parentDirectory,
      mono: true,
      tone: "muted",
    },
  ];

  const geometryRows: SidebarKeyValueRow[] = metadata
    ? [
        {
          id: "format",
          label: "Format",
          value: `${renderValue(metadata.formatLabel)}${
            metadata.formatVersion ? ` ${metadata.formatVersion}` : ""
          }`,
          mono: true,
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
      ]
    : [];

  const animationRows: SidebarKeyValueRow[] = metadata
    ? [
        {
          id: "status",
          label: "Status",
          value: metadata.hasAnimation ? "Present" : "None",
          tone: metadata.hasAnimation ? "ok" : "muted",
        },
      ]
    : [];

  return (
    <>
      <SidebarSection title="File">
        <SidebarKeyValueRows rows={fileRows} />
      </SidebarSection>
      {metadata ? (
        <SidebarSection title="Geometry" count={metadata.meshCount}>
          <SidebarKeyValueRows rows={geometryRows} />
        </SidebarSection>
      ) : null}
      {metadata ? (
        <SidebarSection
          title="Animation"
          count={metadata.hasAnimation ? 1 : undefined}
        >
          <SidebarKeyValueRows rows={animationRows} />
        </SidebarSection>
      ) : null}
    </>
  );
}
