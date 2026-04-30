/**
 * Tests for MaterialListCard shader-slot detail panel (#36).
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MaterialListCard } from "../MaterialListCard";
import type { MaterialEntry } from "../assetMetadata";

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
};

describe("MaterialListCard – shader slot details (#36)", () => {
  it("renders material names", () => {
    const { getByText } = render(<MaterialListCard materials={[baseMat]} />);
    expect(getByText("Gold")).toBeTruthy();
  });

  it("renders shader inputs summary when shader detail is present", () => {
    const { getByText } = render(<MaterialListCard materials={[baseMat]} />);
    expect(getByText("shader inputs")).toBeTruthy();
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
    const { queryByText } = render(<MaterialListCard materials={[mat]} />);
    expect(queryByText("shader inputs")).toBeNull();
  });

  it("renders texture name in shader detail", () => {
    const mat: MaterialEntry = {
      ...baseMat,
      id: "mat-tex",
      baseColorTexture: { name: "albedo_4k.png" },
    };
    const { getByText } = render(<MaterialListCard materials={[mat]} />);
    expect(getByText("albedo_4k.png")).toBeTruthy();
  });

  it("renders USD prim path when present", () => {
    const mat: MaterialEntry = {
      ...baseMat,
      id: "mat-usd",
      usdPrimPath: "/World/Materials/Gold",
    };
    const { getByText } = render(<MaterialListCard materials={[mat]} />);
    expect(getByText("/World/Materials/Gold")).toBeTruthy();
  });

  it("renders empty state when no materials", () => {
    const { getByText } = render(<MaterialListCard materials={[]} />);
    expect(getByText("No materials found.")).toBeTruthy();
  });
});
