import {
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  type Material,
} from "three";

import { errorMessage } from "../../lib/errors";
import { type SelectedFile, readBinaryFile } from "../../lib/files";
import { isTauriEnvironment } from "../../lib/platform";
import {
  extractGeometry,
  deferredSummaryHasNoRenderableGeometry,
  inspectStage,
  inspectionHasDeferredPayloads,
  requiresGlbPreview,
  type StageInspection,
  type StageLoadPolicy,
  type VariantSelection,
} from "../../lib/usd";
import type { LoaderContext } from "../loaderRegistry";
import { isAbortOrTimeoutError } from "../modelParseWorker";
import { isUsdWorkerEnabled, parseUsdInWorker } from "../usdWorkerLoader";
import type { LoadedPreview } from "../types";

const WORKER_FALLBACK_SIZE_LIMIT = 50 * 1024 * 1024;

async function readArrayBuffer(path: string) {
  return readBinaryFile(path);
}

async function yieldToPaint(): Promise<void> {
  if (typeof requestAnimationFrame === "function") {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        setTimeout(() => resolve(), 0);
      }),
    );
    return;
  }
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
}

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

export function isDeferredUsdEmptyStageError(error: unknown): boolean {
  const message = errorMessage(error, "");
  return message.includes("no renderable Mesh prims found in stage");
}

export {
  deferredSummaryHasNoRenderableGeometry,
  inspectionHasDeferredPayloads,
};

type UsdRuntimeHints = {
  metersPerUnit: number | null;
};

function inspectStageForVariants(
  path: string,
  policy: StageLoadPolicy | undefined,
  variantSelections?: VariantSelection[],
) {
  if (variantSelections && variantSelections.length > 0) {
    return inspectStage(path, policy, undefined, variantSelections);
  }
  return inspectStage(path, policy);
}

function isLikelyUsdLoaderFallbackMaterial(material: Material): boolean {
  const materialRecord = material as Material & {
    color?: Color;
    map?: unknown;
    emissiveMap?: unknown;
    normalMap?: unknown;
    roughnessMap?: unknown;
    metalnessMap?: unknown;
  };
  const fallbackColor = materialRecord.color?.getHex();
  return (
    materialRecord.color instanceof Color &&
    (fallbackColor === 0x000000 || fallbackColor === 0xffffff) &&
    !materialRecord.name &&
    materialRecord.map == null &&
    materialRecord.emissiveMap == null &&
    materialRecord.normalMap == null &&
    materialRecord.roughnessMap == null &&
    materialRecord.metalnessMap == null
  );
}

function createUsdPreviewFallbackMaterial(source: Material): MeshBasicMaterial {
  const fallback = new MeshBasicMaterial({
    color: 0xcfd4dc,
    opacity: source.opacity,
    transparent: source.transparent,
    side: DoubleSide,
  });
  fallback.name = source.name;
  return fallback;
}

function applyUsdPreviewFallbackMaterials(object: Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    const replaced = materials.map((material) =>
      isLikelyUsdLoaderFallbackMaterial(material)
        ? createUsdPreviewFallbackMaterial(material)
        : material,
    );

    child.material = Array.isArray(child.material) ? replaced : replaced[0];
  });
}

function applyUsdRuntimeHints(object: Object3D, hints: UsdRuntimeHints) {
  if (!hints.metersPerUnit || Math.abs(hints.metersPerUnit - 1) < 1e-6) {
    return;
  }

  const correctionScale = 1 / hints.metersPerUnit;
  object.scale.multiplyScalar(correctionScale);
}

function toArrayBuffer(data: Uint8Array) {
  return data.slice().buffer;
}

export function isUsdcCrateBuffer(buffer: ArrayBuffer) {
  const crateHeader = [0x50, 0x58, 0x52, 0x2d, 0x55, 0x53, 0x44, 0x43];
  const view = new Uint8Array(buffer);

  if (view.byteLength < crateHeader.length) {
    return false;
  }

  return crateHeader.every((value, index) => view[index] === value);
}

export function shouldFailClosedOnUsdPreviewDecisionFailure(
  extension: string,
  isTauriRuntime: boolean,
) {
  return (
    isTauriRuntime &&
    (extension === "usd" ||
      extension === "usda" ||
      extension === "usdc" ||
      extension === "usdz")
  );
}

