import type { AssetInspection, SelectedFile } from "../lib/files";
import type { AnimationClipMetadata } from "../types/viewer";
import type { PerformanceSnapshot } from "./PerformanceCard";
import type { AssetMetadata } from "./assetMetadata";
import {
  SidebarEmpty,
  SidebarKeyValueRows,
  SidebarSection,
  type SidebarKeyValueRow,
} from "./sidebarPrimitives";

type CurrentFileCardProps = {
  animationClips?: AnimationClipMetadata[];
  assetInspection: AssetInspection | null;
  currentFile: SelectedFile | null;
  metadata: AssetMetadata | null;
  performanceSnapshot: PerformanceSnapshot;
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

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && size >= 1024; i += 1) {
    size /= 1024;
    unit = units[i];
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
}

function formatMs(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)} ms`;
}

function formatDuration(value: number) {
  if (!Number.isFinite(value)) return "—";

  const totalMs = Math.max(0, Math.round(value * 1000));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const milliseconds = totalMs % 1000;

  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
}

function formatNumber(value: number) {
  return Intl.NumberFormat("en-US").format(value);
}

function formatFps(value: number | null) {
  return value === null ? "n/a" : `${value.toFixed(1)} fps`;
}

export function CurrentFileCard({
  animationClips = [],
  assetInspection,
  currentFile,
  metadata,
  performanceSnapshot,
  usdPayloadSummary,
  warnings,
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
  const visibleAnimationClips = animationClips.length > 0 ? animationClips : [];

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
      id: "load-time",
      label: "Load time",
      value: formatMs(performanceSnapshot.loadMs),
      mono: true,
      tone: performanceSnapshot.loadMs === null ? "muted" : "default",
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

  const fileRows: SidebarKeyValueRow[] = [
    { id: "name", label: "Name", value: currentFile.fileName, mono: true },
    {
      id: "type",
      label: "Type",
      value:
        currentFile.kind === "model"
          ? "3D Model"
          : currentFile.kind === "motion"
            ? "Motion"
            : "Texture",
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

  return (
    <>
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
                title={warning}
              >
                {warning}
              </span>
            ))}
          </div>
        ) : null}
        {visibleAnimationClips.length > 0 ? (
          <SidebarSection
            title="Animation"
            count={visibleAnimationClips.length}
            collapsible
            defaultOpen={false}
          >
            <ul className="file-animation-list">
              {visibleAnimationClips.map((clip, index) => (
                <li
                  className="file-animation-row"
                  key={`${clip.name}:${index}`}
                >
                  <span className="file-animation-name" title={clip.name}>
                    {clip.name}
                  </span>
                  <span className="file-animation-meta">
                    <span>Duration {formatDuration(clip.duration)}</span>
                    <span>FPS {formatFps(clip.estimatedFrameRate)}</span>
                    <span>Keys {formatNumber(clip.keyframeCount)}</span>
                    <span>Tracks {formatNumber(clip.trackCount)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </SidebarSection>
        ) : null}
      </SidebarSection>
      <SidebarSection title="File Details" collapsible defaultOpen={false}>
        <SidebarKeyValueRows rows={fileRows} />
      </SidebarSection>
      {metadata ? (
        <SidebarSection
          title="Scene Details"
          count={metadata.nodeCount}
          collapsible
          defaultOpen={false}
        >
          <SidebarKeyValueRows rows={geometryRows} />
        </SidebarSection>
      ) : null}
    </>
  );
}
