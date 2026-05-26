import type { MmdAssetMetadata } from "./assetMetadata";
import {
  SidebarEmpty,
  SidebarKeyValueRows,
  SidebarMultilineValue,
  SidebarSection,
  type SidebarKeyValueRow,
} from "./sidebarPrimitives";

type MmdMetadataCardProps = {
  metadata: MmdAssetMetadata | null | undefined;
};

function renderValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "-";
  return value;
}

function renderMultiline(value: string) {
  return <SidebarMultilineValue>{renderValue(value)}</SidebarMultilineValue>;
}

export function MmdMetadataCard({ metadata }: MmdMetadataCardProps) {
  if (!metadata) {
    return (
      <SidebarSection title="MMD">
        <SidebarEmpty>
          Open a PMX or PMD asset to view MMD metadata.
        </SidebarEmpty>
      </SidebarSection>
    );
  }

  const modelRows: SidebarKeyValueRow[] = [
    { id: "name", label: "Name", value: renderValue(metadata.name) },
    {
      id: "english-name",
      label: "English",
      value: renderValue(metadata.englishName),
    },
    {
      id: "comment",
      label: "Comment",
      value: renderMultiline(metadata.comment),
    },
    {
      id: "english-comment",
      label: "English comment",
      value: renderMultiline(metadata.englishComment),
    },
  ];

  const formatRows: SidebarKeyValueRow[] = [
    {
      id: "format",
      label: "Format",
      value: `${metadata.format.toUpperCase()} ${metadata.version}`,
      mono: true,
    },
    {
      id: "encoding",
      label: "Encoding",
      value: renderValue(metadata.encoding),
      mono: true,
    },
    {
      id: "additional-uv",
      label: "Additional UV",
      value: renderValue(metadata.additionalUvCount),
      mono: true,
    },
    {
      id: "trailing",
      label: "Trailing bytes",
      value: metadata.trailingBytes,
      mono: true,
      tone: metadata.trailingBytes > 0 ? "warn" : "muted",
    },
  ];

  const countRows = Object.entries(metadata.counts).map(([key, value]) => ({
    id: key,
    label: key,
    value,
    mono: true,
  }));

  return (
    <>
      <SidebarSection title="MMD Model" collapsible defaultOpen={false}>
        <SidebarKeyValueRows rows={modelRows} />
      </SidebarSection>
      <SidebarSection title="MMD Counts" collapsible defaultOpen={false}>
        <SidebarKeyValueRows rows={countRows} />
      </SidebarSection>
      <SidebarSection title="MMD Format" collapsible defaultOpen={false}>
        <SidebarKeyValueRows rows={formatRows} />
      </SidebarSection>
    </>
  );
}
