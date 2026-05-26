import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
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

describe("TextureListCard", () => {
  it("flips thumbnails when the texture metadata requests previewFlipY", () => {
    const { getByAltText } = render(
      <TextureListCard
        textures={[{ ...baseTexture, previewFlipY: true }]}
        activeTextureId={null}
        onSelectTexture={vi.fn()}
      />,
    );

    expect(getByAltText("diffuse.bmp").className).toContain(
      "is-preview-flipped-y",
    );
  });
});
