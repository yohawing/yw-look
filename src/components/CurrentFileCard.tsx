import { t, useLocale, formatNumber } from "../lib/i18n";
import { formatBytes } from "../lib/format";
import { useDebugPanelFixtures } from "../hooks/useDebugPanelFixtures";
import { useFileStore } from "../stores/fileStore";
import {
  SidebarEmpty,
  SidebarKeyValueRows,
  SidebarSection,
  type SidebarKeyValueRow,
} from "../lib/sidebarPrimitives";
import { WarningList } from "./ui/WarningList";

type CurrentFileCardProps = {
  debugPanelsEnabled?: boolean;
  usdPayloadSummary?: {
    payloadCount: number;
    unloadedPayloadCount: number;
    unresolvedPayloadCount: number;
  } | null;
  warnings: string[];
};

function renderValue(value: string | number | boolean | null) {
  if (typeof value === "boolean") {
    return value ? t("yes") : t("no");
  }

  return value ?? "—";
}

function formatDuration(value: number) {
  if (!Number.isFinite(value)) return "—";

  const totalSeconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function formatFps(value: number | null) {
  return value === null ? "n/a" : `${value.toFixed(1)} fps`;
}

export function CurrentFileCard({
  debugPanelsEnabled = false,
  usdPayloadSummary,
  warnings,
}: CurrentFileCardProps) {
  useLocale();
  const assetInspection = useFileStore((state) => state.assetInspection);
  const storeCurrentFile = useFileStore((state) => state.currentFile);
  const storeAssetMetadata = useFileStore((state) => state.assetMetadata);
  const { debugFixtures, useDebugFixtures } =
    useDebugPanelFixtures(debugPanelsEnabled);
  const currentFile = useDebugFixtures
    ? debugFixtures.debugPanelFile
    : storeCurrentFile;
  const metadata = useDebugFixtures
    ? debugFixtures.debugPanelMetadata
    : storeAssetMetadata;
  const animationClips = metadata?.animationClips ?? [];

  if (!currentFile) {
    return (
      <SidebarSection title={t("file")}>
        <SidebarEmpty>
          {t("no_file_selected_drop_a_file_or_use_file_to_open")}
        </SidebarEmpty>
      </SidebarSection>
    );
  }

  const formatLabel =
    metadata?.formatLabel ??
    (currentFile.extension ? currentFile.extension.toUpperCase() : "—");
  const warningCount = warnings.length;
  const payloadSummary =
    usdPayloadSummary &&
    (usdPayloadSummary.payloadCount > 0 ||
      usdPayloadSummary.unloadedPayloadCount > 0 ||
      usdPayloadSummary.unresolvedPayloadCount > 0)
      ? usdPayloadSummary
      : null;
  const animationClipCount = animationClips.length;
  const longestAnimationDuration = animationClips.reduce(
    (longestDuration, clip) =>
      Number.isFinite(clip.duration)
        ? Math.max(longestDuration, clip.duration)
        : longestDuration,
    0,
  );
  const representativeAnimationFps =
    animationClipCount > 0 ? animationClips[0]?.estimatedFrameRate : null;
  const totalAnimationKeyframeCount = animationClips.reduce(
    (total, clip) => total + clip.keyframeCount,
    0,
  );
  const totalAnimationTrackCount = animationClips.reduce(
    (total, clip) => total + clip.trackCount,
    0,
  );

  const summaryRows: SidebarKeyValueRow[] = [
    {
      id: "format",
      label: t("format"),
      value: `${formatLabel}${
        metadata?.formatVersion ? ` ${metadata.formatVersion}` : ""
      }`,
      mono: true,
    },
    {
      id: "file-size",
      label: t("file_size"),
      value: formatBytes(assetInspection?.fileSizeBytes),
      mono: true,
      tone: assetInspection ? "default" : "muted",
    },
    {
      id: "meshes",
      label: t("meshes"),
      value: renderValue(metadata?.meshCount ?? null),
      mono: true,
      tone: metadata ? "default" : "muted",
    },
    {
      id: "materials",
      label: t("materials"),
      value: renderValue(metadata?.materialCount ?? null),
      mono: true,
      tone: metadata ? "default" : "muted",
    },
    {
      id: "textures",
      label: t("textures"),
      value: renderValue(metadata?.textureCount ?? null),
      mono: true,
      tone: metadata ? "default" : "muted",
    },
    {
      id: "animations",
      label: t("animation"),
      value: metadata?.hasAnimation
        ? t("metadata.present")
        : t("metadata.none"),
      tone: metadata?.hasAnimation ? "ok" : "muted",
    },
    ...(animationClipCount > 0
      ? [
          {
            id: "animation-duration",
            label: t("duration"),
            value: formatDuration(longestAnimationDuration),
            mono: true,
          },
          {
            id: "animation-fps",
            label: t("fps"),
            value: formatFps(representativeAnimationFps),
            mono: true,
          },
          {
            id: "animation-keys",
            label: t("keys"),
            value: formatNumber(totalAnimationKeyframeCount),
            mono: true,
          },
          {
            id: "animation-tracks",
            label: t("tracks"),
            value: formatNumber(totalAnimationTrackCount),
            mono: true,
          },
        ]
      : []),
    {
      id: "warnings",
      label: t("warnings"),
      value: warningCount,
      mono: true,
      tone: warningCount > 0 ? "warn" : "muted",
    },
    payloadSummary && {
      id: "payloads",
      label: t("usd_payloads"),
      value:
        payloadSummary.unloadedPayloadCount > 0
          ? t("metadata.payloadDeferred", {
              count: payloadSummary.payloadCount,
              deferred: payloadSummary.unloadedPayloadCount,
            })
          : payloadSummary.unresolvedPayloadCount > 0
            ? t("metadata.payloadMissing", {
                count: payloadSummary.payloadCount,
                missing: payloadSummary.unresolvedPayloadCount,
              })
            : payloadSummary.payloadCount,
      mono: true,
      tone:
        payloadSummary.unresolvedPayloadCount > 0
          ? "danger"
          : payloadSummary.unloadedPayloadCount > 0
            ? "warn"
            : "default",
    },
  ].filter(Boolean) as SidebarKeyValueRow[];

  return (
    <SidebarSection title={t("file_info")}>
      <SidebarKeyValueRows rows={summaryRows} />
      {warnings.length > 0 ? (
        <WarningList
          density="summary"
          maxItems={3}
          showItemIcons={false}
          title={`${warnings.length} warning${warnings.length === 1 ? "" : "s"}`}
          warnings={warnings}
        />
      ) : null}
    </SidebarSection>
  );
}
