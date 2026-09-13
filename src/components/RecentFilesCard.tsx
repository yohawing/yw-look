import { t, useLocale } from "../lib/i18n";
import type { RecentFilesPayload } from "../lib/recentFiles";
import { formatFileKindLabel } from "../lib/fileKindLabel";
import { AsyncSidebarSection, SidebarEmpty } from "../lib/sidebarPrimitives";
import { FileItemList, type FileItemListEntry } from "./FileItemList";

type RecentFilesCardProps = {
  recentFilesPayload: RecentFilesPayload | null;
  recentFilesError: string | null;
  onOpenPath: (path: string) => void;
};

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function RecentFilesCard({
  recentFilesPayload,
  recentFilesError,
  onOpenPath,
}: RecentFilesCardProps) {
  useLocale();
  return (
    <AsyncSidebarSection
      title={t("recent_files")}
      error={recentFilesError}
      data={recentFilesPayload}
      loadingLabel={t("recent.loading")}
      count={(payload) => payload.entries.length}
    >
      {(payload) =>
        payload.entries.length > 0 ? (
          <FileItemList
            items={payload.entries.map((entry): FileItemListEntry => ({
              id: entry.path,
              name: basename(entry.path),
              leading: formatFileKindLabel(entry.kind),
              tooltip: entry.path,
              onSelect: () => onOpenPath(entry.path),
            }))}
          />
        ) : (
          <SidebarEmpty>{t("no_recent_files_recorded_yet")}</SidebarEmpty>
        )
      }
    </AsyncSidebarSection>
  );
}
