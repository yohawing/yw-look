import { TexturesSidebarPanel } from "../TexturesSidebarPanel";
import { useUiStore } from "../../stores/uiStore";
/**
 * Tests for MaterialListCard shader-slot detail panel (#36).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { MaterialListCard } from "../MaterialListCard";
import type {
  AssetMetadata,
  MaterialEntry,
  TextureEntry,
} from "../assetMetadata";
import { useFileStore } from "../../stores/fileStore";
import { useViewerStore } from "../../stores/viewerStore";

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
    materialNavigationRequest: null,
    textureNavigationRequest: null,
    selectedTextureId: null,
    viewerSurfaceMode: "asset",
  });
});

afterEach(() => {
  cleanup();
});

const baseMat: MaterialEntry = {
  id: "mat-1",
  name: "Gold",
  type: "Mesh Standard",
  color: "#b5a642",
  opacity: 1,
  transparent: false,
  textureCount: 0,
  boundMeshes: ["Sphere"],
  baseColorFactor: [0.71, 0.65, 0.26, 1.0],
  metallicFactor: 0.9,
  roughnessFactor: 0.2,
  emissiveFactor: [0, 0, 0],
  baseColorTexture: null,
  metallicRoughnessTexture: null,
  normalTexture: null,
  emissiveTexture: null,
  alphaMode: "OPAQUE",
  usdPrimPath: null,
  mmd: null,
};

function makeMetadata(
  materials: MaterialEntry[],
  textures: TextureEntry[] = [],
): AssetMetadata {
  return {
    formatLabel: "Test",
    formatVersion: null,
    nodeCount: 0,
    meshCount: 0,
    materialCount: materials.length,
    textureCount: 0,
    hasAnimation: false,
    hierarchy: [],
    textures,
    materials,
    lights: [],
    cameras: [],
    objectInfo: {},
  };
}

function renderWithMaterials(materials: MaterialEntry[]) {
  useFileStore.setState({
    assetMetadata: makeMetadata(materials),
  });
  return render(<MaterialListCard />);
}

function baseColorTexture(overrides: Partial<TextureEntry> = {}): TextureEntry {
  return {
    id: "texture-base-color",
    label: "albedo.png",
    sourcePath: "F:/textures/albedo.png",
    channel: "Base Color",
    dimensions: "1024x1024",
    thumbnailUrl: "data:image/png;base64,albedo",
    sourceKind: "external",
    ...overrides,
  };
}

describe("MaterialListCard – shader slot details (#36)", () => {
  it("shows each factor once and navigates by texture ID and channel despite identical names", () => {
    const textures: TextureEntry[] = [
      {
        id: "other",
        label: "same.png",
        channel: "Normal",
        dimensions: "8×8",
        thumbnailUrl: null,
        sourceKind: "embedded",
      },
      {
        id: "target",
        label: "same.png",
        channel: "Base Color",
        dimensions: "8×8",
        thumbnailUrl: null,
        sourceKind: "embedded",
      },
      {
        id: "target",
        label: "same.png",
        channel: "Normal",
        dimensions: "8×8",
        thumbnailUrl: null,
        sourceKind: "embedded",
      },
    ];
    useFileStore.setState({
      assetMetadata: makeMetadata(
        [
          {
            ...baseMat,
            normalTexture: { name: "same.png", textureId: "target" },
          },
        ],
        textures,
      ),
    });
    const { getByRole, getAllByText, container } = render(
      <>
        <MaterialListCard />
        <TexturesSidebarPanel />
      </>,
    );
    expect(getAllByText("Metallic")).toHaveLength(1);
    expect(getAllByText("Roughness")).toHaveLength(1);
    fireEvent.click(getByRole("button", { name: "Base Color" }));
    fireEvent.click(getByRole("button", { name: "same.png" }));
    expect(useViewerStore.getState().selectedTextureId).toBe("target");
    expect(useViewerStore.getState().textureNavigationRequest).toMatchObject({
      textureId: "target",
      channel: "Normal",
      revision: 1,
    });
    expect(useViewerStore.getState().viewerSurfaceMode).toBe("asset");
    expect(useUiStore.getState().activeTab).toBe("textures");
    expect(container.querySelectorAll(".texture-row")).toHaveLength(3);
    expect(
      container
        .querySelectorAll(".texture-row")[2]
        .classList.contains("is-active"),
    ).toBe(true);
    fireEvent.click(getByRole("button", { name: "Base Color" }));
    fireEvent.click(getByRole("button", { name: "same.png" }));
    expect(container.querySelectorAll(".texture-row")).toHaveLength(3);
    expect(useViewerStore.getState().textureNavigationRequest?.revision).toBe(
      2,
    );
  });

  it("shows only the binding count and shares detail rows with other Selected panels", () => {
    const { container, getByText, queryByText } = renderWithMaterials([
      { ...baseMat, boundMeshes: ["UniqueMeshOne", "UniqueMeshTwo"] },
    ]);
    expect(queryByText("bound meshes")).toBeNull();
    expect(queryByText("UniqueMeshOne")).toBeNull();
    expect(queryByText("UniqueMeshTwo")).toBeNull();
    expect(getByText("Bindings").closest(".yl-kv-row")?.textContent).toContain(
      "2",
    );
    expect(
      container.querySelector(".material-selected-panel > .selected-kv"),
    ).toBeTruthy();
    expect(container.querySelector(".material-selected-title")).toBeNull();
    expect(
      getByText("Material parameters")
        .closest("details")
        ?.querySelector(".selected-kv"),
    ).toBeTruthy();
  });
  it("exposes full texture and USD paths without putting locators in slot text", () => {
    const sourcePath = "F:/toy.usdz[a/normal.png]";
    const { getByTitle, getByText } = renderWithMaterials([
      {
        ...baseMat,
        usdPrimPath: "/Looks/Paint",
        normalTexture: { name: "normal.png", sourcePath },
      },
    ]);
    expect(getByText("normal.png").textContent).toBe("normal.png");
    expect(getByTitle(sourcePath)).toBeTruthy();
    expect(getByTitle("/Looks/Paint")).toBeTruthy();
  });
  it("renders material names", () => {
    const { container, getByText } = renderWithMaterials([baseMat]);
    expect(getByText("Gold")).toBeTruthy();
    expect(container.querySelector(".material-split-panel")).toBeTruthy();
    expect(
      container
        .querySelector(".material-split-panel")
        ?.classList.contains("yl-sidebar-split"),
    ).toBe(true);
    expect(
      container.querySelectorAll(".yl-sidebar-split__section"),
    ).toHaveLength(2);
    expect(container.querySelector(".material-list-pane")).toBeTruthy();
    expect(container.querySelector(".material-detail-pane")).toBeTruthy();
    expect(
      container
        .querySelector(".material-resize-handle")
        ?.getAttribute("aria-label"),
    ).toBe("Resize material details");
  });

  it("uses the diffuse texture thumbnail ahead of the base-color swatch", () => {
    useFileStore.setState({
      assetMetadata: makeMetadata(
        [
          {
            ...baseMat,
            baseColorTexture: {
              name: "albedo.png",
              sourcePath: "F:\\textures\\albedo.png",
            },
          },
        ],
        [baseColorTexture({ previewFlipY: true })],
      ),
    });
    const { container } = render(<MaterialListCard />);

    const preview = container.querySelector(
      ".material-swatch-image",
    ) as HTMLImageElement | null;
    expect(preview?.getAttribute("src")).toBe("data:image/png;base64,albedo");
    expect(preview?.classList.contains("is-preview-flipped-y")).toBe(true);
    expect(
      container.querySelector(".material-swatch")?.getAttribute("style"),
    ).toContain("background");
  });

  it("does not guess between duplicate diffuse texture names", () => {
    useFileStore.setState({
      assetMetadata: makeMetadata(
        [
          {
            ...baseMat,
            baseColorTexture: { name: "albedo.png" },
          },
        ],
        [
          baseColorTexture({ id: "first", sourcePath: "a/albedo.png" }),
          baseColorTexture({ id: "second", sourcePath: "b/albedo.png" }),
        ],
      ),
    });
    const { container } = render(<MaterialListCard />);

    expect(container.querySelector(".material-swatch-image")).toBeNull();
    expect(
      container.querySelector(".material-swatch")?.getAttribute("style"),
    ).toContain("background");
  });

  it("updates the material preview when the async thumbnail arrives", () => {
    const material = {
      ...baseMat,
      baseColorTexture: { name: "albedo.png" },
    };
    const texture = baseColorTexture({ thumbnailUrl: null });
    useFileStore.setState({
      assetMetadata: makeMetadata([material], [texture]),
    });
    const { container } = render(<MaterialListCard />);
    expect(container.querySelector(".material-swatch-image")).toBeNull();

    act(() => {
      useFileStore.setState({
        assetMetadata: makeMetadata(
          [material],
          [{ ...texture, thumbnailUrl: "data:image/png;base64,ready" }],
        ),
      });
    });

    expect(
      container.querySelector(".material-swatch-image")?.getAttribute("src"),
    ).toBe("data:image/png;base64,ready");
  });

  it("renders shader inputs summary when shader detail is present", () => {
    const { getByText } = renderWithMaterials([baseMat]);
    expect(getByText("Material parameters")).toBeTruthy();
  });

  it("renders base color hex values in the shared lowercase format", () => {
    const { getAllByText, queryByText } = renderWithMaterials([baseMat]);

    expect(getAllByText("#b5a642").length).toBeGreaterThan(0);
    expect(queryByText("#B5A642")).toBeNull();
  });

  it("keeps opacity parameters available without PBR factors", () => {
    const mat: MaterialEntry = {
      ...baseMat,
      id: "mat-none",
      baseColorFactor: null,
      metallicFactor: null,
      roughnessFactor: null,
      emissiveFactor: null,
      baseColorTexture: null,
      metallicRoughnessTexture: null,
      normalTexture: null,
      emissiveTexture: null,
      alphaMode: "OPAQUE",
      usdPrimPath: null,
    };
    const { queryByText } = renderWithMaterials([mat]);
    expect(queryByText("Material parameters")).toBeTruthy();
  });

  it("renders texture name in shader detail", () => {
    const mat: MaterialEntry = {
      ...baseMat,
      id: "mat-tex",
      baseColorTexture: { name: "albedo_4k.png" },
    };
    const { getByText } = renderWithMaterials([mat]);
    expect(getByText("albedo_4k.png")).toBeTruthy();
  });

  it("renders USD prim path when present", () => {
    const mat: MaterialEntry = {
      ...baseMat,
      id: "mat-usd",
      usdPrimPath: "/World/Materials/Gold",
    };
    const { getByText } = renderWithMaterials([mat]);
    expect(getByText("/World/Materials/Gold")).toBeTruthy();
  });

  it("renders MMD material parameters when present", () => {
    const mat: MaterialEntry = {
      ...baseMat,
      id: "mat-mmd",
      name: "材質01",
      mmd: {
        materialIndex: 3,
        name: "材質01",
        englishName: "Material01",
        diffuse: [0.8, 0.7, 0.6, 0.5],
        specular: [0.2, 0.2, 0.25],
        ambient: [0.1, 0.12, 0.14],
        specularPower: 12.5,
        edgeColor: [0, 0, 0, 1],
        edgeSize: 0.8,
        texturePath: "tex/body.png",
        sphereTexturePath: "spa/body.spa",
        sphereMode: "add",
        toonTexturePath: "toon/toon01.bmp",
        sharedToonIndex: 1,
        transparencyMode: "blend",
        renderOrderBucket: "transparent",
        faceCount: 420,
        flags: { doubleSided: true, castShadow: false },
        unsupportedDrawFlags: ["pointDraw"],
      },
    };
    const { getByText } = renderWithMaterials([mat]);
    const disclosure = getByText("MMD material").closest("details");
    expect(disclosure).toBeTruthy();
    expect(disclosure?.querySelector(".yl-kv--regular")).toBeTruthy();
    expect(disclosure?.querySelector(".mat-slot-table")).toBeNull();
    expect(getByText("Material01")).toBeTruthy();
    expect(getByText("tex/body.png")).toBeTruthy();
    expect(getByText("doubleSided")).toBeTruthy();
    expect(getByText("pointDraw")).toBeTruthy();
  });

  it("renders empty state when no materials", () => {
    const { container, getByText } = renderWithMaterials([]);
    expect(getByText("No materials found.")).toBeTruthy();
    expect(container.querySelector(".material-split-panel")).toBeTruthy();
    expect(getByText("Select a material to inspect it.")).toBeTruthy();
  });

  it("filters material names case-insensitively while retaining selected details", () => {
    const otherMaterial: MaterialEntry = {
      ...baseMat,
      id: "mat-2",
      name: "Other",
      type: "Mesh Physical",
    };
    const { container, getByRole, getByText, queryByText } =
      renderWithMaterials([baseMat, otherMaterial]);

    fireEvent.click(getByRole("button", { name: /Other/ }));
    fireEvent.click(getByRole("button", { name: "Search materials" }));
    fireEvent.change(getByRole("textbox", { name: "Filter materials" }), {
      target: { value: "gold" },
    });

    expect(container.querySelectorAll(".material-row")).toHaveLength(1);
    expect(queryByText("Other")).toBeNull();
    expect(getByText("Mesh Physical")).toBeTruthy();

    fireEvent.click(getByRole("button", { name: "Clear material filter" }));
    expect(container.querySelectorAll(".material-row")).toHaveLength(2);
  });

  it("resets its filter when the current file changes", async () => {
    const { getByRole } = renderWithMaterials([baseMat]);
    fireEvent.click(getByRole("button", { name: "Search materials" }));
    const filter = getByRole("textbox", { name: "Filter materials" });
    fireEvent.change(filter, { target: { value: "gold" } });
    expect((filter as HTMLInputElement).value).toBe("gold");

    act(() => {
      useFileStore.setState({
        currentFile: {
          path: "C:/assets/other.glb",
          fileName: "other.glb",
          extension: "glb",
          kind: "model",
          parentDirectory: "C:/assets",
        },
      });
    });

    fireEvent.click(getByRole("button", { name: "Search materials" }));
    await waitFor(() => {
      expect(
        (getByRole("textbox", { name: "Filter materials" }) as HTMLInputElement)
          .value,
      ).toBe("");
    });
  });

  it("accepts Japanese IME input and keeps duplicate names visible", () => {
    const duplicate: MaterialEntry = {
      ...baseMat,
      id: "mat-2",
      name: "Gold",
    };
    const japanese: MaterialEntry = {
      ...baseMat,
      id: "mat-ja",
      name: "材質01",
    };
    const { container, getByRole } = renderWithMaterials([
      baseMat,
      duplicate,
      japanese,
    ]);
    fireEvent.click(getByRole("button", { name: "Search materials" }));
    const filter = getByRole("textbox", { name: "Filter materials" });

    fireEvent.change(filter, { target: { value: "gold" } });
    expect(container.querySelectorAll(".material-row")).toHaveLength(2);
    fireEvent.compositionStart(filter);
    fireEvent.change(filter, { target: { value: "材質" } });
    fireEvent.compositionEnd(filter);
    expect(container.querySelectorAll(".material-row")).toHaveLength(1);
    expect(container.textContent).toContain("材質01");
  });

  it("clears the filter and reveals repeated viewport material requests", async () => {
    const materials = Array.from({ length: 20 }, (_, index) => ({
      ...baseMat,
      id: `mat-${index}`,
      name: `Material ${index}`,
      usdPrimPath: `/Looks/Material${index}`,
    }));
    const { getByRole, getByText, container } = renderWithMaterials(materials);
    fireEvent.click(getByRole("button", { name: "Search materials" }));
    fireEvent.change(getByRole("textbox", { name: "Filter materials" }), {
      target: { value: "Material 0" },
    });

    act(() => {
      useViewerStore.getState().requestMaterialNavigation("mat-19");
    });

    await waitFor(() => expect(getByText("Material 19")).toBeTruthy());
    fireEvent.click(getByRole("button", { name: "Search materials" }));
    expect(
      (getByRole("textbox", { name: "Filter materials" }) as HTMLInputElement)
        .value,
    ).toBe("");
    expect(getByText("/Looks/Material19")).toBeTruthy();

    const firstList = container.querySelector(".material-list");
    act(() => {
      useViewerStore.getState().requestMaterialNavigation("mat-19");
    });
    await waitFor(() =>
      expect(container.querySelector(".material-list")).not.toBe(firstList),
    );
  });
});
