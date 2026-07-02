import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { TexturesSidebarPanel } from "../TexturesSidebarPanel";
import { useViewerStore } from "../../stores/viewerStore";
import type { TextureEntry } from "../../types/viewer";

const texture: TextureEntry = {
  id: "tex-1",
  label: "diffuse.bmp",
  channel: "Base Color",
  dimensions: "128x128",
  thumbnailUrl: null,
  sourceKind: "external",
};

beforeEach(() => {
  useViewerStore.setState({
    selectedTextureId: null,
    viewerSurfaceMode: "asset",
  });
});

afterEach(() => {
  cleanup();
});

describe("TexturesSidebarPanel", () => {
  it("selects a texture and switches the viewport to texture mode", () => {
    const { getByRole } = render(<TexturesSidebarPanel textures={[texture]} />);

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
    const { getByRole } = render(<TexturesSidebarPanel textures={[texture]} />);

    fireEvent.click(getByRole("button", { name: /diffuse\.bmp/i }));

    const state = useViewerStore.getState();
    expect(state.selectedTextureId).toBe("tex-1");
    expect(state.viewerSurfaceMode).toBe("asset");
  });
});
