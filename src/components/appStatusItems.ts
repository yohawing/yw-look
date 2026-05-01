import type { AppStatusBarItem } from "./AppStatusBar";
import type { AssetMetadata } from "./assetMetadata";
import type { PerformanceSnapshot } from "./PerformanceCard";
import type { ViewerFeedback } from "./AssetViewport";
import type { SelectedFile } from "../lib/files";

function formatStatusError(message: string): string {
  if (
    message.includes("reading 'invoke'") ||
    message.includes("not available") ||
    message.includes("__TAURI__")
  ) {
    return "Native API unavailable";
  }

  return message;
}

export function buildStatusLeftItems({
  assetMetadata,
  currentFile,
  gridUnitLabel,
  settingsError,
  showGrid,
  viewerFeedback,
  viewerStatusLabel,
}: {
  assetMetadata: AssetMetadata | null;
  currentFile: SelectedFile | null;
  gridUnitLabel: string;
  settingsError: string | null;
  showGrid: boolean;
  viewerFeedback: ViewerFeedback;
  viewerStatusLabel: string;
}): AppStatusBarItem[] {
  if (!currentFile) {
    return [
      {
        id: "viewer",
        content: settingsError
          ? formatStatusError(settingsError)
          : `Viewer: ${viewerStatusLabel}`,
      },
    ];
  }

  const items: AppStatusBarItem[] = [
    {
      id: "file",
      content:
        viewerFeedback.mode === "loading"
          ? `Loading: ${currentFile.fileName}`
          : `Model loaded: ${currentFile.fileName}`,
    },
  ];

  if (assetMetadata && assetMetadata.meshCount > 0) {
    items.push({ id: "meshes", content: `${assetMetadata.meshCount} meshes` });
  }

  if (assetMetadata && assetMetadata.materialCount > 0) {
    items.push({
      id: "materials",
      content: `${assetMetadata.materialCount} materials`,
    });
  }

  if (showGrid) {
    items.push({ id: "grid", content: `Grid: ${gridUnitLabel}` });
  }

  return items;
}

export function buildStatusRightItems({
  currentFileSummary,
  performanceSnapshot,
}: {
  currentFileSummary: string;
  performanceSnapshot: PerformanceSnapshot;
}): AppStatusBarItem[] {
  const items: AppStatusBarItem[] = [];

  if (performanceSnapshot.loadMs !== null) {
    items.push({
      id: "load",
      content: `Load: ${performanceSnapshot.loadMs.toFixed(0)}ms`,
      mono: true,
    });
  }

  if (currentFileSummary !== "none") {
    items.push({ id: "summary", content: currentFileSummary, mono: true });
  }

  return items;
}
