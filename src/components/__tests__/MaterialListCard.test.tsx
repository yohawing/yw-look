/**
 * Tests for MaterialListCard shader-slot detail panel (#36).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MaterialListCard } from "../MaterialListCard";
import type { AssetMetadata, MaterialEntry } from "../assetMetadata";
import { useFileStore } from "../../stores/fileStore";

beforeEach(() => {
  useFileStore.setState({
    currentFile: null,
    directoryListing: null,
    assetInspection: null,
    assetMetadata: null,
    packFileRequest: null,
    openError: null,
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

function makeMetadata(materials: MaterialEntry[]): AssetMetadata {
  return {
    formatLabel: "Test",
    formatVersion: null,
    nodeCount: 0,
    meshCount: 0,
    materialCount: materials.length,
    textureCount: 0,
    hasAnimation: false,
    hierarchy: [],
    textures: [],
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

describe("MaterialListCard – shader slot details (#36)", () => {
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

  it("renders shader inputs summary when shader detail is present", () => {
    const { getByText } = renderWithMaterials([baseMat]);
    expect(getByText("shader inputs")).toBeTruthy();
  });

  it("renders base color hex values in the shared lowercase format", () => {
    const { getAllByText, queryByText } = renderWithMaterials([baseMat]);

    expect(getAllByText("#b5a642").length).toBeGreaterThan(0);
    expect(queryByText("#B5A642")).toBeNull();
  });

  it("does not render shader inputs when all slots are null", () => {
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
    expect(queryByText("shader inputs")).toBeNull();
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
});
