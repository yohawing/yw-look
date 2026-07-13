import { describe, expect, it, vi } from "vitest";
import { Mesh, MeshBasicMaterial } from "three";
import {
  applySelectionMaterialCustomizer,
  setSelectionMaterialCustomizer,
} from "../selectionProxy";

describe("selection material customizer", () => {
  it("stores a mesh-local callback and applies it to an ID material", () => {
    const mesh = new Mesh();
    const material = new MeshBasicMaterial();
    const customizer = vi.fn();

    setSelectionMaterialCustomizer(mesh, customizer);
    applySelectionMaterialCustomizer(mesh, material);

    expect(customizer).toHaveBeenCalledWith(material);
  });
});
