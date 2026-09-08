import type { ComponentType } from "react";
import type { Camera, Object3D, WebGLRenderer } from "three";
import type { SelectedFile } from "../lib/files";
import type {
  LoaderContext,
  LoaderPlugin,
  MmdAssetMetadata,
  SceneContext,
} from "./viewer";

export type PackRuntimeAnimationSnapshot = {
  currentTime: number;
  duration: number;
};

export type PackRuntimeAnimation = {
  hasAnimation: () => boolean;
  update: (deltaSeconds: number) => void;
  getSnapshot: () => PackRuntimeAnimationSnapshot | null;
  seek: (time: number) => PackRuntimeAnimationSnapshot | null;
  step: (direction: -1 | 1) => PackRuntimeAnimationSnapshot | null;
};

export type PackRuntimeFrame = {
  camera: Camera;
  deltaSeconds: number;
  renderer: WebGLRenderer;
};

export type PackRuntime = {
  animation?: PackRuntimeAnimation;
  selection?: {
    pick: (
      event: Pick<PointerEvent, "clientX" | "clientY">,
      camera: Camera,
      canvas: HTMLCanvasElement,
    ) => Promise<string | null>;
    select: (key: string | null) => Promise<void>;
  };
  update?: (frame: PackRuntimeFrame) => void;
  /** True when runtime/worker code owns the mounted object's GPU resources. */
  ownsMountedObjectResources?: boolean;
  dispose: () => void;
};

export type PackFileRequest = {
  packId: string;
  action: string;
  file: SelectedFile;
  version: number;
};

export type MmdPackMetadata = {
  kind: "mmd";
  asset: MmdAssetMetadata;
};

export type PackMetadata =
  MmdPackMetadata | { kind: "ifc"; inspection: import("./ifc").IfcInspection };

export type FormatPack = LoaderPlugin & {
  collectMetadata?: (
    object: Object3D,
    file: SelectedFile,
  ) => PackMetadata | null;
  MetadataCard?: ComponentType<{
    metadata: PackMetadata;
    onSelect?: (key: string | null) => void;
  }>;
  createRuntime?: (context: SceneContext) => PackRuntime;
  createFileRequest?: (
    file: SelectedFile,
    context: {
      currentFile: SelectedFile | null;
      version: number;
    },
  ) => PackFileRequest | null;
};

export type CoreLoaderContextFields = Pick<
  LoaderContext,
  | "usdLoadPolicy"
  | "getUsdInspection"
  | "variantSelections"
  | "glbOverride"
  | "onDeferredTexture"
  | "onWarning"
>;

export type PackLoaderContextFields = Pick<
  LoaderContext,
  | "renderer"
  | "onStage"
  | "signal"
  | "parseTimeoutMs"
  | "disabledOptionalLoaderPackIds"
  | "incompatibleOptionalLoaderPackIds"
>;
