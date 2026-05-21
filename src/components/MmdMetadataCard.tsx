import type { MmdAssetMetadata } from "./assetMetadata";
import {
  SidebarEmpty,
  SidebarKeyValueRows,
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

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 1 : 2)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
}

function formatRecord(record: Record<string, number> | null) {
  if (!record) return "-";
  const entries = Object.entries(record);
  if (entries.length === 0) return "-";
  return entries.map(([key, value]) => `${key}:${value}`).join(" / ");
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
      value: renderValue(metadata.comment),
    },
    {
      id: "english-comment",
      label: "English comment",
      value: renderValue(metadata.englishComment),
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
      id: "index-sizes",
      label: "Index sizes",
      value: formatRecord(metadata.indexSizes),
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
      <SidebarSection
        title="MMD Sections"
        count={metadata.sections.length}
        collapsible
        defaultOpen={false}
      >
        {metadata.sections.length > 0 ? (
          <div className="sidebar-kv">
            {metadata.sections.map((section) => (
              <div className="sidebar-kv-row" key={section.name}>
                <span className="sidebar-kv-key">{section.name}</span>
                <span className="sidebar-kv-value is-mono">
                  {section.count} / {formatBytes(section.byteLength)} @{" "}
                  {section.offset}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <SidebarEmpty>No section inventory.</SidebarEmpty>
        )}
      </SidebarSection>
      {metadata.diagnostics.length > 0 ? (
        <SidebarSection
          title="MMD Diagnostics"
          count={metadata.diagnostics.length}
          collapsible
          defaultOpen={false}
        >
          <div className="sidebar-kv">
            {metadata.diagnostics.map((diagnostic, index) => (
              <div
                className="sidebar-kv-row"
                key={`${diagnostic.code}:${index}`}
              >
                <span className="sidebar-kv-key">{diagnostic.code}</span>
                <span
                  className={`sidebar-kv-value is-${diagnostic.level === "error" ? "danger" : "warn"}`}
                >
                  {diagnostic.message}
                </span>
              </div>
            ))}
          </div>
        </SidebarSection>
      ) : null}
    </>
  );
}
