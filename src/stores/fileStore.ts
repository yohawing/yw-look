import { create } from "zustand";
import type {
  AssetInspection,
  DirectoryListing,
  SelectedFile,
} from "../lib/files";
import type { PackFileRequest, PackMetadata } from "../types/format-pack";
import type { AssetMetadata } from "../types/viewer";

export interface FileState {
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
  currentFile: null,
  packFileRequest: null,
  packMetadata: null,
  assetInspection: null,
  directoryListing: null,
  openError: null,
  assetMetadata: null,

  setCurrentFile: (currentFile) => set({ currentFile }),
  setPackFileRequest: (packFileRequest) => set({ packFileRequest }),
  setPackMetadata: (packMetadata) => set({ packMetadata }),
  setAssetInspection: (assetInspection) => set({ assetInspection }),
  setDirectoryListing: (directoryListing) => set({ directoryListing }),
  setOpenError: (openError) => set({ openError }),
  setAssetMetadata: (assetMetadata) => set({ assetMetadata }),
}));
