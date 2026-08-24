import type { WebGLRenderer } from "three";
import { errorMessage } from "../lib/errors";

import type {
  CanvasScreenshotOptions,
  CanvasScreenshot,
} from "../types/viewer";

export type {
  CanvasScreenshotOptions,
  CanvasScreenshot,
  AssetViewportApi,
} from "../types/viewer";

function canvasToDataUrl(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
) {
  try {
    return canvas.toDataURL(mimeType, quality);
  } catch (error) {
    throw new Error(
      `failed to capture WebGL canvas screenshot: ${errorMessage(error, "Unknown error")}`,
      { cause: error },
    );
  }
}

export async function captureWebGLCanvasScreenshot(
  canvas: HTMLCanvasElement,
  options: CanvasScreenshotOptions = {},
): Promise<CanvasScreenshot> {
  const mimeType = options.mimeType ?? "image/png";
  options.beforeCapture?.();

  return {
    dataUrl: canvasToDataUrl(canvas, mimeType, options.quality),
    mimeType,
    width: canvas.width,
    height: canvas.height,
  };
}

export async function captureRendererScreenshot(
  renderer: WebGLRenderer,
  options: CanvasScreenshotOptions = {},
) {
  return captureWebGLCanvasScreenshot(renderer.domElement, options);
}

export function isRendererCanvasNonBlank(renderer: WebGLRenderer) {
  const gl = renderer.getContext();
  const canvas = renderer.domElement;
  const width = canvas.width;
  const height = canvas.height;

  if (width <= 0 || height <= 0) {
    return false;
  }

  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha === 0) {
      continue;
    }

    if (
      pixels[index] !== 0 ||
      pixels[index + 1] !== 0 ||
      pixels[index + 2] !== 0
    ) {
      return true;
    }
  }

  return false;
}
