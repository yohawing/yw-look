import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { TexturesSidebarPanel } from "../TexturesSidebarPanel";
import { useFileStore } from "../../stores/fileStore";
import { useViewerStore } from "../../stores/viewerStore";
import type { AssetMetadata, TextureEntry } from "../../types/viewer";

const texture: TextureEntry = {
  id: "tex-1",
  label: "diffuse.bmp",
  channel: "Base Color",
  dimensions: "128x128",
  thumbnailUrl: null,
  sourceKind: "external",
};

beforeEach(() => {
  useFileStore.setState({
    currentFile: null,
    directoryListing: null,
    assetInspection: null,
    assetMetadata: null,
    packFileRequest: null,
    openError: null,
  });
  useViewerStore.setState({
    selectedTextureId: null,
    viewerSurfaceMode: "asset",
  });
});

afterEach(() => {
  cleanup();
});

function makeMetadata(textures: TextureEntry[]): AssetMetadata {
  return {
    formatLabel: "Test",
    formatVersion: null,
    nodeCount: 0,
    meshCount: 0,
    materialCount: 0,
    textureCount: textures.length,
    hasAnimation: false,
    hierarchy: [],
    textures,
    materials: [],
    lights: [],
    cameras: [],
    objectInfo: {},
  };
}

function renderWithTextures(textures: TextureEntry[]) {
  useFileStore.setState({
    assetMetadata: makeMetadata(textures),
  });
  return render(<TexturesSidebarPanel />);
}

describe("TexturesSidebarPanel", () => {
  it("selects a texture and switches the viewport to texture mode", () => {
    const { getByRole } = renderWithTextures([texture]);

    fireEvent.click(getByRole("button", { name: /diffuse\.bmp/i }));

    const state = useViewerStore.getState();
    expect(state.selectedTextureId).toBe("tex-1");
    expect(state.viewerSurfaceMode).toBe("texture");
  });

  it("returns to asset mode when the active texture is selected again", () => {
    useViewerStore.setState({
      selectedTextureId: "tex-1",
      viewerSurfaceMode: "texture",
    });
    const { getByRole } = renderWithTextures([texture]);

    fireEvent.click(getByRole("button", { name: /diffuse\.bmp/i }));

    const state = useViewerStore.getState();
    expect(state.selectedTextureId).toBe("tex-1");
    expect(state.viewerSurfaceMode).toBe("asset");
  });

  it("keeps shared GPU texture channels distinct for selection toggles", () => {
    const sharedTextures: TextureEntry[] = [
      { ...texture, id: "shared-texture", channel: "Metalness" },
      { ...texture, id: "shared-texture", channel: "Roughness" },
    ];
    useViewerStore.setState({
      selectedTextureId: "shared-texture",
      viewerSurfaceMode: "texture",
    });
    const { container } = renderWithTextures(sharedTextures);
    const rows = () => container.querySelectorAll(".texture-row");

    expect(rows()[0]?.classList.contains("is-active")).toBe(true);
    expect(rows()[1]?.classList.contains("is-active")).toBe(false);
    fireEvent.click(rows()[1] as HTMLElement);

    expect(useViewerStore.getState().selectedTextureId).toBe("shared-texture");
    expect(useViewerStore.getState().viewerSurfaceMode).toBe("texture");
    expect(
      container.querySelector(".texture-detail-grid")?.textContent,
    ).toContain("Roughness");
    expect(rows()[0]?.classList.contains("is-active")).toBe(false);
    expect(rows()[1]?.classList.contains("is-active")).toBe(true);

    fireEvent.click(rows()[1] as HTMLElement);
    expect(useViewerStore.getState().viewerSurfaceMode).toBe("asset");
  });
});
