import {
  FloatType,
  HalfFloatType,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Texture,
} from "three";
import type { TextureViewMode } from "./types";

const textureViewModeToUniform: Record<TextureViewMode, number> = {
  rgb: 0,
  rgba: 1,
  alpha: 2,
  r: 3,
  g: 4,
  b: 5,
};

export function createTextureViewerObject(
  texture: Texture,
  textureViewMode: TextureViewMode,
  textureExposure: number,
  textureBlackPoint: number,
  textureWhitePoint: number,
  textureTileCount: number,
  textureGamma: number,
) {
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
    new ShaderMaterial({
      transparent: false,
      uniforms: {
        uTexture: { value: texture },
        uMode: {
          value: textureViewModeToUniform[textureViewMode],
        },
        uExposure: { value: textureExposure },
        uBlackPoint: { value: textureBlackPoint },
        uWhitePoint: { value: textureWhitePoint },
        uTileCount: { value: Math.max(textureTileCount, 1) },
        uGamma: { value: Math.max(textureGamma, 0.0001) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        uniform int uMode;
        uniform float uExposure;
        uniform float uBlackPoint;
        uniform float uWhitePoint;
        uniform float uTileCount;
        uniform float uGamma;
        varying vec2 vUv;

        vec3 checker(vec2 uv) {
          float scale = 18.0;
          float cell = mod(floor(uv.x * scale) + floor(uv.y * scale), 2.0);
          return mix(vec3(0.18), vec3(0.32), cell);
        }

        vec3 remapRange(vec3 color) {
          float safeRange = max(uWhitePoint - uBlackPoint, 0.0001);
          vec3 shifted = max(color * exp2(uExposure) - vec3(uBlackPoint), vec3(0.0));
          return clamp(shifted / safeRange, 0.0, 1.0);
        }

        float remapScalar(float value) {
          float safeRange = max(uWhitePoint - uBlackPoint, 0.0001);
          float shifted = max(value * exp2(uExposure) - uBlackPoint, 0.0);
          return clamp(shifted / safeRange, 0.0, 1.0);
        }

        vec3 applyGamma(vec3 color) {
          // uGamma == 1.0 ⇒ linear, 2.2 ⇒ sRGB-ish encoding.
          // Three.js output color space already applies an sRGB
          // conversion, so this uniform layers on top of that to
          // give the user a "raw linear vs gamma-corrected" toggle.
          return pow(color, vec3(1.0 / uGamma));
        }

        void main() {
          // Wrap in the shader so we can tile without mutating the
          // texture's wrap modes (which are shared between the texture
          // preview and any 3D material still pointing at it).
          vec2 tiledUv = fract(vUv * uTileCount);
          vec4 texel = texture2D(uTexture, tiledUv);
          vec3 color = remapRange(texel.rgb);
          float alphaValue = remapScalar(texel.a);

          if (uMode == 0) {
            gl_FragColor = vec4(applyGamma(color), 1.0);
            return;
          }

          if (uMode == 1) {
            vec3 composite = mix(checker(vUv), color, alphaValue);
            gl_FragColor = vec4(applyGamma(composite), 1.0);
            return;
          }

          if (uMode == 2) {
            gl_FragColor = vec4(vec3(alphaValue), 1.0);
            return;
          }

          // Single-channel isolations draw the channel as greyscale so
          // the viewer can spot detail without being distracted by the
          // other two channels' colouring.
          if (uMode == 3) {
            gl_FragColor = vec4(vec3(color.r), 1.0);
            return;
          }

          if (uMode == 4) {
            gl_FragColor = vec4(vec3(color.g), 1.0);
            return;
          }

          gl_FragColor = vec4(vec3(color.b), 1.0);
        }
      `,
    }),
  );
}
