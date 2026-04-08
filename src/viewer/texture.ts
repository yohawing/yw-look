import { Mesh, PlaneGeometry, ShaderMaterial, Texture } from "three";
import type { TextureViewMode } from "./types";

export function createTextureViewerObject(
  texture: Texture,
  textureViewMode: TextureViewMode,
  textureExposure: number,
  textureBlackPoint: number,
  textureWhitePoint: number,
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

  return new Mesh(
    new PlaneGeometry(width, height),
    new ShaderMaterial({
      transparent: false,
      uniforms: {
        uTexture: { value: texture },
        uMode: {
          value:
            textureViewMode === "rgb" ? 0 : textureViewMode === "rgba" ? 1 : 2,
        },
        uExposure: { value: textureExposure },
        uBlackPoint: { value: textureBlackPoint },
        uWhitePoint: { value: textureWhitePoint },
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

        void main() {
          vec4 texel = texture2D(uTexture, vUv);
          vec3 color = remapRange(texel.rgb);
          float alphaValue = remapScalar(texel.a);

          if (uMode == 0) {
            gl_FragColor = vec4(color, 1.0);
            return;
          }

          if (uMode == 1) {
            vec3 composite = mix(checker(vUv), color, alphaValue);
            gl_FragColor = vec4(composite, 1.0);
            return;
          }

          gl_FragColor = vec4(vec3(alphaValue), 1.0);
        }
      `,
    }),
  );
}
