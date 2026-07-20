import { Mesh, MeshStandardMaterial } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { readBinaryFile, type SelectedFile } from "../../lib/files";
import type { LoaderContext } from "../loaderRegistry";
import { isAbortOrTimeoutError, parseModelInWorker } from "../modelParseWorker";
import type { LoadedPreview } from "../types";

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("Model load was canceled.");
    error.name = "AbortError";
    throw error;
  }
}

export async function loadStlPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  reportStage("decode");
  const buffer = await readBinaryFile(file.path);
  throwIfAborted(context.signal);
  reportStage("scene");
  let object: Mesh;
  try {
    object = (await parseModelInWorker(
      file.path,
      { kind: "stl", buffer },
      { signal: context.signal, timeoutMs: context.parseTimeoutMs },
    )) as Mesh;
  } catch (error) {
    if (isAbortOrTimeoutError(error)) {
      throw error;
    }
    console.warn(
      "[stl] worker parse failed, falling back to main thread:",
      error,
    );
    throwIfAborted(context.signal);
    const geometry = new STLLoader().parse(buffer);
    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals();
    }
    object = new Mesh(
      geometry,
      new MeshStandardMaterial({
        color: "#d7dde8",
        metalness: 0.1,
        roughness: 0.68,
      }),
    );
  }
  return {
    object,
    cleanupUrls: [],
    clips: [],
    formatVersion: null,
  };
}
