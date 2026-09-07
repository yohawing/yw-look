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
  sourcePath: "C:/assets/textures/diffuse.bmp",
  channel: "Base Color",
  dimensions: "128x128",
  thumbnailUrl: "data:image/png;base64,texture",
  sourceKind: "external",
};

function renderTextureListCard(
  textures: TextureEntry[],
  activeTextureId: string | null = null,
  onSelectTexture = vi.fn(),
  fileIdentity: string | null = null,
) {
  return {
    onSelectTexture,
    ...render(
      <TextureListCard
        textures={textures}
        activeTextureId={activeTextureId}
        fileIdentity={fileIdentity}
        onSelectTexture={onSelectTexture}
      />,
    ),
  };
}

describe("TextureListCard", () => {
  it("shows an embedded texture container separately from its internal path", () => {
    const { getByText, getByTitle } = renderTextureListCard(
      [
        {
          ...baseTexture,
          sourceKind: "embedded",
          sourcePath: "F:/toy.usdz[a/diffuse.bmp]",
          containerPath: "F:/toy.usdz",
          internalPath: "a/diffuse.bmp",
        },
      ],
      baseTexture.id,
    );
    expect(getByText("Container")).toBeTruthy();
    expect(getByText("Internal Path")).toBeTruthy();
    expect(getByTitle("F:/toy.usdz")).toBeTruthy();
    expect(getByTitle("a/diffuse.bmp")).toBeTruthy();
    expect(getByText("embedded")).toBeTruthy();
  });
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
    expect(onSelectTexture).toHaveBeenCalledWith("tex-1", false);
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
    expect(getByText("Path")).toBeTruthy();
    expect(getByText("C:/assets/textures/diffuse.bmp")).toBeTruthy();
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

  it("filters labels and source paths with the channel filter as an AND condition", () => {
    const textures: TextureEntry[] = [
      baseTexture,
      {
        ...baseTexture,
        id: "tex-2",
        label: "normal.png",
        sourcePath: "C:/assets/body/normal.png",
        channel: "Normal",
      },
      {
        ...baseTexture,
        id: "tex-3",
        label: "roughness.png",
        sourcePath: "C:/assets/other/roughness.png",
        channel: "Normal",
      },
    ];
    const { container, getByRole, getByText } = renderTextureListCard(textures);
    const filter = getByRole("textbox", { name: "Filter textures" });

    fireEvent.change(filter, { target: { value: "BODY" } });
    expect(container.querySelectorAll(".texture-row")).toHaveLength(1);
    expect(
      getByText("normal.png", { selector: ".texture-row-label" }),
    ).toBeTruthy();

    fireEvent.click(getByRole("button", { name: "Normal" }));
    expect(container.querySelectorAll(".texture-row")).toHaveLength(1);

    fireEvent.change(filter, { target: { value: "no-match" } });
    expect(getByText("No textures match.")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "Clear texture filter" }));
    expect(container.querySelectorAll(".texture-row")).toHaveLength(2);
  });

  it("keeps selected texture details visible when its row is filtered out", () => {
    const selected = {
      ...baseTexture,
      id: "tex-2",
      label: "normal.png",
      sourcePath: "C:/assets/textures/normal.png",
    };
    const { container, getByRole, getByText } = renderTextureListCard(
      [baseTexture, selected],
      "tex-2",
    );

    fireEvent.change(getByRole("textbox", { name: "Filter textures" }), {
      target: { value: "diffuse" },
    });

    expect(container.querySelectorAll(".texture-row")).toHaveLength(1);
    expect(getByText("normal.png")).toBeTruthy();
  });

  it("resets its filter when the current file identity changes", () => {
    const { getByRole, rerender } = renderTextureListCard([baseTexture], null);
    const filter = getByRole("textbox", { name: "Filter textures" });
    fireEvent.change(filter, { target: { value: "diffuse" } });
    rerender(
      <TextureListCard
        activeTextureId={null}
        fileIdentity="C:/assets/other.glb"
        onSelectTexture={vi.fn()}
        textures={[baseTexture]}
      />,
    );

    expect(
      (getByRole("textbox", { name: "Filter textures" }) as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("accepts Japanese IME input and keeps duplicate labels visible", () => {
    const duplicate: TextureEntry = {
      ...baseTexture,
      id: "tex-2",
    };
    const japanese: TextureEntry = {
      ...baseTexture,
      id: "tex-ja",
      label: "肌色.png",
      sourcePath: "C:/assets/肌色.png",
    };
    const { container, getByRole } = renderTextureListCard([
      baseTexture,
      duplicate,
      japanese,
    ]);
    const filter = getByRole("textbox", { name: "Filter textures" });

    fireEvent.change(filter, { target: { value: "diffuse" } });
    expect(container.querySelectorAll(".texture-row")).toHaveLength(2);
    fireEvent.compositionStart(filter);
    fireEvent.change(filter, { target: { value: "肌色" } });
    fireEvent.compositionEnd(filter);
    expect(container.querySelectorAll(".texture-row")).toHaveLength(1);
  });

  it("keeps shared GPU texture channels as independent selected rows", () => {
    const sharedTextures: TextureEntry[] = [
      {
        ...baseTexture,
        id: "shared-texture",
        label: "shared.png",
        channel: "Metalness",
      },
      {
        ...baseTexture,
        id: "shared-texture",
        label: "shared.png",
        channel: "Roughness",
      },
    ];
    const onSelectTexture = vi.fn();
    const { container, getByLabelText, getByRole, rerender } =
      renderTextureListCard(
        sharedTextures,
        "shared-texture",
        onSelectTexture,
        "file-a",
      );
    const rows = () => container.querySelectorAll(".texture-row");

    expect(rows()).toHaveLength(2);
    expect(rows()[0]?.classList.contains("is-active")).toBe(true);
    expect(rows()[1]?.classList.contains("is-active")).toBe(false);

    fireEvent.click(rows()[1] as HTMLElement);
    expect(rows()[0]?.classList.contains("is-active")).toBe(false);
    expect(rows()[1]?.classList.contains("is-active")).toBe(true);
    expect(getByLabelText("Selected texture").textContent).toContain(
      "Roughness",
    );

    fireEvent.click(getByRole("button", { name: "Metalness" }));
    expect(rows()).toHaveLength(1);
    expect(getByLabelText("Selected texture").textContent).toContain(
      "Roughness",
    );
    fireEvent.click(getByRole("button", { name: "All" }));
    expect(rows()).toHaveLength(2);
    expect(rows()[1]?.classList.contains("is-active")).toBe(true);

    const refreshed = sharedTextures.map((texture) => ({
      ...texture,
      thumbnailUrl: "data:image/png;base64,refreshed",
    }));
    rerender(
      <TextureListCard
        activeTextureId="shared-texture"
        fileIdentity="file-a"
        onSelectTexture={onSelectTexture}
        textures={refreshed}
      />,
    );
    expect(rows()[1]?.classList.contains("is-active")).toBe(true);
    expect(getByLabelText("Selected texture").textContent).toContain(
      "Roughness",
    );

    rerender(
      <TextureListCard
        activeTextureId="shared-texture"
        fileIdentity="file-b"
        onSelectTexture={onSelectTexture}
        textures={refreshed}
      />,
    );
    expect(rows()[0]?.classList.contains("is-active")).toBe(true);
    expect(rows()[1]?.classList.contains("is-active")).toBe(false);
    expect(getByLabelText("Selected texture").textContent).toContain(
      "Metalness",
    );
  });
});
