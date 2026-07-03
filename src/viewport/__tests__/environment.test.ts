import { BoxGeometry, Mesh, MeshBasicMaterial, Scene, Texture } from "three";
import { describe, expect, it, vi } from "vitest";
import { disposeEnvironmentScene } from "../environment";

describe("disposeEnvironmentScene", () => {
  it("uses shared object disposal for environment scene resources", () => {
    const scene = new Scene();
    const geometry = new BoxGeometry();
    const texture = new Texture();
    const material = new MeshBasicMaterial({ map: texture });
    const mesh = new Mesh(geometry, material);
    scene.add(mesh);

    const disposeGeometry = vi.spyOn(geometry, "dispose");
    const disposeTexture = vi.spyOn(texture, "dispose");
    const disposeMaterial = vi.spyOn(material, "dispose");

    disposeEnvironmentScene(scene);

    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    expect(disposeTexture).toHaveBeenCalledTimes(1);
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
  });
});
