import {
  CompressedTexture,
  DataTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
} from "three";
import { type SelectedFile, readBinaryFile } from "../lib/files";
import { isTauriEnvironment } from "../lib/platform";
import { extractGeometry, inspectStage, requiresGlbPreview } from "../lib/usd";
import { LoaderRegistry, type LoaderContext } from "./loaderRegistry";
import { isUsdWorkerEnabled, parseUsdInWorker } from "./usdWorkerLoader";
import type {
  LoadedPreview,
  LoadingStageReporter,
  MissingReferenceError,
  TextureBundle,
} from "./types";

async function readArrayBuffer(path: string) {
  const bytes = await readBinaryFile(path);
  return Uint8Array.from(bytes).buffer;
}

/**
 * Yields control to the browser for one paint frame. Used before heavy
 * synchronous work (e.g. Three.js USDLoader.parse) so that React commits
 * staged earlier in the same tick get a chance to paint first.
 *
 * Falls back to a microtask/macrotask chain when running outside a DOM
 * context (tests, SSR) where `requestAnimationFrame` is unavailable.
 */
async function yieldToPaint(): Promise<void> {
  if (typeof requestAnimationFrame === "function") {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        // A second macrotask tick ensures the paint after RAF has landed
        // before we start burning the main thread again.
        setTimeout(() => resolve(), 0);
      }),
    );
    return;
  }
  await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
}

async function readTextFile(path: string) {
  const buffer = await readArrayBuffer(path);
  return new TextDecoder().decode(buffer);
}

function getMimeType(extension: string) {
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "tga":
      return "image/x-tga";
    case "dds":
      return "image/vnd-ms.dds";
    case "hdr":
      return "image/vnd.radiance";
    case "exr":
      return "image/x-exr";
    case "ktx2":
      return "image/ktx2";
    case "bin":
      return "application/octet-stream";
    default:
      return "application/octet-stream";
  }
}

