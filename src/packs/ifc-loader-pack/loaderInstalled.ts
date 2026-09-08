import { createIfcInspection, ifcSelectionKey } from "./inspection";
import { registerIfcInspection } from "./metadata";
import { Vector2, type OrthographicCamera } from "three";
import { FragmentsModels, IfcImporter } from "@thatopen/fragments";
import { Group, PerspectiveCamera } from "three";
import { errorMessage } from "../../lib/errors";
import type { SelectedFile } from "../../lib/files";
import { readBinaryFile } from "../../lib/files";
import type { LoadedPreview, LoaderContext } from "../../types/viewer";
import { throwIfAborted } from "../abort";
import fragmentsWorkerUrl from "@thatopen/fragments/worker?url";
import webIfcWasmUrl from "web-ifc/web-ifc.wasm?url";
import { createIfcRuntime } from "./runtime";
import type { IfcRuntimeState } from "./types";

function wasmDirectoryUrl(fileUrl: string): string {
  const slash = fileUrl.lastIndexOf("/");
  return slash >= 0 ? fileUrl.slice(0, slash + 1) : fileUrl;
}

function modelIdForFile(file: SelectedFile): string {
  return `ifc-preview-${file.fileName.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

export async function loadIfcPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  let manager: FragmentsModels | null = null;

  try {
    throwIfAborted(context.signal);
    reportStage("scan");
    const fileBytes = await readBinaryFile(file.path);
    throwIfAborted(context.signal);

    reportStage("decode");
    const importer = new IfcImporter();
    importer.wasm = {
      path: wasmDirectoryUrl(webIfcWasmUrl),
      absolute: true,
    };
    const fragmentsBytes = await importer.process({
      bytes: new Uint8Array(fileBytes),
      raw: false,
    });
    throwIfAborted(context.signal);

    manager = new FragmentsModels(fragmentsWorkerUrl, { maxWorkers: 2 });
    const modelId = modelIdForFile(file);
    const abortLoad = () => {
      manager?.abort(modelId);
    };
    context.signal?.addEventListener("abort", abortLoad, { once: true });
    if (context.signal?.aborted) {
      abortLoad();
    }
    throwIfAborted(context.signal);
    const camera = new PerspectiveCamera(45, 1, 0.1, 10000);
    camera.position.set(10, 10, 10);
    camera.lookAt(0, 0, 0);
    try {
      const model = await manager.load(fragmentsBytes, {
        modelId,
        camera,
        raw: false,
      });
      // Fragments materializes the visible tile meshes on the first view
      // update. Complete that first update before handing the object to the
      // generic viewport mount so framing and metadata see actual geometry.
      await manager.update(true);
      throwIfAborted(context.signal);

      reportStage("scene");
      const object =
        model.object instanceof Group
          ? model.object
          : new Group().add(model.object);
      object.name ||= `${file.fileName} IFC Preview`;

      const inspection = await createIfcInspection(model);
      throwIfAborted(context.signal);
      registerIfcInspection(object, inspection);
      await inspection.setColorMode("category");
      await manager.update(true);
      throwIfAborted(context.signal);
      const runtimeState: IfcRuntimeState = { manager, model };
      return {
        object,
        cleanupUrls: [],
        clips: [],
        formatVersion: "IFC",
        createPackRuntime: () => {
          const runtime = createIfcRuntime(runtimeState);
          let disposed = false;
          const picks = new Set<Promise<string | null>>();
          return {
            ...runtime,
            update: (frame) => {
              if (!disposed) runtime.update?.(frame);
            },
            selection: {
              pick: async (event, camera, canvas) => {
                if (disposed) return null;
                const pick = model
                  .raycast({
                    camera: camera as PerspectiveCamera | OrthographicCamera,
                    mouse: new Vector2(event.clientX, event.clientY),
                    dom: canvas,
                  })
                  .then((hit) =>
                    !disposed && hit ? ifcSelectionKey(hit.localId) : null,
                  );
                picks.add(pick);
                try {
                  return await pick;
                } finally {
                  picks.delete(pick);
                }
              },
              select: inspection.select,
            },
            dispose: () => {
              if (disposed) return;
              disposed = true;
              void Promise.allSettled([inspection.dispose(), ...picks]).then(
                () => runtime.dispose(),
              );
            },
          };
        },
        skipScaleNormalization: false,
      };
    } finally {
      context.signal?.removeEventListener("abort", abortLoad);
    }
  } catch (error) {
    if (manager) {
      await manager.dispose().catch(() => undefined);
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    throw new Error(
      `Unable to load IFC preview: ${errorMessage(error, "Unknown error")}`,
      { cause: error },
    );
  }
}
