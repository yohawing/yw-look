import "./locales";
import { LocalizedError } from "../../lib/localizedMessage";
import { Group, type Object3D, type Texture } from "three";
import { Rhino3dmLoader } from "three/examples/jsm/loaders/3DMLoader.js";
import { errorMessage } from "../../lib/errors";
import { readBinaryFile, type SelectedFile } from "../../lib/files";
import {
  convertRhino3dmPreview,
  isRhino3dmNativePreviewEnabled,
  normalizeRhino3dmStaticSceneError,
  parseModelInWorker,
  RHINO3DM_STATIC_SCENE_BUDGET,
} from "../../lib/rhino3dm";
import type { LoadedPreview, LoaderContext } from "../../types/viewer";
import { createAbortError, throwIfAborted } from "../abort";
import RHINO3DM_LIBRARY_PATH from "virtual:yw-look-rhino3dm-library-path";

const DEFAULT_PARSE_TIMEOUT_MS = 30_000;

type RhinoWarning = {
  message?: unknown;
};

type DisposableResource = {
  dispose: () => void;
};

type RhinoLoaderInternals = Rhino3dmLoader & {
  libraryPending?: Promise<unknown> | null;
  workerPool?: unknown[];
  workerSourceURL?: string;
};

function createTimeoutError(path: string, timeoutMs: number): Error {
  const error = new Error(
    `Rhino 3DM parse timed out after ${Math.round(timeoutMs / 1000)}s: ${path}`,
  );
  error.name = "TimeoutError";
  return error;
}

function getRhinoWarnings(object: Object3D): string[] {
  const warnings = object.userData?.warnings;
  if (!Array.isArray(warnings)) return [];

  return warnings.flatMap((warning: RhinoWarning | string) => {
    if (typeof warning === "string") return [warning];
    return typeof warning?.message === "string" ? [warning.message] : [];
  });
}

function errorEventMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }
  return errorMessage(error, "Unknown Rhino 3DM loader error");
}

function isDisposableResource(value: unknown): value is DisposableResource {
  return (
    typeof value === "object" &&
    value !== null &&
    "dispose" in value &&
    typeof value.dispose === "function"
  );
}

function isTexture(value: unknown): value is Texture & DisposableResource {
  return (
    isDisposableResource(value) &&
    "isTexture" in value &&
    value.isTexture === true
  );
}

function collectRhinoResourceCleanup(
  root: Object3D,
  options: { includeMeshResources?: boolean } = {},
): () => void {
  const geometries = new Set<DisposableResource>();
  const materials = new Set<DisposableResource>();
  const textures = new Set<Texture & DisposableResource>();
  const meshGeometries = new Set<DisposableResource>();
  const meshMaterials = new Set<DisposableResource>();
  const meshTextures = new Set<Texture & DisposableResource>();

  const collectMaterial = (material: unknown, isMesh: boolean) => {
    if (!isDisposableResource(material)) return;
    materials.add(material);
    if (isMesh) meshMaterials.add(material);
    for (const value of Object.values(material)) {
      if (isTexture(value)) {
        textures.add(value);
        if (isMesh) meshTextures.add(value);
      }
    }
  };

  root.traverse((child) => {
    const isMesh = (child as Object3D & { isMesh?: unknown }).isMesh === true;
    const childWithResources = child as Object3D & {
      geometry?: unknown;
      material?: unknown | unknown[];
    };
    if (isDisposableResource(childWithResources.geometry)) {
      geometries.add(childWithResources.geometry);
      if (isMesh) meshGeometries.add(childWithResources.geometry);
    }
    if (Array.isArray(childWithResources.material)) {
      for (const material of childWithResources.material) {
        collectMaterial(material, isMesh);
      }
    } else {
      collectMaterial(childWithResources.material, isMesh);
    }
  });

  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    for (const geometry of geometries) {
      if (!options.includeMeshResources && meshGeometries.has(geometry)) {
        continue;
      }
      geometry.dispose();
    }
    for (const material of materials) {
      if (!options.includeMeshResources && meshMaterials.has(material)) {
        continue;
      }
      material.dispose();
    }
    for (const texture of textures) {
      if (!options.includeMeshResources && meshTextures.has(texture)) {
        continue;
      }
      texture.dispose();
    }
  };
}

function disposeRhinoLoader(loader: Rhino3dmLoader): void {
  const internals = loader as RhinoLoaderInternals;
  const libraryPending = internals.libraryPending;
  const revokeWorkerSourceUrl = () => {
    if (!internals.workerSourceURL) return;
    URL.revokeObjectURL(internals.workerSourceURL);
    internals.workerSourceURL = "";
  };
  loader.dispose();

  if (!libraryPending || typeof libraryPending.then !== "function") {
    revokeWorkerSourceUrl();
    return;
  }

  // Rhino3dmLoader can create its first worker from libraryPending after the
  // caller has timed out and disposed the current pool. Observe the pending
  // promise without delaying the caller, and dispose any worker created later.
  void libraryPending.then(
    () => {
      loader.dispose();
      revokeWorkerSourceUrl();
    },
    () => {
      // The loader's own parse promise observes this rejection. Keep this
      // observer terminal as well so a rejected library load is never left as
      // an unhandled promise from our lifecycle guard.
      revokeWorkerSourceUrl();
    },
  );
}

