import {
  DataTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  TextureLoader,
  UnsignedByteType,
  type CompressedTexture,
} from "three";
import {
  decodePsdFile,
  readBinaryFile,
  type SelectedFile,
} from "../../lib/files";
import type { LoaderContext } from "../loaderRegistry";
import type { LoadedPreview } from "../types";

function createAbortError(message = "Model load was canceled."): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function throwIfAbortedWithObjectUrl(
  signal: AbortSignal | undefined,
  objectUrl: string,
): void {
  if (signal?.aborted) {
    URL.revokeObjectURL(objectUrl);
    throw createAbortError();
  }
}

async function readArrayBuffer(path: string) {
  return readBinaryFile(path);
}

function getMimeType(extension: string) {
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "tga":
      return "image/x-tga";
    case "dds":
      return "image/vnd-ms.dds";
    case "hdr":
      return "image/vnd.radiance";
    case "exr":
      return "image/x-exr";
    case "ktx2":
      return "image/ktx2";
    case "bmp":
      return "image/bmp";
    case "bin":
      return "application/octet-stream";
    default:
      return "application/octet-stream";
  }
}

async function prepareObjectUrl(
  path: string,
  extension: string,
  signal: AbortSignal | undefined,
) {
  throwIfAborted(signal);
  const buffer = await readArrayBuffer(path);
  throwIfAborted(signal);
  const blob = new Blob([buffer], { type: getMimeType(extension) });
  const objectUrl = URL.createObjectURL(blob);
  throwIfAbortedWithObjectUrl(signal, objectUrl);
  return objectUrl;
}

function createTexturePreview(
  texture:
    | DataTexture
    | CompressedTexture
    | Awaited<ReturnType<TextureLoader["loadAsync"]>>,
) {
  const image = "image" in texture ? texture.image : null;
  const widthValue = image && typeof image.width === "number" ? image.width : 1;
  const heightValue =
    image && typeof image.height === "number" ? image.height : 1;
  const ratio = widthValue / heightValue || 1;
  const width = ratio >= 1 ? 2.2 : 2.2 * ratio;
  const height = ratio >= 1 ? 2.2 / ratio : 2.2;

  return new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({ map: texture, transparent: true }),
  );
}

function loadedTexturePreview(
  texture:
    | DataTexture
    | CompressedTexture
    | Awaited<ReturnType<TextureLoader["loadAsync"]>>,
  objectUrl?: string,
): LoadedPreview {
  return {
    object: createTexturePreview(texture),
    cleanupUrls: objectUrl ? [objectUrl] : [],
    clips: [],
    formatVersion: null,
  };
}

export async function loadTexturePreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  throwIfAborted(context.signal);

  switch (file.extension) {
    case "psd": {
      reportStage("decode");
      const decoded = await decodePsdFile(file.path);
      throwIfAborted(context.signal);
      const texture = new DataTexture(
        decoded.data,
        decoded.width,
        decoded.height,
        RGBAFormat,
        UnsignedByteType,
      );
      texture.magFilter = LinearFilter;
      texture.minFilter = LinearFilter;
      texture.generateMipmaps = false;
      texture.flipY = false;
      texture.colorSpace = SRGBColorSpace;
      texture.name = file.fileName;
      texture.userData.textureSourceKind = "standalone";
      texture.needsUpdate = true;
      reportStage("gpu");
      return loadedTexturePreview(texture);
    }
    case "png":
    case "jpg":
    case "jpeg": {
      reportStage("decode");
      const objectUrl = await prepareObjectUrl(
        file.path,
        file.extension,
        context.signal,
      );
      reportStage("gpu");
      throwIfAbortedWithObjectUrl(context.signal, objectUrl);
      const texture = await new TextureLoader().loadAsync(objectUrl);
      texture.colorSpace = SRGBColorSpace;
      texture.name = file.fileName;
      texture.userData.textureSourceKind = "standalone";
      return loadedTexturePreview(texture, objectUrl);
    }
    case "tga": {
      reportStage("decode");
      const { TGALoader } =
        await import("three/examples/jsm/loaders/TGALoader.js");
      const objectUrl = await prepareObjectUrl(
        file.path,
        file.extension,
        context.signal,
      );
      reportStage("gpu");
      throwIfAbortedWithObjectUrl(context.signal, objectUrl);
      const texture = await new TGALoader().loadAsync(objectUrl);
      texture.colorSpace = SRGBColorSpace;
      texture.name = file.fileName;
      texture.userData.textureSourceKind = "standalone";
      return loadedTexturePreview(texture, objectUrl);
    }
    case "dds": {
      reportStage("decode");
      const { DDSLoader } =
        await import("three/examples/jsm/loaders/DDSLoader.js");
      const objectUrl = await prepareObjectUrl(
        file.path,
        file.extension,
        context.signal,
      );
      reportStage("gpu");
      throwIfAbortedWithObjectUrl(context.signal, objectUrl);
      const texture = await new DDSLoader().loadAsync(objectUrl);
      texture.colorSpace = SRGBColorSpace;
      texture.name = file.fileName;
      texture.userData.textureSourceKind = "standalone";
      return loadedTexturePreview(texture, objectUrl);
    }
    case "hdr": {
      reportStage("decode");
      const { RGBELoader } =
        await import("three/examples/jsm/loaders/RGBELoader.js");
      const objectUrl = await prepareObjectUrl(
        file.path,
        file.extension,
        context.signal,
      );
      reportStage("gpu");
      throwIfAbortedWithObjectUrl(context.signal, objectUrl);
      const texture = await new RGBELoader().loadAsync(objectUrl);
      texture.name = file.fileName;
      texture.userData.textureSourceKind = "standalone";
      return loadedTexturePreview(texture, objectUrl);
    }
    case "exr": {
      reportStage("decode");
      const { EXRLoader } =
        await import("three/examples/jsm/loaders/EXRLoader.js");
      const objectUrl = await prepareObjectUrl(
        file.path,
        file.extension,
        context.signal,
      );
      reportStage("gpu");
      throwIfAbortedWithObjectUrl(context.signal, objectUrl);
      const texture = await new EXRLoader().loadAsync(objectUrl);
      texture.name = file.fileName;
      texture.userData.textureSourceKind = "standalone";
      return loadedTexturePreview(texture, objectUrl);
    }
    case "ktx2": {
      reportStage("decode");
      const { KTX2Loader } =
        await import("three/examples/jsm/loaders/KTX2Loader.js");
      const objectUrl = await prepareObjectUrl(
        file.path,
        file.extension,
        context.signal,
      );
      const loader = new KTX2Loader();
      loader.setTranscoderPath("/basis/");
      if (context.renderer) {
        loader.detectSupport(context.renderer);
      } else {
        (
          loader as unknown as { workerConfig: Record<string, boolean> }
        ).workerConfig = {
          astcSupported: false,
          astcHDRSupported: false,
          etc1Supported: false,
          etc2Supported: false,
          dxtSupported: true,
          bptcSupported: true,
          pvrtcSupported: false,
        };
      }
      let texture;
      try {
        throwIfAborted(context.signal);
        reportStage("gpu");
        texture = await loader.loadAsync(objectUrl);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        throw error;
      } finally {
        loader.dispose();
      }
      texture.name = file.fileName;
      texture.userData.textureSourceKind = "standalone";
      return loadedTexturePreview(texture, objectUrl);
    }
    default:
      throw new Error(
        `Preview loader is not implemented for .${file.extension}`,
      );
  }
}
