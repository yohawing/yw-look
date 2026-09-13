import { t } from "../lib/i18n";
import type { AppStatusBarItem } from "./AppStatusBar";
import type { AssetMetadata } from "./assetMetadata";
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
          : t("viewer.status", { status: viewerStatusLabel }),
      },
    ];
  }

  const items: AppStatusBarItem[] = [
    {
      id: "file",
      content:
        viewerFeedback.mode === "loading"
          ? t("viewer.loading", { file: currentFile.fileName })
          : t("viewer.loaded", { file: currentFile.fileName }),
    },
  ];

  if (assetMetadata && assetMetadata.meshCount > 0) {
    items.push({
      id: "meshes",
      content: t("viewer.meshes", { count: assetMetadata.meshCount }),
    });
  }

  if (assetMetadata && assetMetadata.materialCount > 0) {
    items.push({
      id: "materials",
      content: t("viewer.materials", { count: assetMetadata.materialCount }),
    });
  }

  if (showGrid) {
    items.push({
      id: "grid",
      content: t("viewer.grid", { unit: gridUnitLabel }),
    });
  }

  return items;
}

export function buildStatusRightItems({
  currentFileSummary,
}: {
  currentFileSummary: string;
}): AppStatusBarItem[] {
  const items: AppStatusBarItem[] = [];

  if (currentFileSummary !== "none") {
    items.push({ id: "summary", content: currentFileSummary, mono: true });
  }

  return items;
}
