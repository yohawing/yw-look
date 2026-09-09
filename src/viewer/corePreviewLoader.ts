import type { SelectedFile } from "../lib/files";
import type { LoaderContext } from "./loaderRegistry";
import type { LoadedPreview } from "./types";

export const coreLoaderExtensions = [
  "glb",
  "gltf",
  "fbx",
  "obj",
  "ply",
  "stl",
  "dae",
  "usd",
  "usda",
  "usdc",
  "usdz",
  "abc",
  "bvh",
  "png",
  "jpg",
  "jpeg",
  "tga",
  "dds",
  "psd",
  "hdr",
  "exr",
  "ktx2",
] as const;

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

export async function loadCorePreviewObject(
  file: SelectedFile,
  context: LoaderContext = {},
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  throwIfAborted(context.signal);
  reportStage("scan");

  switch (file.extension) {
    case "3mf": {
      const { loadThreeMfPreviewObject } = await import("./threeMf/loader");
      return loadThreeMfPreviewObject(file, context);
    }
    case "glb":
    case "gltf": {
      const { loadGltfPreviewObject } = await import("./gltf/loader");
      return loadGltfPreviewObject(file, {
        onStage: context.onStage,
        onDeferredTexture: context.onDeferredTexture,
        signal: context.signal,
        parseTimeoutMs: context.parseTimeoutMs,
      });
    }
    case "fbx": {
      const { loadFbxPreviewObject } = await import("./fbx/loader");
      return loadFbxPreviewObject(file, {
        onStage: context.onStage,
        onDeferredTexture: context.onDeferredTexture,
        onWarning: context.onWarning,
        signal: context.signal,
        parseTimeoutMs: context.parseTimeoutMs,
      });
    }
    case "obj": {
      const { loadObjPreviewObject } = await import("./obj/loader");
      return loadObjPreviewObject(file, {
        onStage: context.onStage,
        signal: context.signal,
        parseTimeoutMs: context.parseTimeoutMs,
      });
    }
    case "ply": {
      const { loadPlyPreviewObject } = await import("./ply/loader");
      return loadPlyPreviewObject(file, {
        renderer: context.renderer,
        onStage: context.onStage,
        onWarning: context.onWarning,
        signal: context.signal,
        parseTimeoutMs: context.parseTimeoutMs,
      });
    }
    case "stl": {
      const { loadStlPreviewObject } = await import("./stl/loader");
      return loadStlPreviewObject(file, {
        onStage: context.onStage,
        signal: context.signal,
        parseTimeoutMs: context.parseTimeoutMs,
      });
    }
    case "dae": {
      const { loadDaePreviewObject } = await import("./dae/loader");
      return loadDaePreviewObject(file, {
        onStage: context.onStage,
        signal: context.signal,
        parseTimeoutMs: context.parseTimeoutMs,
      });
    }
    case "abc": {
      const { loadAbcPreviewObject } = await import("./abc/loader");
      return loadAbcPreviewObject(file, {
        onStage: context.onStage,
        signal: context.signal,
      });
    }
    case "bvh": {
      const { loadBvhPreviewObject } = await import("./bvh/loader");
      return loadBvhPreviewObject(file, {
        onStage: context.onStage,
        signal: context.signal,
      });
    }
    case "usd":
    case "usda":
    case "usdc":
    case "usdz": {
      const { loadUsdPreviewObject } = await import("./usd/loader");
      return loadUsdPreviewObject(file, {
        usdLoadPolicy: context.usdLoadPolicy,
        getUsdInspection: context.getUsdInspection,
        variantSelections: context.variantSelections,
        glbOverride: context.glbOverride,
        onStage: context.onStage,
        onWarning: context.onWarning,
        signal: context.signal,
        parseTimeoutMs: context.parseTimeoutMs,
      });
    }
    case "png":
    case "jpg":
    case "jpeg":
    case "tga":
    case "dds":
    case "psd":
    case "hdr":
    case "exr":
    case "ktx2": {
      const { loadTexturePreviewObject } = await import("./texture/loader");
      return loadTexturePreviewObject(file, {
        renderer: context.renderer,
        onStage: context.onStage,
        signal: context.signal,
      });
    }
    default:
      throw new Error(
        `Preview loader is not implemented for .${file.extension}`,
      );
  }
}