function resolveSiblingPath(baseDirectory: string, relativePath: string) {
  const isWindowsPath = /^[a-zA-Z]:\\/.test(baseDirectory);
  const separator = isWindowsPath ? "\\" : "/";
  const normalizedBase = baseDirectory.replace(/[\\/]+/g, "/");
  const normalizedRelative = relativePath.replace(/[\\/]+/g, "/");
  const prefixMatch = normalizedBase.match(/^[a-zA-Z]:/);
  const prefix = prefixMatch
    ? `${prefixMatch[0]}${separator}`
    : normalizedBase.startsWith("/")
      ? separator
      : "";

  const baseSegments = normalizedBase
    .replace(/^[a-zA-Z]:/, "")
    .split("/")
    .filter(Boolean);
  const relativeSegments = normalizedRelative.split("/").filter(Boolean);
  const segments = [...baseSegments];

  for (const segment of relativeSegments) {
    if (segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (segments.length === 0) {
        throw new Error(
          `Path traversal beyond filesystem root: ${relativePath}`,
        );
      }
      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return `${prefix}${segments.join(separator)}`;
}

async function createBlobUrlFromPath(path: string, extension: string) {
  const buffer = await readArrayBuffer(path);
  const blob = new Blob([buffer], { type: getMimeType(extension) });
  return URL.createObjectURL(blob);
}

async function materializeGltf(file: SelectedFile) {
  const rawText = await readTextFile(file.path);
  const json = JSON.parse(rawText) as {
    asset?: { version?: string };
    buffers?: Array<{ uri?: string }>;
    images?: Array<{ uri?: string }>;
  };
  const cleanupUrls: string[] = [];
  const missingPaths: string[] = [];
  const unresolvedImages: string[] = [];

  const rewriteUri = async (uri: string) => {
    if (/^(data:|blob:|https?:)/i.test(uri)) {
      return uri;
    }

    const resourcePath = resolveSiblingPath(file.parentDirectory, uri);
    const extension = uri.includes(".")
      ? (uri.split(".").pop() ?? "bin")
      : "bin";
    let objectUrl: string;

    try {
      objectUrl = await createBlobUrlFromPath(
        resourcePath,
        extension.toLowerCase(),
      );
    } catch {
      missingPaths.push(uri);
      throw new Error(`Missing reference: ${uri}`);
    }

    cleanupUrls.push(objectUrl);
    return objectUrl;
  };

  if (json.buffers) {
    for (const buffer of json.buffers) {
      if (buffer.uri) {
        buffer.uri = await rewriteUri(buffer.uri);
      }
    }
  }

  if (json.images) {
    for (const image of json.images) {
      if (image.uri) {
        try {
          image.uri = await rewriteUri(image.uri);
        } catch {
          unresolvedImages.push(image.uri);
        }
      }
    }
  }

  if (missingPaths.length > 0) {
    for (const url of cleanupUrls) {
      URL.revokeObjectURL(url);
    }
    const error = new Error(
      `Missing reference: ${missingPaths.join(", ")}`,
    ) as MissingReferenceError;
    error.formatVersion = json.asset?.version ?? null;
    error.missingPaths = missingPaths;
    error.unresolvedImages = unresolvedImages;
    throw error;
  }

  const rootUrl = URL.createObjectURL(
    new Blob([JSON.stringify(json)], { type: "model/gltf+json" }),
  );
  cleanupUrls.push(rootUrl);

  return {
    rootUrl,
    cleanupUrls,
    formatVersion: json.asset?.version ?? null,
  };
}

function createTexturePreview(
  texture:
    | DataTexture
    | CompressedTexture
    | Awaited<ReturnType<TextureLoader["loadAsync"]>>,
) {
  const image = "image" in texture ? texture.image : null;
  const widthValue = image && typeof image.width === "number" ? image.width : 1;
  const heightValue =
    image && typeof image.height === "number" ? image.height : 1;
  const ratio = widthValue / heightValue || 1;
  const width = ratio >= 1 ? 2.2 : 2.2 * ratio;
  const height = ratio >= 1 ? 2.2 / ratio : 2.2;

  return new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({ map: texture, transparent: true }),
  );
}

async function tryLoadTextureFromPath(path: string) {
  try {
    const extension = path.split(".").pop()?.toLowerCase() ?? "bin";
    const objectUrl = await createBlobUrlFromPath(path, extension);
    const texture = await new TextureLoader().loadAsync(objectUrl);
    texture.colorSpace = SRGBColorSpace;
    texture.userData.textureSourceKind = "external";
    return { texture, objectUrl };
  } catch {
    return null;
  }
}

async function buildObjTextureBundle(
  file: SelectedFile,
): Promise<TextureBundle> {
  const baseName = file.fileName.replace(/\.[^.]+$/, "");
  const candidates = {
    albedo: [`${baseName}_A.jpg`, `${baseName}_A.png`],
    normal: [`${baseName}_N.jpg`, `${baseName}_N.png`],
    metalness: [`${baseName}_M.jpg`, `${baseName}_M.png`],
    roughness: [
      `${baseName}_R.jpg`,
      `${baseName}_R.png`,
      `${baseName}_RM.jpg`,
      `${baseName}_RM.png`,
    ],
  };

  const cleanupUrls: string[] = [];
  const result: TextureBundle = {
    albedo: null,
    normal: null,
    metalness: null,
    roughness: null,
    cleanupUrls,
  };

  for (const [key, fileNames] of Object.entries(candidates) as Array<
    [keyof Omit<TextureBundle, "cleanupUrls">, string[]]
  >) {
    for (const fileName of fileNames) {
      const resolvedPath = resolveSiblingPath(file.parentDirectory, fileName);
      const loaded = await tryLoadTextureFromPath(resolvedPath);

      if (loaded) {
        loaded.texture.name = fileName;
        result[key] = loaded.texture;
        cleanupUrls.push(loaded.objectUrl);
        break;
      }
    }
  }

  return result;
}

function applyObjTextureBundle(object: Group, bundle: TextureBundle) {
  if (
    !bundle.albedo &&
    !bundle.normal &&
    !bundle.metalness &&
    !bundle.roughness
  ) {
    return;
  }

  object.traverse((child: Object3D) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    child.material = new MeshStandardMaterial({
      color: "#ffffff",
      map: bundle.albedo,
      normalMap: bundle.normal,
      metalnessMap: bundle.metalness,
      roughnessMap: bundle.roughness,
      metalness: bundle.metalness ? 1 : 0.18,
      roughness: bundle.roughness ? 1 : 0.55,
    });
  });
}

