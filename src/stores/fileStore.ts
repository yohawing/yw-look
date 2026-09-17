import { create } from "zustand";
import type {
  AssetInspection,
  DirectoryListing,
  SelectedFile,
} from "../lib/files";
import type { PackFileRequest, PackMetadata } from "../types/format-pack";
import type { AssetMetadata } from "../types/viewer";

export interface FileState {
  externalReload: {
    path: string;
    revision: number;
    status: "loading" | "done" | "failed";
    error?: string;
  } | null;
  requestExternalReload: (file: SelectedFile) => void;
  finishExternalReload: (revision: number, error?: string) => void;
  currentFile: SelectedFile | null;
  packFileRequest: PackFileRequest | null;
  packMetadata: PackMetadata | null;
  assetInspection: AssetInspection | null;
  directoryListing: DirectoryListing | null;
  openError: string | null;
  assetMetadata: AssetMetadata | null;

  setCurrentFile: (v: SelectedFile | null) => void;
  setPackFileRequest: (v: PackFileRequest | null) => void;
  setPackMetadata: (v: PackMetadata | null) => void;
  setAssetInspection: (v: AssetInspection | null) => void;
  setDirectoryListing: (v: DirectoryListing | null) => void;
  setOpenError: (v: string | null) => void;
  setAssetMetadata: (v: AssetMetadata | null) => void;
}

export const useFileStore = create<FileState>((set) => ({
  externalReload: null,
  requestExternalReload: (file) =>
    set((state) => {
      const revision = (state.externalReload?.revision ?? 0) + 1;
      return {
        currentFile: { ...file, reloadRevision: revision },
        externalReload: { path: file.path, revision, status: "loading" },
      };
    }),
  finishExternalReload: (revision, error) =>
    set((state) =>
      state.externalReload?.revision === revision
        ? {
            externalReload: {
              ...state.externalReload,
              status: error ? "failed" : "done",
              error,
            },
          }
        : {},
    ),
  currentFile: null,
  packFileRequest: null,
  packMetadata: null,
  assetInspection: null,
  directoryListing: null,
  openError: null,
  assetMetadata: null,

  setCurrentFile: (currentFile) => set({ currentFile, externalReload: null }),
  setPackFileRequest: (packFileRequest) => set({ packFileRequest }),
  setPackMetadata: (packMetadata) => set({ packMetadata }),
  setAssetInspection: (assetInspection) => set({ assetInspection }),
  setDirectoryListing: (directoryListing) => set({ directoryListing }),
  setOpenError: (openError) => set({ openError }),
  setAssetMetadata: (assetMetadata) => set({ assetMetadata }),
}));
