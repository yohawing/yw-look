import { formatBytes } from "../lib/format";
import { useDebugPanelFixtures } from "../hooks/useDebugPanelFixtures";
import { useFileStore } from "../stores/fileStore";
import {
  SidebarEmpty,
  SidebarKeyValueRows,
  SidebarSection,
  type SidebarKeyValueRow,
} from "../lib/sidebarPrimitives";

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
    return value ? "Yes" : "No";
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

function formatNumber(value: number) {
  return Intl.NumberFormat("en-US").format(value);
}

function formatFps(value: number | null) {
  return value === null ? "n/a" : `${value.toFixed(1)} fps`;
}

export function CurrentFileCard({
  debugPanelsEnabled = false,
  usdPayloadSummary,
  warnings,
}: CurrentFileCardProps) {
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
      <SidebarSection title="File">
        <SidebarEmpty>
          No file selected. Drop a file or use File to open.
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
      label: "Format",
      value: `${formatLabel}${
        metadata?.formatVersion ? ` ${metadata.formatVersion}` : ""
      }`,
      mono: true,
    },
    {
      id: "file-size",
      label: "File size",
      value: formatBytes(assetInspection?.fileSizeBytes),
      mono: true,
      tone: assetInspection ? "default" : "muted",
    },
    {
      id: "meshes",
      label: "Meshes",
      value: renderValue(metadata?.meshCount ?? null),
      mono: true,
      tone: metadata ? "default" : "muted",
    },
    {
      id: "materials",
      label: "Materials",
      value: renderValue(metadata?.materialCount ?? null),
      mono: true,
      tone: metadata ? "default" : "muted",
    },
    {
      id: "textures",
      label: "Textures",
      value: renderValue(metadata?.textureCount ?? null),
      mono: true,
      tone: metadata ? "default" : "muted",
    },
    {
      id: "animations",
      label: "Animation",
      value: metadata?.hasAnimation ? "Present" : "None",
      tone: metadata?.hasAnimation ? "ok" : "muted",
    },
    ...(animationClipCount > 0
      ? [
          {
            id: "animation-duration",
            label: "Duration",
            value: formatDuration(longestAnimationDuration),
            mono: true,
          },
          {
            id: "animation-fps",
            label: "FPS",
            value: formatFps(representativeAnimationFps),
            mono: true,
          },
          {
            id: "animation-keys",
            label: "Keys",
            value: formatNumber(totalAnimationKeyframeCount),
            mono: true,
          },
          {
            id: "animation-tracks",
            label: "Tracks",
            value: formatNumber(totalAnimationTrackCount),
            mono: true,
          },
        ]
      : []),
    {
      id: "warnings",
      label: "Warnings",
      value: warningCount,
      mono: true,
      tone: warningCount > 0 ? "warn" : "muted",
    },
    payloadSummary && {
      id: "payloads",
      label: "USD payloads",
      value:
        payloadSummary.unloadedPayloadCount > 0
          ? `${payloadSummary.payloadCount} (${payloadSummary.unloadedPayloadCount} deferred)`
          : payloadSummary.unresolvedPayloadCount > 0
            ? `${payloadSummary.payloadCount} (${payloadSummary.unresolvedPayloadCount} missing)`
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
    <SidebarSection title="File Info">
      <SidebarKeyValueRows rows={summaryRows} />
      {warnings.length > 0 ? (
        <div className="file-warning-summary">
          <span className="file-warning-summary-title">
            {warnings.length} warning{warnings.length === 1 ? "" : "s"}
          </span>
          {warnings.slice(0, 3).map((warning, index) => (
            <span
              className="file-warning-summary-line"
              key={`${warning}:${index}`}
            >
              {warning}
            </span>
          ))}
        </div>
      ) : null}
    </SidebarSection>
  );
}
