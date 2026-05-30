import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from "three";
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

    // SplatMesh is a THREE.Object3D with no mesh geometry, so the viewer's
    // `Box3.setFromObject` camera fit/normalization sees no extent and parks
    // the camera at the origin while the splat sits off at its native
    // (off-center) capture coordinates — making it look tilted/cropped.
    // Recenter the cloud at the local origin and add an invisible proxy box
    // carrying the real extent so the camera fit can frame it.
    const splatBounds = splatMesh.getBoundingBox(true);
    const splatCenter = splatBounds.getCenter(new Vector3());
    const splatSize = splatBounds.getSize(new Vector3());
    splatMesh.frustumCulled = false;
    splatMesh.position.copy(splatCenter).multiplyScalar(-1);

    // `oriented` carries the coordinate-system correction for the splat so the
    // recenter + rotation pivot around the cloud center. antimatter15 `.splat`
    // / INRIA `.ply` carry no up-axis metadata; the cakewalk samples read as
    // Z-up, so map Z-up → THREE's Y-up with a −90° rotation about X. (This is
    // a sensible default, not a universal truth — splat captures have gauge
    // freedom, so a manual orientation control is the real fix.)
    const oriented = new Group();
    oriented.rotation.x = -Math.PI / 2;
    oriented.add(splatMesh);

    const proxyGeometry = new BoxGeometry(
      Math.max(splatSize.x, 1e-3),
      Math.max(splatSize.y, 1e-3),
      Math.max(splatSize.z, 1e-3),
    );
    const proxyMaterial = new MeshBasicMaterial();
    const proxy = new Mesh(proxyGeometry, proxyMaterial);
    proxy.visible = false;
    oriented.add(proxy);

    const group = new Group();
    group.name = `${file.fileName} Gaussian Splat Preview`;

    const cleanupCallbacks: Array<() => void> = [
      () => {
        splatMesh.dispose();
      },
      () => {
        proxyGeometry.dispose();
        proxyMaterial.dispose();
      },
    ];

    // Spark renders splats through a SparkRenderer placed in the scene graph;
    // its onBeforeRender hook drives the per-frame sort/draw pass. Without it
    // the SplatMesh loads but never draws. It needs the live WebGLRenderer.
    // It is a screen-space helper, so its own extent is tiny relative to the
    // proxy box and does not meaningfully skew the camera fit.
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
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load Gaussian Splat preview: ${message}`, {
      cause: error,
    });
  }
}
