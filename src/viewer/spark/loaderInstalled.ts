import { Group, Vector3 } from "three";
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
    const fileBytes = await readBinaryFile(file.path);

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

    // Keep the splat at its native coordinates: the capture's own origin is the
    // only positional information the format carries (there is no ground-plane
    // / pivot metadata), and other viewers render at these native coordinates,
    // which is why the cloud sits a little above the origin there. We don't
    // recenter or rest it on the grid — that would discard the native origin
    // and visibly shift large scenes. SplatMesh has no mesh geometry, so the
    // viewer's bounds-based fit can't measure it; we skip auto framing and pass
    // the native bounds center as the fixed home-view target instead.
    const splatBounds = splatMesh.getBoundingBox(true);
    const splatCenter = splatBounds.getCenter(new Vector3());
    splatMesh.frustumCulled = false;

    // `oriented` carries the up-axis correction. 3DGS PLY/splat captures are
    // authored Y-down (INRIA/COLMAP convention) — without correction they load
    // upside-down — so rotate 180° about X to bring them upright in THREE's
    // Y-up world. Correctly authored exports (e.g. SuperSplat cactus) then sit
    // upright; mis-aligned captures (e.g. antimatter15 .splat) keep their
    // native residual tilt, which other viewers show too. A manual orientation
    // control is the real long-term fix for the latter.
    const oriented = new Group();
    oriented.rotation.x = Math.PI;
    oriented.add(splatMesh);
    oriented.updateMatrixWorld(true);
    const splatViewTarget = splatCenter
      .clone()
      .applyMatrix4(oriented.matrixWorld);

    const group = new Group();
    group.name = `${file.fileName} Gaussian Splat Preview`;
    // Opt out of the bounds-based auto scale/fit: SplatMesh reports no extent,
    // and captures with distant outlier splats would otherwise zoom the camera
    // way out. The viewer uses a fixed home view instead (see applyInitialView).
    group.userData.disableAutoFrame = true;
    group.userData.disableAutoFrameTarget = splatViewTarget;

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
      sparkRenderer.frustumCulled = false;
      group.add(sparkRenderer);
      cleanupCallbacks.push(() => {
        sparkRenderer.dispose();
      });
    }

    group.add(oriented);

    return {
      object: group,
      cleanupUrls: [],
      cleanupCallbacks,
      clips: [],
      formatVersion: null,
      assetKind: "gaussianSplat",
      skipScaleNormalization: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load Gaussian Splat preview: ${message}`, {
      cause: error,
    });
  }
}