type UsdRuntimeHints = {
  metersPerUnit: number | null;
};

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

function isUsdcCrateBuffer(buffer: ArrayBuffer) {
  const crateHeader = [0x50, 0x58, 0x52, 0x2d, 0x55, 0x53, 0x44, 0x43];
  const view = new Uint8Array(buffer);

  if (view.byteLength < crateHeader.length) {
    return false;
  }

  return crateHeader.every((value, index) => view[index] === value);
}

function shouldFailClosedOnUsdPreviewDecisionFailure(
  extension: string,
  isTauriRuntime: boolean,
) {
  return (
    isTauriRuntime &&
    (extension === "usd" || extension === "usda" || extension === "usdz")
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

function readUsdzFirstFileName(buffer: ArrayBuffer) {
  const header = new DataView(buffer);
  // ZIP local file header signature ("PK\x03\x04"), used by USDZ archives.
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

async function parseUsdRuntimeHints(path: string): Promise<UsdRuntimeHints> {
  // Delegated to the Rust `OpenusdBackend` via the Tauri command surface,
  // so this works for USDA, USDC, and USDZ uniformly. Returns just the
  // pieces the Three.js viewer cannot recover by itself — currently only
  // `metersPerUnit` (USDLoader handles the xform graph natively).
  //
  // Wrapped in a hard timeout so a hung / slow backend call can never
  // stall the preview pipeline — we fall back to "no hint" and the
  // viewer still renders with USDLoader's own scene.
  const started = performance.now();
  const TIMEOUT_MS = 10_000;
  const inspection = await Promise.race([
    inspectStage(path),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`inspectStage timeout after ${TIMEOUT_MS}ms for ${path}`),
          ),
        TIMEOUT_MS,
      ),
    ),
  ]);
  const elapsed = Math.round(performance.now() - started);
  console.info(
    `[usd] inspectStage OK in ${elapsed}ms: metersPerUnit=${inspection.metersPerUnit}`,
  );
  return {
    metersPerUnit: inspection.metersPerUnit,
  };
}

/**
 * @internal Exported for unit-testing only. Not part of the public API.
 */
export {
  getMimeType,
  resolveSiblingPath,
  isUsdcCrateBuffer,
  readUsdzFirstFileName,
  shouldFailClosedOnUsdPreviewDecisionFailure,
};

