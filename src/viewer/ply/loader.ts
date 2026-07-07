import { Mesh, MeshStandardMaterial } from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { readBinaryFile, type SelectedFile } from "../../lib/files";
import { loadSparkPreviewObject } from "../../packs";
import type { LoaderContext } from "../loaderRegistry";
import { isAbortOrTimeoutError, parseModelInWorker } from "../modelParseWorker";
import type { LoadedPreview } from "../types";
import { detectPlyKind, parsePlyHeader } from "./classify";
import { buildPointCloudPreview } from "./pointCloud";

const HAS_SPARK_LOADER =
  typeof __YW_HAS_SPARK_LOADER__ === "boolean" ? __YW_HAS_SPARK_LOADER__ : true;

const PLY_GAUSSIAN_SPLAT_MISSING_SPARK_MESSAGE =
  "This PLY contains Gaussian Splat data. Install the Gaussian Splat Loader Pack (@sparkjsdev/spark) to preview it.";

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("Model load was canceled.");
    error.name = "AbortError";
    throw error;
  }
}

export async function loadPlyPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  reportStage("decode");
  const buffer = await readBinaryFile(file.path);
  throwIfAborted(context.signal);

  const plyKind = detectPlyKind(parsePlyHeader(buffer));

  if (plyKind === "pointCloud") {
    throwIfAborted(context.signal);
    reportStage("scene");
    return buildPointCloudPreview(buffer).preview;
  }

  if (plyKind === "gaussianSplat") {
    if (!HAS_SPARK_LOADER) {
      throw new Error(PLY_GAUSSIAN_SPLAT_MISSING_SPARK_MESSAGE);
    }
    return loadSparkPreviewObject(file, context, buffer);
  }

  reportStage("scene");
  let object: Mesh;
  try {
    object = (await parseModelInWorker(
      file.path,
      { kind: "ply", buffer },
      { signal: context.signal, timeoutMs: context.parseTimeoutMs },
    )) as Mesh;
  } catch (error) {
    if (isAbortOrTimeoutError(error)) {
      throw error;
    }
    console.warn(
      "[ply] worker parse failed, falling back to main thread:",
      error,
    );
    throwIfAborted(context.signal);
    const geometry = new PLYLoader().parse(buffer);
    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals();
    }
    object = new Mesh(
      geometry,
      new MeshStandardMaterial({
        color: "#c7d2e3",
        metalness: 0.08,
        roughness: 0.72,
      }),
    );
  }
  return {
    object,
    cleanupUrls: [],
    clips: [],
    formatVersion: null,
    assetKind: "mesh",
  };
}
