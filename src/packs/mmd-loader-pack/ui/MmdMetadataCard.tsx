import "../locales";
import { t, useLocale } from "../../../lib/i18n";
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
  useLocale();
  const isMotion = metadata.format === "vmd";
  const modelRows: SidebarKeyValueRow[] = isMotion
    ? [
        {
          id: "name",
          label: t("mmd-loader-pack:model_name"),
          value: renderValue(metadata.name),
        },
      ]
    : [
        {
          id: "name",
          label: t("mmd-loader-pack:name"),
          value: renderValue(metadata.name),
        },
        {
          id: "english-name",
          label: "English",
          value: renderValue(metadata.englishName),
        },
        {
          id: "comment",
          label: t("mmd-loader-pack:comment"),
          value: renderMultiline(metadata.comment),
        },
        {
          id: "english-comment",
          label: t("mmd-loader-pack:english_comment"),
          value: renderMultiline(metadata.englishComment),
        },
      ];

  const formatRows: SidebarKeyValueRow[] = [
    {
      id: "format",
      label: t("mmd-loader-pack:format"),
      value:
        metadata.version === null
          ? metadata.format.toUpperCase()
          : `${metadata.format.toUpperCase()} ${metadata.version}`,
      mono: true,
    },
    {
      id: "encoding",
      label: t("mmd-loader-pack:encoding"),
      value: renderValue(metadata.encoding),
      mono: true,
    },
    {
      id: "additional-uv",
      label: t("mmd-loader-pack:additional_uv"),
      value: renderValue(metadata.additionalUvCount),
      mono: true,
    },
    {
      id: "trailing",
      label: t("mmd-loader-pack:trailing_bytes"),
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
      <SidebarSection
        title={t("mmd-loader-pack:mmd_format")}
        collapsible
        defaultOpen={false}
      >
        <SidebarKeyValueRows rows={formatRows} />
      </SidebarSection>
    </>
  );
}
