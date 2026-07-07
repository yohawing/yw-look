import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { TextureListCard } from "../TextureListCard";
import type { TextureEntry } from "../assetMetadata";

afterEach(() => {
  cleanup();
});

const baseTexture: TextureEntry = {
  id: "tex-1",
  label: "diffuse.bmp",
  channel: "Base Color",
  dimensions: "128x128",
  thumbnailUrl: "data:image/png;base64,texture",
  sourceKind: "external",
};

function renderTextureListCard(
  textures: TextureEntry[],
  activeTextureId: string | null = null,
  onSelectTexture = vi.fn(),
) {
  return {
    onSelectTexture,
    ...render(
      <TextureListCard
        textures={textures}
        activeTextureId={activeTextureId}
        onSelectTexture={onSelectTexture}
      />,
    ),
  };
}

describe("TextureListCard", () => {
  it("flips thumbnails when the texture metadata requests previewFlipY", () => {
    const { getByAltText } = renderTextureListCard([
      { ...baseTexture, previewFlipY: true },
    ]);

    expect(getByAltText("diffuse.bmp").className).toContain(
      "is-preview-flipped-y",
    );
  });

  it("renders texture cards as SelectableListItem buttons inside the texture grid", () => {
    const { container } = renderTextureListCard([baseTexture]);

    const grid = container.querySelector(".texture-grid");
    expect(grid).not.toBeNull();

    const card = grid?.querySelector("button.texture-card");
    expect(card).not.toBeNull();
    expect(card?.classList.contains("yl-button")).toBe(true);
    expect(card?.classList.contains("yl-button--unstyled")).toBe(true);
    expect(card?.classList.contains("yl-selectable-list-item")).toBe(true);
    expect(card?.classList.contains("texture-card")).toBe(true);
    expect(card?.classList.contains("u-relative")).toBe(true);
    expect(card?.classList.contains("u-aspect-square")).toBe(true);
    expect(card?.classList.contains("u-overflow-hidden")).toBe(true);
    expect(card?.classList.contains("u-p-0")).toBe(true);
  });

  it("calls onSelectTexture when a texture card is clicked", () => {
    const onSelectTexture = vi.fn();
    const { getByRole } = renderTextureListCard(
      [baseTexture],
      null,
      onSelectTexture,
    );

    fireEvent.click(getByRole("button", { name: /diffuse\.bmp/i }));

    expect(onSelectTexture).toHaveBeenCalledTimes(1);
    expect(onSelectTexture).toHaveBeenCalledWith("tex-1");
  });

  it("applies is-active to the selected texture card", () => {
    const { container } = renderTextureListCard([baseTexture], "tex-1");

    const card = container.querySelector("button.texture-card");
    expect(card?.classList.contains("is-active")).toBe(true);
    expect(card?.classList.contains("is-missing")).toBe(false);
  });

  it("applies is-missing to unresolved texture cards", () => {
    const missingTexture: TextureEntry = {
      ...baseTexture,
      id: "tex-missing",
      label: "missing.bmp",
      sourceKind: "unresolved",
      thumbnailUrl: null,
    };
    const { container } = renderTextureListCard([missingTexture]);

    const card = container.querySelector("button.texture-card");
    expect(card?.classList.contains("is-missing")).toBe(true);
    expect(card?.classList.contains("is-active")).toBe(false);
  });
});
