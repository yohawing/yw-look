import type {
  AssetInspection as GeneratedAssetInspection,
  DirectoryListingPayload as GeneratedDirectoryListing,
  FormatSupportPayload as GeneratedFormatSupport,
  ImageDimensions as GeneratedImageDimensions,
  RecentFileEntry as GeneratedRecentFileEntry,
  RecentFilesPayload as GeneratedRecentFilesPayload,
  SelectedFilePayload as GeneratedSelectedFile,
} from "./generated/ipc";

// Frontend-normalized kind union. Rust serializes kind as a plain string.
export type AssetKind = "model" | "texture" | "motion" | "unknown";

export type SelectedFile = Omit<GeneratedSelectedFile, "kind"> & {
  kind: AssetKind;
};

export type DirectoryListing = Omit<GeneratedDirectoryListing, "files"> & {
  files: SelectedFile[];
};

export type ImageDimensions = GeneratedImageDimensions;

export type AssetInspection = Omit<GeneratedAssetInspection, "kind"> & {
  kind: AssetKind;
};

export type FormatSupport = GeneratedFormatSupport;

export type RecentFileEntry = GeneratedRecentFileEntry;

export type RecentFilesPayload = GeneratedRecentFilesPayload;
