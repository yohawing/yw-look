import { Mesh, MeshBasicMaterial, PlaneGeometry, Texture } from "three";

/**
 * Builds a flat plane mesh for previewing a single texture in the viewport.
 *
 * Uses Three.js' built-in `MeshBasicMaterial` so the renderer's standard
 * texture sampling + color management pipeline (sRGB decode on sample,
 * linear -> output encoding via the `<colorspace_fragment>` chunk) is
 * applied correctly. A custom `ShaderMaterial` was tried earlier and showed
 * the texture too dark on Tauri's WebView2 because the chunks that built-in
 * materials get for free were not auto-injected.
 *
 * `toneMapped = false` keeps raw texture values out of `ACESFilmicToneMapping`
 * (which the asset viewport uses for the 3D model preview).
 *
 * Texture-view extras like RGBA-checker compositing, alpha extraction,
 * exposure/black/white remap are tracked separately in ToDo §7 (channel
 * display, EV slider). Reintroduce them via material.onBeforeCompile when
 * the UI to drive them lands.
 */
export function createTextureViewerObject(texture: Texture) {
  const image = texture.image as
    | { width?: number; height?: number }
    | undefined;
  const widthValue = image && typeof image.width === "number" ? image.width : 1;
  const heightValue =
    image && typeof image.height === "number" ? image.height : 1;
  const ratio = widthValue / heightValue || 1;
  const width = ratio >= 1 ? 2.6 : 2.6 * ratio;
  const height = ratio >= 1 ? 2.6 / ratio : 2.6;

  return new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({
      map: texture,
      transparent: false,
      toneMapped: false,
    }),
  );
}
