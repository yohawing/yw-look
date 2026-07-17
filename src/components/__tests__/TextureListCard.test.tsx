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

  it("renders compact texture rows as SelectableListItem buttons", () => {
    const { container } = renderTextureListCard([baseTexture]);

    const list = container.querySelector(".texture-list");
    expect(list).not.toBeNull();

    const row = list?.querySelector("button.texture-row");
    expect(row).not.toBeNull();
    expect(row?.classList.contains("yl-button")).toBe(true);
    expect(row?.classList.contains("yl-button--unstyled")).toBe(true);
    expect(row?.classList.contains("yl-selectable-list-item")).toBe(true);
    expect(row?.querySelector(".texture-row-preview")).not.toBeNull();
    expect(row?.querySelector(".texture-row-info")).not.toBeNull();
    expect(row?.textContent).toContain("BMP · Base Color · 128×128");
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

    const row = container.querySelector("button.texture-row");
    expect(row?.classList.contains("is-active")).toBe(true);
    expect(row?.classList.contains("is-missing")).toBe(false);
  });

  it("keeps the texture grid and selected texture details in split panes", () => {
    const { container, getAllByText, getByLabelText, getByText } =
      renderTextureListCard([{ ...baseTexture, previewFlipY: true }], "tex-1");

    expect(container.querySelector(".texture-split-panel")).toBeTruthy();
    expect(
      container
        .querySelector(".texture-split-panel")
        ?.classList.contains("yl-sidebar-split"),
    ).toBe(true);
    expect(
      container.querySelectorAll(".yl-sidebar-split__section"),
    ).toHaveLength(2);
    expect(container.querySelector(".texture-grid-pane")).toBeTruthy();
    expect(container.querySelector(".texture-detail-pane")).toBeTruthy();
    expect(
      container.querySelector(".texture-detail-layout > .texture-summary"),
    ).toBeTruthy();
    expect(getByLabelText("Selected texture")).toBeTruthy();
    expect(
      container
        .querySelector(".texture-resize-handle")
        ?.getAttribute("aria-label"),
    ).toBe("Resize texture details");
    expect(getByText("Selected texture")).toBeTruthy();
    expect(getAllByText("diffuse.bmp").length).toBeGreaterThan(1);
    expect(getByText("BMP")).toBeTruthy();
    expect(getAllByText("Base Color").length).toBeGreaterThan(1);
    expect(getAllByText("128x128").length).toBeGreaterThan(0);
    expect(getByText("Flip Y")).toBeTruthy();
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

    const row = container.querySelector("button.texture-row");
    expect(row?.classList.contains("is-missing")).toBe(true);
    expect(row?.classList.contains("is-active")).toBe(false);
  });

  it("keeps the split layout and bottom summary in the empty state", () => {
    const { container, getByText } = renderTextureListCard([]);

    expect(getByText("No textures referenced.")).toBeTruthy();
    expect(getByText("Select a texture to inspect it.")).toBeTruthy();
    expect(container.querySelector(".texture-split-panel")).toBeTruthy();
    expect(
      container.querySelector(".texture-detail-layout > .texture-summary"),
    ).toBeTruthy();
  });
});
