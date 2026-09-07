import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  Scene,
  Texture,
  WebGLRenderTarget,
  type PMREMGenerator,
} from "three";
import { describe, expect, it, vi } from "vitest";
import {
  createEnvironmentTarget,
  disposeEnvironmentScene,
} from "../environment";
import type { EnvironmentPreset } from "../../types/viewer";

describe("environment targets", () => {
  it("keeps a bounded cache across repeated presets and None without disposing active textures", () => {
    const fromScene = vi.fn(() => new WebGLRenderTarget(16, 16));
    const generator = { fromScene } as unknown as PMREMGenerator;
    const cache = new Map<EnvironmentPreset, WebGLRenderTarget>();
    const targets = ["studio", "neutral", "outdoor"].map((preset) =>
      createEnvironmentTarget(generator, preset as EnvironmentPreset, cache)!,
    );
    const disposals = targets.map((target) => vi.spyOn(target, "dispose"));
    for (let i = 0; i < 20; i++) {
      expect(createEnvironmentTarget(generator, "none", cache)).toBeNull();
      expect(createEnvironmentTarget(generator, "studio", cache)).toBe(
        targets[0],
      );
      expect(createEnvironmentTarget(generator, "neutral", cache)).toBe(
        targets[1],
      );
      expect(createEnvironmentTarget(generator, "outdoor", cache)).toBe(
        targets[2],
      );
    }
    expect(fromScene).toHaveBeenCalledTimes(3);
    expect(cache.size).toBe(3);
    disposals.forEach((dispose) => expect(dispose).not.toHaveBeenCalled());
    targets.forEach((target) => target.dispose());
  });

  it("allocates nothing for None and disposes source geometry and materials if PMREM fails", () => {
    const disposals: ReturnType<typeof vi.fn>[] = [];
    const fromScene = vi.fn((scene: Scene) => {
      scene.traverse((object) => {
        if (object instanceof Mesh) {
          for (const resource of [object.geometry, object.material]) {
            const disposed = vi.fn();
            resource.addEventListener("dispose", disposed);
            disposals.push(disposed);
          }
        }
      });
      throw new Error("PMREM failed");
    });
    const generator = { fromScene } as unknown as PMREMGenerator;
    const cache = new Map<EnvironmentPreset, WebGLRenderTarget>();
    expect(createEnvironmentTarget(generator, "none", cache)).toBeNull();
    expect(fromScene).not.toHaveBeenCalled();
    expect(() => createEnvironmentTarget(generator, "studio", cache)).toThrow(
      "PMREM failed",
    );
    expect(cache.size).toBe(0);
    expect(disposals.length).toBeGreaterThan(0);
    disposals.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1));
  });
});

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
