import type { MmdAssetMetadata } from "../../../types/viewer";
import {
  SidebarKeyValueRows,
  SidebarMultilineValue,
  SidebarSection,
  type SidebarKeyValueRow,
} from "../../../lib/sidebarPrimitives";

type MmdMetadataCardProps = {
  metadata: MmdAssetMetadata;
};

function renderValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "-";
  return value;
}

function renderMultiline(value: string) {
  return <SidebarMultilineValue>{renderValue(value)}</SidebarMultilineValue>;
}

export function MmdMetadataCard({ metadata }: MmdMetadataCardProps) {
  const isMotion = metadata.format === "vmd";
  const modelRows: SidebarKeyValueRow[] = isMotion
    ? [
        {
          id: "name",
          label: "Model name",
          value: renderValue(metadata.name),
        },
      ]
    : [
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
      value:
        metadata.version === null
          ? metadata.format.toUpperCase()
          : `${metadata.format.toUpperCase()} ${metadata.version}`,
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

  return (
    <>
      <SidebarSection
        title={isMotion ? "MMD Motion" : "MMD Model"}
        collapsible
        defaultOpen={false}
      >
        <SidebarKeyValueRows rows={modelRows} />
      </SidebarSection>
      <SidebarSection title="MMD Format" collapsible defaultOpen={false}>
        <SidebarKeyValueRows rows={formatRows} />
      </SidebarSection>
    </>
  );
}