async function loadPreviewObjectCore(
  file: SelectedFile,
  renderer?: import("three").WebGLRenderer,
  options: {
    usdLoadPolicy?: import("../lib/usd").StageLoadPolicy;
    /** #31: variant selections to apply before GLB extraction. */
    variantSelections?: import("../lib/usd").VariantSelection[];
    /**
     * #44: when provided, skip the `extractGeometry` RPC and use this
     * pre-extracted GLB buffer directly. Allows the per-prim payload
     * session to push a freshly extracted buffer into the viewport after
     * a load/unload operation without re-opening the stage.
     */
    glbOverride?: ArrayBuffer | null;
    /** Reports coarse real loader stages for the viewport loading console. */
    onStage?: LoadingStageReporter;
  } = {},
): Promise<LoadedPreview> {
  const reportStage = options.onStage ?? (() => undefined);
  reportStage("scan");

  switch (file.extension) {
    case "glb": {
      reportStage("decode");
      const { GLTFLoader } =
        await import("three/examples/jsm/loaders/GLTFLoader.js");
      const buffer = await readArrayBuffer(file.path);
      reportStage("gpu");
      const gltf = await new GLTFLoader().parseAsync(buffer, "");
      return {
        object: gltf.scene,
        cleanupUrls: [],
        clips: gltf.animations,
        formatVersion: null,
      };
    }
    case "gltf": {
      reportStage("resolve");
      const { GLTFLoader } =
        await import("three/examples/jsm/loaders/GLTFLoader.js");
      const materialized = await materializeGltf(file);
      reportStage("gpu");
      const gltf = await new GLTFLoader().loadAsync(materialized.rootUrl);
      return {
        object: gltf.scene,
        cleanupUrls: materialized.cleanupUrls,
        clips: gltf.animations,
        formatVersion: materialized.formatVersion,
      };
    }
    case "fbx": {
      reportStage("decode");
      const { FBXLoader } = await import("../vendor/FBXLoaderPatched.js");
      const buffer = await readArrayBuffer(file.path);
      reportStage("scene");
      const object = new FBXLoader().parse(buffer, "");
      return {
        object,
        cleanupUrls: [],
        clips: object.animations,
        formatVersion: null,
      };
    }
    case "obj": {
      reportStage("decode");
      const { OBJLoader } =
        await import("three/examples/jsm/loaders/OBJLoader.js");
      const text = await readTextFile(file.path);
      reportStage("resolve");
      const object = new OBJLoader().parse(text);
      const bundle = await buildObjTextureBundle(file);
      reportStage("scene");
      applyObjTextureBundle(object, bundle);
      return {
        object,
        cleanupUrls: bundle.cleanupUrls,
        clips: [],
        formatVersion: null,
      };
    }
    case "ply": {
      reportStage("decode");
      const { PLYLoader } =
        await import("three/examples/jsm/loaders/PLYLoader.js");
      const buffer = await readArrayBuffer(file.path);
      reportStage("scene");
      const geometry = new PLYLoader().parse(buffer);
      geometry.computeVertexNormals();
      return {
        object: new Mesh(
          geometry,
          new MeshStandardMaterial({
            color: "#c7d2e3",
            metalness: 0.08,
            roughness: 0.72,
          }),
        ),
        cleanupUrls: [],
        clips: [],
        formatVersion: null,
      };
    }
    case "stl": {
      reportStage("decode");
      const { STLLoader } =
        await import("three/examples/jsm/loaders/STLLoader.js");
      const buffer = await readArrayBuffer(file.path);
      reportStage("scene");
      const geometry = new STLLoader().parse(buffer);
      geometry.computeVertexNormals();
      return {
        object: new Mesh(
          geometry,
          new MeshStandardMaterial({
            color: "#d7dde8",
            metalness: 0.1,
            roughness: 0.68,
          }),
        ),
        cleanupUrls: [],
        clips: [],
        formatVersion: null,
      };
    }
    case "dae": {
      reportStage("decode");
      const [{ ColladaLoader }, { LoadingManager }] = await Promise.all([
        import("three/examples/jsm/loaders/ColladaLoader.js"),
        import("three"),
      ]);
      const text = await readTextFile(file.path);
      const cleanupUrls: string[] = [];
      // Pre-resolve every <image>/<init_from> reference we can find in
      // the DAE document to blob URLs, then feed those through a
      // LoadingManager URL modifier so ColladaLoader.parse() (which is
      // synchronous and cannot await fs reads) picks them up.
      const imagePaths = new Set<string>();
      for (const match of text.matchAll(/<init_from>([^<]+)<\/init_from>/g)) {
        imagePaths.add(match[1].trim());
      }
      for (const match of text.matchAll(
        /<image[^>]*>\s*<source>([^<]+)<\/source>/g,
      )) {
        imagePaths.add(match[1].trim());
      }
      const blobCache = new Map<string, string>();
      const missingPaths: string[] = [];
      for (const imagePath of imagePaths) {
        if (/^(data:|blob:|https?:)/i.test(imagePath)) continue;
        const resolvedPath = resolveSiblingPath(
          file.parentDirectory,
          imagePath,
        );
        const extension = imagePath.includes(".")
          ? (imagePath.split(".").pop() ?? "bin").toLowerCase()
          : "bin";
        try {
          const blobUrl = await createBlobUrlFromPath(resolvedPath, extension);
          blobCache.set(imagePath, blobUrl);
          cleanupUrls.push(blobUrl);
        } catch {
          missingPaths.push(imagePath);
        }
      }
      if (missingPaths.length > 0) {
        for (const url of cleanupUrls) {
          URL.revokeObjectURL(url);
        }
        const error = new Error(
          `Missing reference: ${missingPaths.join(", ")}`,
        ) as MissingReferenceError;
        error.formatVersion = null;
        error.missingPaths = missingPaths;
        error.unresolvedImages = [];
        throw error;
      }
      reportStage("resolve");
      const manager = new LoadingManager();
      manager.setURLModifier((url) => {
        if (/^(data:|blob:|https?:)/i.test(url)) return url;
        return blobCache.get(url) ?? url;
      });
      const loader = new ColladaLoader(manager);
      reportStage("scene");
      const collada = loader.parse(text, file.parentDirectory);
      if (!collada) {
        throw new Error(
          "Collada parse returned no result; the document may be malformed.",
        );
      }
      // ColladaLoader returns a `Scene`; our preview pipeline expects
      // `Group | Mesh`. Wrap in a Group so the object is a normal
      // transform container, matching how the other loaders hand off.
      const wrapped = new Group();
      wrapped.add(collada.scene);
      return {
        object: wrapped,
        cleanupUrls,
        clips: [],
        formatVersion: null,
      };
    }
    case "usd":
    case "usda":
    case "usdc":
    case "usdz": {
      // Phase 3: route through the Rust GLB extraction pipeline whenever
      // the stage depends on anything `USDLoader.parse` can't handle —
      // i.e. a USDC root layer *or* any external composition (references,
      // payloads, sublayers). yw-look only hands `USDLoader.parse` a
      // single text buffer; it has no file-system hook, so any authored
      // reference silently disappears. Single self-contained USDA files
      // still go through the Three.js loader because it preserves the
      // authored xform hierarchy better than our GLB flattener.
      //
      // Branching is NOT by file extension: a `.usdz` archive can wrap
      // either USDA or USDC, and a `.usd` extension can be either format
      // too. `requiresGlbPreview` opens the stage on the Rust side and
      // reports the definitive answer.
      const usdPolicy = options.usdLoadPolicy ?? "loadAll";
      let useGlbPipeline = false;
      try {
        reportStage("resolve");
        useGlbPipeline = await requiresGlbPreview(file.path);
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

        // If the Rust check itself fails (e.g. a catastrophic parse
        // error) outside the Tauri app, fall through to the JS-side
        // magic-byte sniff so browser selftests and mocked environments
        // can still exercise the offline preview path.
        console.warn(
          "[usd] requires_glb_preview failed, falling back to JS detection:",
          error,
        );
      }

      if (useGlbPipeline || options.glbOverride != null) {
        // ---- USDC pipeline -------------------------------------------
        // Yield a frame so the Rust-populated inspector sidebar has a
        // chance to paint before we block on the (potentially heavy)
        // GLB extraction.
        await yieldToPaint();

        const started = performance.now();
        let glbBuffer: ArrayBuffer;
        if (options.glbOverride != null) {
          // #44: use the pre-extracted session buffer directly, skipping
          // the extractGeometry RPC.
          glbBuffer = options.glbOverride;
          console.info(
            `[usd] using session glb override (${glbBuffer.byteLength} bytes): ${file.fileName}`,
          );
        } else {
          reportStage("decode");
          // #31: pass variant selections through to the Tauri backend so
          // the C++ shim can apply them on the session layer before
          // geometry extraction. The options object is only constructed
          // when there are actual selections to avoid redundant IPC shape.
          const extractOptions =
            options.variantSelections && options.variantSelections.length > 0
              ? {
                  policy: usdPolicy,
                  variantSelections: options.variantSelections,
                }
              : usdPolicy;
          glbBuffer = await extractGeometry(file.path, extractOptions);
        }
        console.info(
          `[usd] extract_geometry OK in ${Math.round(
            performance.now() - started,
          )}ms (${glbBuffer.byteLength} bytes, policy=${usdPolicy}): ${file.fileName}`,
        );

        const { GLTFLoader } =
          await import("three/examples/jsm/loaders/GLTFLoader.js");
        reportStage("gpu");
        const gltf = await new GLTFLoader().parseAsync(glbBuffer, "");
        console.info(`[usd] GLTFLoader.parseAsync OK: ${file.fileName}`);

        // GLTFLoader returns a `GLTF` whose `scene` is a Group. Our
        // preview pipeline expects `Group | Mesh`, so we hand back the
        // scene root directly.
        const object = gltf.scene;

        // Apply metersPerUnit / upAxis hints from the inspector — these
        // come from the same Rust backend so the Phase 2 work continues
        // to apply uniformly.
        try {
          reportStage("scene");
          const runtimeHints = await parseUsdRuntimeHints(file.path);
          applyUsdRuntimeHints(object, runtimeHints);
        } catch (error) {
          console.warn("[usd] runtime hints failed:", error);
        }

        return {
          object,
          cleanupUrls: [],
          clips: gltf.animations,
          formatVersion: null,
        };
      }

      // ---- USDA pipeline (existing) ------------------------------------
      const { USDLoader } =
        await import("three/examples/jsm/loaders/USDLoader.js");
      reportStage("decode");
      const buffer = await readArrayBuffer(file.path);
      const loader = new USDLoader();
      const usdaText = await tryExtractUsdaText(file.extension, buffer);

      // Three.js USDLoader only handles USDA (ASCII) format. When
      // tryExtractUsdaText returns null it means the content is USDC
      // binary crate — either a raw `.usdc` / `.usd` file, or a `.usdz`
      // archive whose first layer is USDC. Normally we'd have already
      // taken the GLB pipeline branch above, but if `isRootLayerBinary`
      // failed (e.g. the backend refused to open the stage) we fall back
      // here. Passing a raw USDC buffer to `USDLoader.parse` silently
      // produces empty geometry, so we fail fast with a clear error
      // regardless of the file extension. Previously the USDZ branch
      // fell through to the synchronous loader, which reintroduced the
      // exact silent-empty-preview bug the Phase 3 pipeline is trying
      // to remove.
      if (usdaText === null) {
        throw new Error(
          `USDC binary content detected in ${file.fileName} and the GLB pipeline is unavailable. ` +
            `Stage metadata and inspection are still available in the sidebar.`,
        );
      }

      // Phase 2: yield one frame so the USD inspector sidebar (which is
      // populated in parallel by App.tsx via the Rust backend) has a chance
      // to paint before we block the main thread on the synchronous
      // Three.js parse. See docs/usd-phase2.md for the 2-stage load design.
      await yieldToPaint();

      // Route the parse to a Web Worker by default (#45). On any worker
      // failure we silently fall back to the synchronous main-thread
      // parse so the worker can never make things worse than the
      // pre-#45 behavior. Disable with `VITE_USD_WORKER=0` at build
      // time when bisecting a worker-only regression.
      let workerObject: Object3D | null = null;
      if (isUsdWorkerEnabled()) {
        try {
          reportStage("gpu");
          workerObject = await parseUsdInWorker(
            file.path,
            usdaText
              ? { kind: "text", text: usdaText }
              : { kind: "binary", buffer },
          );
        } catch (error) {
          console.warn(
            "[usd] worker parse failed, falling back to main thread:",
            error,
          );
          workerObject = null;
        }
      }
      // `USDLoader.parse` returns a `Group`; the worker path reconstructs
      // via `ObjectLoader.parse`, which is typed as `Object3D`. We cast
      // the worker output to `Group` to match `LoadedPreview.object` —
      // the scene graph shape is compatible even if the runtime class
      // nominal identity differs.
      let object: Group;
      try {
        reportStage("scene");
        object =
          (workerObject as Group | null) ??
          (usdaText ? loader.parse(usdaText) : loader.parse(buffer));
        console.info(`[usd] USDLoader.parse OK: ${file.fileName}`);
      } catch (parseError) {
        console.error("[usd] USDLoader.parse failed:", parseError);
        throw parseError;
      }

      try {
        const runtimeHints = await parseUsdRuntimeHints(file.path);
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
    case "png":
    case "jpg":
    case "jpeg": {
      reportStage("decode");
      const objectUrl = await createBlobUrlFromPath(file.path, file.extension);
      reportStage("gpu");
      const texture = await new TextureLoader().loadAsync(objectUrl);
      texture.colorSpace = SRGBColorSpace;
      texture.name = file.fileName;
      texture.userData.textureSourceKind = "standalone";
      return {
        object: createTexturePreview(texture),
        cleanupUrls: [objectUrl],
        clips: [],
        formatVersion: null,
      };
    }
    case "tga": {
      reportStage("decode");
      const { TGALoader } =
        await import("three/examples/jsm/loaders/TGALoader.js");
      const objectUrl = await createBlobUrlFromPath(file.path, file.extension);
      reportStage("gpu");
      const texture = await new TGALoader().loadAsync(objectUrl);
      texture.colorSpace = SRGBColorSpace;
      texture.name = file.fileName;
      texture.userData.textureSourceKind = "standalone";
      return {
        object: createTexturePreview(texture),
        cleanupUrls: [objectUrl],
        clips: [],
        formatVersion: null,
      };
    }
    case "dds": {
      reportStage("decode");
      const { DDSLoader } =
        await import("three/examples/jsm/loaders/DDSLoader.js");
      const objectUrl = await createBlobUrlFromPath(file.path, file.extension);
      reportStage("gpu");
      const texture = await new DDSLoader().loadAsync(objectUrl);
      texture.colorSpace = SRGBColorSpace;
      texture.name = file.fileName;
      texture.userData.textureSourceKind = "standalone";
      return {
        object: createTexturePreview(texture),
        cleanupUrls: [objectUrl],
        clips: [],
        formatVersion: null,
      };
    }
    case "hdr": {
      reportStage("decode");
      const { RGBELoader } =
        await import("three/examples/jsm/loaders/RGBELoader.js");
      const objectUrl = await createBlobUrlFromPath(file.path, file.extension);
      reportStage("gpu");
      const texture = await new RGBELoader().loadAsync(objectUrl);
      texture.name = file.fileName;
      texture.userData.textureSourceKind = "standalone";
      return {
        object: createTexturePreview(texture),
        cleanupUrls: [objectUrl],
        clips: [],
        formatVersion: null,
      };
    }
    case "exr": {
      reportStage("decode");
      const { EXRLoader } =
        await import("three/examples/jsm/loaders/EXRLoader.js");
      const objectUrl = await createBlobUrlFromPath(file.path, file.extension);
      reportStage("gpu");
      const texture = await new EXRLoader().loadAsync(objectUrl);
      texture.name = file.fileName;
      texture.userData.textureSourceKind = "standalone";
      return {
        object: createTexturePreview(texture),
        cleanupUrls: [objectUrl],
        clips: [],
        formatVersion: null,
      };
    }
    case "ktx2": {
      reportStage("decode");
      const { KTX2Loader } =
        await import("three/examples/jsm/loaders/KTX2Loader.js");
      const objectUrl = await createBlobUrlFromPath(file.path, file.extension);
      const loader = new KTX2Loader();
      // The basis transcoder files are served from /basis/ (copied from
      // node_modules/three into public/basis/ at build time).
      loader.setTranscoderPath("/basis/");
      if (renderer) {
        loader.detectSupport(renderer);
      } else {
        // Fallback workerConfig for desktop (Tauri) where we can safely assume
        // S3TC/DXT and BPTC support on modern discrete GPUs. ASTC and PVRTC
        // are mobile-only formats; ETC2 is broadly supported but not critical.
        // This path is only taken in test/SSR environments without a renderer.
        (
          loader as unknown as { workerConfig: Record<string, boolean> }
        ).workerConfig = {
          astcSupported: false,
          astcHDRSupported: false,
          etc1Supported: false,
          etc2Supported: false,
          dxtSupported: true,
          bptcSupported: true,
          pvrtcSupported: false,
        };
      }
      // try/finally guarantees the KTX2 worker pool is torn down even when
      // the transcoder assets are missing, the file is corrupt, or the GPU
      // rejects the format — otherwise repeated failed opens leak workers.
      // On failure we also revoke the blob URL so it does not stay resident
      // (the normal cleanupUrls path only runs when we return successfully).
      let texture;
      try {
        reportStage("gpu");
        texture = await loader.loadAsync(objectUrl);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        throw error;
      } finally {
        loader.dispose();
      }
      texture.name = file.fileName;
      texture.userData.textureSourceKind = "standalone";
      return {
        object: createTexturePreview(texture),
        cleanupUrls: [objectUrl],
        clips: [],
        formatVersion: null,
      };
    }
    default:
      throw new Error(
        `Preview loader is not implemented for .${file.extension}`,
      );
  }
}

async function loadVrmPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  reportStage("scan");

  try {
    const [{ GLTFLoader }, { VRMLoaderPlugin, VRMUtils }] = await Promise.all([
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("@pixiv/three-vrm"),
    ]);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    reportStage("decode");
    const buffer = await readArrayBuffer(file.path);
    reportStage("gpu");
    const gltf = await loader.parseAsync(buffer, "");
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
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load VRM preview: ${message}`, { cause: error });
  }
}

const coreLoaderExtensions = [
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
  "png",
  "jpg",
  "jpeg",
  "tga",
  "dds",
  "hdr",
  "exr",
  "ktx2",
] as const;

export const loaderRegistry = new LoaderRegistry();

loaderRegistry.register({
  id: "core-preview-loader",
  name: "Core Preview Loader",
  extensions: coreLoaderExtensions,
  loadPreviewObject: (file, context) =>
    loadPreviewObjectCore(file, context.renderer, {
      usdLoadPolicy: context.usdLoadPolicy,
      variantSelections: context.variantSelections,
      glbOverride: context.glbOverride,
      onStage: context.onStage,
    }),
});

loaderRegistry.register({
  id: "vrm-loader-pack",
  name: "VRM Loader Pack",
  extensions: ["vrm"],
  optional: true,
  installed: true,
  loadPreviewObject: loadVrmPreviewObject,
});

export function listRegisteredLoaders() {
  return loaderRegistry.list();
}

export async function loadPreviewObject(
  file: SelectedFile,
  renderer?: import("three").WebGLRenderer,
  options: LoaderContext = {},
): Promise<LoadedPreview> {
  const loader = loaderRegistry.getByExtension(file.extension);
  if (!loader || loader.installed === false) {
    throw new Error(`Preview loader is not installed for .${file.extension}`);
  }

  return loader.loadPreviewObject(file, {
    ...options,
    renderer,
  });
}
