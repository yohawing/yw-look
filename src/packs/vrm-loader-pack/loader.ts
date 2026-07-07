import { errorMessage } from "../../lib/errors";
import { readBinaryFile, type SelectedFile } from "../../lib/files";
import type { LoadedPreview, LoaderContext } from "../../types/viewer";

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

async function readArrayBuffer(path: string) {
  return readBinaryFile(path);
}

export async function loadVrmPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  reportStage("scan");
  throwIfAborted(context.signal);

  try {
    const [{ GLTFLoader }, { VRMLoaderPlugin, VRMUtils }] = await Promise.all([
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("@pixiv/three-vrm"),
    ]);
    throwIfAborted(context.signal);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    reportStage("decode");
    const buffer = await readArrayBuffer(file.path);
    throwIfAborted(context.signal);
    reportStage("gpu");
    const gltf = await loader.parseAsync(buffer, "");
    throwIfAborted(context.signal);
    const vrm = gltf.userData.vrm as import("@pixiv/three-vrm").VRM | undefined;

    if (!vrm) {
      throw new Error(
        "The file loaded as glTF, but no VRM extension data was found.",
      );
    }

    reportStage("scene");
    VRMUtils.rotateVRM0(vrm);

    const modelName = "name" in vrm.meta ? vrm.meta.name : vrm.meta.title;
    vrm.scene.name = modelName || file.fileName;
    vrm.scene.userData.vrm = vrm;

    return {
      object: vrm.scene,
      cleanupUrls: [],
      clips: gltf.animations,
      formatVersion: `VRM ${vrm.meta.metaVersion ?? "unknown"}`,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    const message = errorMessage(error, "Unknown error");
    throw new Error(`Unable to load VRM preview: ${message}`, { cause: error });
  }
}