export async function tryExtractUsdaText(
  extension: string,
  buffer: ArrayBuffer,
): Promise<string | null> {
  if (extension === "usda") {
    return new TextDecoder().decode(buffer);
  }

  if (extension === "usd") {
    if (isUsdcCrateBuffer(buffer)) {
      return null;
    }
    return new TextDecoder().decode(buffer);
  }

  if (extension !== "usdz") {
    return null;
  }

  const firstFileName = readUsdzFirstFileName(buffer);
  if (!firstFileName) {
    return null;
  }

  const { unzip, strFromU8 } =
    await import("three/examples/jsm/libs/fflate.module.js");
  const zip = (await new Promise<Record<string, Uint8Array>>(
    (resolve, reject) => {
      unzip(new Uint8Array(buffer), (error, files) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(files as Record<string, Uint8Array>);
      });
    },
  )) as Record<string, Uint8Array>;

  const firstFile = zip[firstFileName];
  if (!firstFile) {
    return null;
  }

  if (firstFileName.endsWith("usda")) {
    return strFromU8(firstFile);
  }

  if (firstFileName.endsWith("usdc")) {
    return null;
  }

  if (firstFileName.endsWith("usd")) {
    const firstBuffer = toArrayBuffer(firstFile);
    if (isUsdcCrateBuffer(firstBuffer)) {
      return null;
    }
    return strFromU8(firstFile);
  }

  return null;
}

export function readUsdzFirstFileName(buffer: ArrayBuffer) {
  const header = new DataView(buffer);
  const localFileHeaderSignature = 0x04034b50;

  if (
    header.byteLength < 30 ||
    header.getUint32(0, true) !== localFileHeaderSignature
  ) {
    return null;
  }

  const fileNameLength = header.getUint16(26, true);
  const extraFieldLength = header.getUint16(28, true);
  const fileNameStart = 30;
  const fileNameEnd = fileNameStart + fileNameLength;

  if (
    fileNameLength === 0 ||
    fileNameEnd + extraFieldLength > header.byteLength
  ) {
    return null;
  }

  const bytes = new Uint8Array(buffer, fileNameStart, fileNameLength);
  return new TextDecoder().decode(bytes);
}

async function parseUsdRuntimeHints(
  path: string,
  policy?: StageLoadPolicy,
  existingInspection?: StageInspection | null,
  variantSelections?: VariantSelection[],
): Promise<UsdRuntimeHints> {
  const started = performance.now();
  const TIMEOUT_MS = 10_000;
  const inspection =
    existingInspection ??
    (await Promise.race([
      inspectStageForVariants(path, policy, variantSelections),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `inspectStage timeout after ${TIMEOUT_MS}ms for ${path}`,
              ),
            ),
          TIMEOUT_MS,
        ),
      ),
    ]));
  const elapsed = Math.round(performance.now() - started);
  if (import.meta.env.DEV) {
    console.info(
      `[usd] inspectStage OK in ${elapsed}ms: metersPerUnit=${inspection.metersPerUnit}`,
    );
  }
  return {
    metersPerUnit: inspection.metersPerUnit,
  };
}

function matchingUsdInspection(
  path: string,
  policy: StageLoadPolicy,
  getUsdInspection: (() => StageInspection | null) | undefined,
  variantSelections?: VariantSelection[],
): StageInspection | null {
  if (variantSelections && variantSelections.length > 0) {
    return null;
  }
  const inspection = getUsdInspection?.() ?? null;
  if (!inspection || inspection.loadPolicy !== policy) {
    return null;
  }
  const normalize = (value: string) => value.replace(/\\/g, "/").toLowerCase();
  return normalize(inspection.path) === normalize(path) ? inspection : null;
}