async function loadNativeRhino3dmPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  reportStage("scan");
  throwIfAborted(context.signal);
  reportStage("decode");
  const nativeResult = await convertRhino3dmPreview(file.path, {
    signal: context.signal,
    timeoutMs: context.parseTimeoutMs,
  });
  throwIfAborted(context.signal);
  reportStage("scene");

  // The native route hands ownership of this one GLB buffer to the existing
  // worker. There is deliberately no main-thread or WASM fallback after an
  // IPC, conversion, or worker failure.
  let root: Object3D;
  try {
    root = await parseModelInWorker(
      file.path,
      { kind: "glb", buffer: nativeResult.bytes },
      {
        signal: context.signal,
        timeoutMs: context.parseTimeoutMs,
        staticSceneBudget: RHINO3DM_STATIC_SCENE_BUDGET,
        transferBuffer: true,
      },
    );
  } catch (error) {
    throw normalizeRhino3dmStaticSceneError(error);
  }
  const cleanupResources = collectRhinoResourceCleanup(root);
  const cleanupFailedLoad = collectRhinoResourceCleanup(root, {
    includeMeshResources: true,
  });
  try {
    throwIfAborted(context.signal);

    const object = new Group();
    object.name = root.name || file.fileName;
    object.add(root);
    return {
      object,
      cleanupUrls: [],
      cleanupCallbacks: [cleanupResources],
      clips: [],
      formatVersion: null,
      warnings: nativeResult.warnings,
      stats: nativeResult.stats ?? undefined,
      assetKind: "mesh",
    };
  } catch (error) {
    cleanupFailedLoad();
    throw error;
  }
}

function parseWithRhinoLoader(
  loader: Rhino3dmLoader,
  buffer: ArrayBuffer,
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
    path: string;
  },
): Promise<Object3D> {
  if (options.signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise<Object3D>((resolve, reject) => {
    let settled = false;
    const timeoutId = globalThis.setTimeout(() => {
      settleReject(createTimeoutError(options.path, options.timeoutMs));
    }, options.timeoutMs);

    const cleanup = () => {
      if (timeoutId !== undefined) {
        globalThis.clearTimeout(timeoutId);
      }
      options.signal?.removeEventListener("abort", handleAbort);
    };
    const settleResolve = (object: Object3D) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(object);
    };
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const handleAbort = () => {
      settleReject(createAbortError());
    };

    options.signal?.addEventListener("abort", handleAbort, { once: true });
    if (options.signal?.aborted) {
      handleAbort();
      return;
    }

    try {
      loader.parse(
        buffer,
        (object) => settleResolve(object),
        (error) => settleReject(new Error(errorEventMessage(error))),
      );
    } catch (error) {
      settleReject(new Error(errorEventMessage(error), { cause: error }));
    }
  });
}

export async function loadRhino3dmPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  if (isRhino3dmNativePreviewEnabled()) {
    return loadNativeRhino3dmPreviewObject(file, context);
  }

  const reportStage = context.onStage ?? (() => undefined);
  const loader = new Rhino3dmLoader();
  loader.setLibraryPath(RHINO3DM_LIBRARY_PATH).setWorkerLimit(1);
  let parsedRoot: Object3D | null = null;
  let cleanupResources: (() => void) | null = null;

  try {
    reportStage("scan");
    throwIfAborted(context.signal);
    reportStage("decode");
    const buffer = await readBinaryFile(file.path);
    throwIfAborted(context.signal);
    reportStage("scene");

    const root = await parseWithRhinoLoader(loader, buffer, {
      signal: context.signal,
      timeoutMs: context.parseTimeoutMs ?? DEFAULT_PARSE_TIMEOUT_MS,
      path: file.path,
    });
    parsedRoot = root;
    throwIfAborted(context.signal);

    const warnings = getRhinoWarnings(root);
    cleanupResources = collectRhinoResourceCleanup(root);

    const object = new Group();
    object.name = root.name || file.fileName;
    object.add(root);

    return {
      object,
      cleanupUrls: [],
      cleanupCallbacks: [cleanupResources],
      clips: [],
      formatVersion: null,
      warnings,
      assetKind: "mesh",
    };
  } catch (error) {
    cleanupResources?.();
    if (parsedRoot && !cleanupResources) {
      collectRhinoResourceCleanup(parsedRoot, {
        includeMeshResources: true,
      })();
    }
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw error;
    }
    const message = errorMessage(error, "Unknown error");
    throw new LocalizedError(
      "rhino3dm-loader-pack:load_failed",
      `Unable to load Rhino 3DM preview: ${message}`,
      { detail: message },
      {
        cause: error,
      },
    );
  } finally {
    disposeRhinoLoader(loader);
  }
}
