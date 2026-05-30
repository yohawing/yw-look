import { Group } from "three";
import type { SelectedFile } from "../../lib/files";
import { readBinaryFile } from "../../lib/files";
import type { LoaderContext } from "../loaderRegistry";
import type { LoadedPreview } from "../types";

async function importSpark() {
  return import("@sparkjsdev/spark");
}

function getSplatFileTypeForExtension(extension: string) {
  // SplatFileType enum values match extension strings directly
  switch (extension.toLowerCase()) {
    case "ply":
      return "ply";
    case "spz":
      return "spz";
    case "splat":
      return "splat";
    case "ksplat":
      return "ksplat";
    default:
      return undefined;
  }
}

export async function loadSparkPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  reportStage("scan");

  try {
    const { SplatMesh, SparkRenderer } = await importSpark();

    reportStage("decode");
    const bytes = await readBinaryFile(file.path);
    const fileBytes = new Uint8Array(bytes).buffer;

    const fileType = getSplatFileTypeForExtension(file.extension);

    // SplatMesh accepts fileBytes (ArrayBuffer) and optional fileType/fileName
    // initialized is a Promise<SplatMesh> that resolves when async loading completes
    const splatMesh = new SplatMesh({
      fileBytes,
      ...(fileType !== undefined
        ? { fileType: fileType as import("@sparkjsdev/spark").SplatFileType }
        : {}),
      fileName: file.fileName,
    });

    // Wait for async initialization (data parsing, GPU upload prep)
    await splatMesh.initialized;

    reportStage("scene");

    const group = new Group();
    group.name = `${file.fileName} Gaussian Splat Preview`;

    const cleanupCallbacks: Array<() => void> = [
      () => {
        splatMesh.dispose();
      },
    ];

    // Spark renders splats through a SparkRenderer placed in the scene graph;
    // its onBeforeRender hook drives the per-frame sort/draw pass. Without it
    // the SplatMesh loads but never draws. It needs the live WebGLRenderer.
    if (context.renderer) {
      const sparkRenderer = new SparkRenderer({ renderer: context.renderer });
      group.add(sparkRenderer);
      cleanupCallbacks.push(() => {
        sparkRenderer.dispose();
      });
    }

    group.add(splatMesh);

    return {
      object: group,
      cleanupUrls: [],
      cleanupCallbacks,
      clips: [],
      formatVersion: null,
      assetKind: "gaussianSplat",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load Gaussian Splat preview: ${message}`, {
      cause: error,
    });
  }
}
