import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CurrentFileCard } from "../CurrentFileCard";
import type { AssetInspection, SelectedFile } from "../../lib/files";
import { useFileStore } from "../../stores/fileStore";
import type { AssetMetadata } from "../../types/viewer";

describe("CurrentFileCard", () => {
  const makeFile = (overrides: Partial<SelectedFile> = {}): SelectedFile => ({
    path: "/projects/demo/scene.usd",
    fileName: "scene.usd",
    extension: "usd",
    kind: "model",
    parentDirectory: "/projects/demo",
    ...overrides,
  });

  const makeAssetInspection = (
    overrides: Partial<AssetInspection> = {},
  ): AssetInspection => ({
    path: "/projects/demo/scene.usd",
    fileName: "scene.usd",
    extension: "usd",
    kind: "model",
    fileSizeBytes: 2048,
    modifiedAt: null,
    createdAt: null,
    previewImplemented: true,
    imageDimensions: null,
    ...overrides,
  });

  const makeMetadata = (
    overrides: Partial<AssetMetadata> = {},
  ): AssetMetadata => ({
    formatLabel: "Universal Scene Description",
    formatVersion: "23.11",
    nodeCount: 0,
    meshCount: 3,
    materialCount: 2,
    textureCount: 1,
    hasAnimation: false,
    hierarchy: [],
    textures: [],
    materials: [],
    lights: [],
    cameras: [],
    objectInfo: {},
    ...overrides,
  });

  const renderWithFileState = ({
    currentFile,
    assetInspection,
    assetMetadata = null,
  }: {
    currentFile: SelectedFile | null;
    assetInspection: AssetInspection | null;
    assetMetadata?: AssetMetadata | null;
  }) => {
    useFileStore.setState({
      currentFile,
      directoryListing: null,
      assetInspection,
      assetMetadata,
      packFileRequest: null,
      openError: null,
    });
    render(<CurrentFileCard warnings={[]} />);
  };

  it("renders file size from the file store asset inspection", () => {
    renderWithFileState({
      currentFile: makeFile(),
      assetInspection: makeAssetInspection(),
    });

    expect(screen.queryByText("File size")).not.toBeNull();
    expect(screen.queryByText("2.0 KB")).not.toBeNull();
  });

  it("renders summary metadata from the file store", () => {
    renderWithFileState({
      currentFile: makeFile(),
      assetInspection: makeAssetInspection(),
      assetMetadata: makeMetadata(),
    });

    expect(
      screen.queryByText("Universal Scene Description 23.11"),
    ).not.toBeNull();
    expect(screen.queryByText("3")).not.toBeNull();
    expect(screen.queryByText("2")).not.toBeNull();
  });

  it("renders an empty file state when no current file is selected", () => {
    renderWithFileState({
      currentFile: null,
      assetInspection: null,
    });

    expect(screen.queryByText(/No file selected/)).not.toBeNull();
  });
});
