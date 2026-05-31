import { create } from "zustand";
import type {
  AssetInspection,
  DirectoryListing,
  SelectedFile,
} from "../lib/files";
import type { AssetMetadata } from "../components/assetMetadata";

export interface FileState {
  currentFile: SelectedFile | null;
  mmdMotionRequest: { file: SelectedFile; version: number } | null;
  assetInspection: AssetInspection | null;
  directoryListing: DirectoryListing | null;
  openError: string | null;
  assetMetadata: AssetMetadata | null;

  setCurrentFile: (v: SelectedFile | null) => void;
  setMmdMotionRequest: (
    v: { file: SelectedFile; version: number } | null,
  ) => void;
  setAssetInspection: (v: AssetInspection | null) => void;
  setDirectoryListing: (v: DirectoryListing | null) => void;
  setOpenError: (v: string | null) => void;
  setAssetMetadata: (v: AssetMetadata | null) => void;
}

export const useFileStore = create<FileState>((set) => ({
  currentFile: null,
  mmdMotionRequest: null,
  assetInspection: null,
  directoryListing: null,
  openError: null,
  assetMetadata: null,

  setCurrentFile: (currentFile) => set({ currentFile }),
  setMmdMotionRequest: (mmdMotionRequest) => set({ mmdMotionRequest }),
  setAssetInspection: (assetInspection) => set({ assetInspection }),
  setDirectoryListing: (directoryListing) => set({ directoryListing }),
  setOpenError: (openError) => set({ openError }),
  setAssetMetadata: (assetMetadata) => set({ assetMetadata }),
}));
