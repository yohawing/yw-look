import type { ViewerFeedback, PreviewSupportState } from "../types/viewer";

export type {
  ViewerMode,
  ViewerFeedback,
  DisplayMode,
  ViewerSurfaceMode,
  TextureViewMode,
  SceneContext,
  MmdAnimationHandle,
  MmdRuntimeModelHandle,
  MmdMotionPlayback,
  LoadedPreview,
  ViewerAssetKind,
  LoadedMmdMotion,
  DeferredTextureSnapshot,
  LoadingStageId,
  LoadingStageReporter,
  LoadingStageSnapshot,
  TextureBundle,
  TextureSlotKey,
  TexturedMaterial,
  MissingReferenceError,
  PreviewSupportState,
} from "../types/viewer";

export const implementedPreviewExtensions = new Set([
  "glb",
  "gltf",
  "vrm",
  "fbx",
  "obj",
  "ply",
  "stl",
  "dae",
  "usd",
  "usda",
  "usdc",
  "usdz",
  "abc",
  "png",
  "jpg",
  "jpeg",
  "tga",
  "dds",
  "hdr",
  "exr",
  "ktx2",
  "pmx",
  "pmd",
  "vmd",
  "splat",
  "spz",
  "ksplat",
  "sog",
]);

export const optionalPreviewLoaders = {
  vrm: {
    formatLabel: "VRM",
    loaderPackName: "VRM Loader Pack",
  },
  vrma: {
    formatLabel: "VRMA",
    loaderPackName: "VRM Loader Pack",
  },
  pmx: {
    formatLabel: "PMX",
    loaderPackName: "MMD Loader Pack",
  },
  pmd: {
    formatLabel: "PMD",
    loaderPackName: "MMD Loader Pack",
  },
  vmd: {
    formatLabel: "VMD",
    loaderPackName: "MMD Loader Pack",
  },
  splat: {
    formatLabel: "Gaussian Splat",
    loaderPackName: "Gaussian Splat Loader Pack",
  },
  spz: {
    formatLabel: "SPZ Gaussian Splat",
    loaderPackName: "Gaussian Splat Loader Pack",
  },
  ksplat: {
    formatLabel: "KSPLAT Gaussian Splat",
    loaderPackName: "Gaussian Splat Loader Pack",
  },
  sog: {
    formatLabel: "SOG Gaussian Splat",
    loaderPackName: "Gaussian Splat Loader Pack",
  },
} as const satisfies Record<
  string,
  {
    formatLabel: string;
    loaderPackName: string;
  }
>;

export function getPreviewSupportState(
  extension: string,
  options: { optionalLoaderInstalled?: boolean } = {},
): PreviewSupportState {
  if (
    extension in optionalPreviewLoaders &&
    options.optionalLoaderInstalled === false
  ) {
    return "missingOptionalLoader";
  }

  if (implementedPreviewExtensions.has(extension)) {
    return "implemented";
  }

  if (extension in optionalPreviewLoaders) {
    return "missingOptionalLoader";
  }

  return "unsupported";
}

export function formatMissingOptionalLoaderMessage(extension: string) {
  const optionalLoader =
    optionalPreviewLoaders[extension as keyof typeof optionalPreviewLoaders];

  if (!optionalLoader) {
    return null;
  }

  return {
    title: `${optionalLoader.loaderPackName} is not installed.`,
    body: `Install ${optionalLoader.loaderPackName} to preview ${optionalLoader.formatLabel} files.`,
  };
}

export function formatUnsupportedFormatMessage(extension: string) {
  const normalizedExtension = extension ? `.${extension}` : "this extension";
  return {
    title: "This file format is not supported yet.",
    body: `No preview loader is available for ${normalizedExtension}. Supported core formats include GLB, glTF, FBX, OBJ, USD, STL, PLY, DAE, PMX, PMD, VMD, SPLAT, SPZ, KSPLAT, SOG, PNG, JPG, TGA, DDS, HDR, EXR, and KTX2.`,
  };
}

export const neutralFeedback: ViewerFeedback = {
  mode: "empty",
  message: "Open a supported asset to initialize the preview scene.",
  warning: null,
  canResetCamera: false,
};