export async function loadUsdPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  const usdPolicy = context.usdLoadPolicy ?? "loadAll";
  const hasVariantSelections = (context.variantSelections?.length ?? 0) > 0;
  let useGlbPipeline = hasVariantSelections;
  try {
    reportStage("resolve");
    throwIfAborted(context.signal);
    useGlbPipeline =
      (await requiresGlbPreview(file.path)) || hasVariantSelections;
    throwIfAborted(context.signal);
  } catch (error) {
    if (
      shouldFailClosedOnUsdPreviewDecisionFailure(
        file.extension,
        isTauriEnvironment(),
      )
    ) {
      throw new Error(
        `Unable to determine whether ${file.fileName} requires the USD composition backend. ` +
          `JS fallback is disabled for .${file.extension} files because references, payloads, or sublayers could be omitted from the preview.`,
        { cause: error },
      );
    }

    console.warn(
      "[usd] requires_glb_preview failed, falling back to JS detection:",
      error,
    );
  }

  if (useGlbPipeline || context.glbOverride != null) {
    await yieldToPaint();
    throwIfAborted(context.signal);

    const started = performance.now();
    let glbBuffer: ArrayBuffer;
    if (context.glbOverride != null) {
      glbBuffer = context.glbOverride;
      if (import.meta.env.DEV) {
        console.info(
          `[usd] using session glb override (${glbBuffer.byteLength} bytes): ${file.fileName}`,
        );
      }
    } else {
      reportStage("decode");
      await yieldToPaint();
      const extractOptions =
        context.variantSelections && context.variantSelections.length > 0
          ? {
              policy: usdPolicy,
              variantSelections: context.variantSelections,
            }
          : usdPolicy;
      try {
        throwIfAborted(context.signal);
        glbBuffer = await extractGeometry(file.path, extractOptions);
        throwIfAborted(context.signal);
      } catch (error) {
        if (usdPolicy === "noPayloads" && isDeferredUsdEmptyStageError(error)) {
          const inspection =
            matchingUsdInspection(
              file.path,
              "noPayloads",
              context.getUsdInspection,
              context.variantSelections,
            ) ??
            (await inspectStageForVariants(
              file.path,
              "noPayloads",
              context.variantSelections,
            ));
          if (!inspectionHasDeferredPayloads(inspection)) {
            throw error;
          }
          context.onWarning?.(
            "USD payloads are deferred. Load payload prims from the hierarchy to display geometry.",
          );
          return {
            object: new Group(),
            cleanupUrls: [],
            clips: [],
            formatVersion: null,
          };
        }
        throw error;
      }
    }
    if (import.meta.env.DEV) {
      console.info(
        `[usd] extract_geometry OK in ${Math.round(
          performance.now() - started,
        )}ms (${glbBuffer.byteLength} bytes, policy=${usdPolicy}): ${file.fileName}`,
      );
    }

    const { GLTFLoader } =
      await import("three/examples/jsm/loaders/GLTFLoader.js");
    reportStage("gpu");
    const gltf = await new GLTFLoader().parseAsync(glbBuffer, "");
    throwIfAborted(context.signal);
    if (import.meta.env.DEV) {
      console.info(`[usd] GLTFLoader.parseAsync OK: ${file.fileName}`);
    }

    const object = gltf.scene;
    if (usdPolicy === "noPayloads" && object.children.length === 0) {
      context.onWarning?.(
        "USD payloads are deferred. Load payload prims from the hierarchy to display geometry.",
      );
    }

    reportStage("scene");

    return {
      object,
      cleanupUrls: [],
      clips: gltf.animations,
      formatVersion: null,
    };
  }

  const { USDLoader } = await import("three/examples/jsm/loaders/USDLoader.js");
  reportStage("decode");
  const buffer = await readArrayBuffer(file.path);
  throwIfAborted(context.signal);
  const loader = new USDLoader();
  const usdaText = await tryExtractUsdaText(file.extension, buffer);

  if (usdaText === null) {
    throw new Error(
      `USDC binary content detected in ${file.fileName} and the GLB pipeline is unavailable. ` +
        `Stage metadata and inspection are still available in the sidebar.`,
    );
  }

  await yieldToPaint();

  let workerObject: Object3D | null = null;
  if (isUsdWorkerEnabled()) {
    try {
      reportStage("gpu");
      workerObject = await parseUsdInWorker(
        file.path,
        usdaText
          ? { kind: "text", text: usdaText }
          : { kind: "binary", buffer },
        { signal: context.signal, timeoutMs: context.parseTimeoutMs },
      );
    } catch (error) {
      if (isAbortOrTimeoutError(error)) {
        throw error;
      }
      if (buffer.byteLength >= WORKER_FALLBACK_SIZE_LIMIT) {
        const fileSizeMb = (buffer.byteLength / (1024 * 1024)).toFixed(1);
        throw new Error(
          `Worker parsing failed for large file (${fileSizeMb} MB). ` +
            "Main thread fallback is disabled for files over 50 MB to prevent UI freeze.",
          { cause: error },
        );
      }
      console.warn(
        "[usd] worker parse failed, falling back to main thread:",
        error,
      );
      workerObject = null;
    }
  }

  let object: Group;
  try {
    reportStage("scene");
    throwIfAborted(context.signal);
    object =
      (workerObject as Group | null) ??
      (usdaText ? loader.parse(usdaText) : loader.parse(buffer));
    applyUsdPreviewFallbackMaterials(object);
    if (import.meta.env.DEV) {
      console.info(`[usd] USDLoader.parse OK: ${file.fileName}`);
    }
  } catch (parseError) {
    console.error("[usd] USDLoader.parse failed:", parseError);
    throw parseError;
  }

  try {
    const runtimeHints = await parseUsdRuntimeHints(
      file.path,
      context.usdLoadPolicy,
      matchingUsdInspection(
        file.path,
        context.usdLoadPolicy ?? "loadAll",
        context.getUsdInspection,
        context.variantSelections,
      ),
      context.variantSelections,
    );
    applyUsdRuntimeHints(object, runtimeHints);
  } catch (error) {
    console.warn("[usd] runtime hints failed:", error);
  }

  return {
    object,
    cleanupUrls: [],
    clips: [],
    formatVersion: null,
  };
}
