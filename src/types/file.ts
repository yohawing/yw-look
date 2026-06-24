export type AssetKind = "model" | "texture" | "motion" | "unknown";

export type SelectedFile = {
  path: string;
  fileName: string;
  extension: string;
  kind: AssetKind;
  parentDirectory: string;
};

export type DirectoryListing = {
  files: SelectedFile[];
  currentIndex: number | null;
};

export type ImageDimensions = {
  width: number;
  height: number;
  source: string;
};

export type AssetInspection = {
  path: string;
  fileName: string;
  extension: string;
  kind: AssetKind;
  fileSizeBytes: number;
  modifiedAt: string | null;
  createdAt: string | null;
  previewImplemented: boolean;
  imageDimensions: ImageDimensions | null;
};

export type FormatSupport = {
  modelExtensions: string[];
  textureExtensions: string[];
  motionExtensions: string[];
  previewImplemented: string[];
};

export type RecentFileEntry = {
  path: string;
  kind: string;
  lastAccessedAt: string;
};

export type RecentFilesPayload = {
  recentFilesPath: string;
  entries: RecentFileEntry[];
};
