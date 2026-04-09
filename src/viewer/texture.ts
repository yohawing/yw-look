import {
  FloatType,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Texture,
} from "three";

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
 * Per-format material configuration:
 *
 * - LDR (PNG/JPG/TGA/DDS/KTX2 byte textures):
 *   `toneMapped = false` keeps raw values out of `ACESFilmicToneMapping`
 *   so the preview matches reference viewers (XnView/Photoshop).
 *   `transparent = true` honours alpha channels — transparent PNG/TGA
 *   cutouts show through to the gray background instead of rendering
 *   garbage RGB on opaque pixels.
 *
 * - HDR (`.hdr` / `.exr`, float-typed textures):
 *   `toneMapped = true` lets the renderer's ACES filmic curve compress
 *   the >1.0 range — without it everything above pure white clips to
 *   solid white. `transparent = false` because float HDR textures do
 *   not carry meaningful alpha and we want a flat opaque plane.
 *
 * Channel display, exposure slider, and explicit alpha-on-checker
 * compositing are tracked separately in ToDo §7 ("チャンネル別表示")
 * and will be reintroduced via `material.onBeforeCompile` once the UI
 * lands.
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

  const isFloat =
    texture.type === FloatType || texture.type === HalfFloatType;

  return new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({
      map: texture,
      transparent: !isFloat,
      toneMapped: isFloat,
    }),
  );
}
