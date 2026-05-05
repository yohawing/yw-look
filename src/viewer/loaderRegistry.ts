import type { WebGLRenderer } from "three";
import type { SelectedFile } from "../lib/files";
import type {
  DeferredTextureSnapshot,
  LoadedPreview,
  LoadingStageReporter,
} from "./types";

export type LoaderContext = {
  renderer?: WebGLRenderer;
  usdLoadPolicy?: import("../lib/usd").StageLoadPolicy;
  variantSelections?: import("../lib/usd").VariantSelection[];
  glbOverride?: ArrayBuffer | null;
  onStage?: LoadingStageReporter;
  onDeferredTexture?: (snapshot: DeferredTextureSnapshot) => void;
};

export type LoaderPlugin = {
  id: string;
  name: string;
  extensions: readonly string[];
  optional?: boolean;
  installed?: boolean;
  loadPreviewObject: (
    file: SelectedFile,
    context: LoaderContext,
  ) => Promise<LoadedPreview>;
};

export type RegisteredLoaderInfo = {
  id: string;
  name: string;
  extension: string;
  optional: boolean;
  installed: boolean;
};

export class LoaderRegistry {
  readonly #loadersByExtension = new Map<string, LoaderPlugin>();

  register(loader: LoaderPlugin): void {
    for (const extension of loader.extensions) {
      const normalized = extension.toLowerCase();
      if (this.#loadersByExtension.has(normalized)) {
        throw new Error(`Loader already registered for .${normalized}`);
      }
      this.#loadersByExtension.set(normalized, loader);
    }
  }

  getByExtension(extension: string): LoaderPlugin | null {
    return this.#loadersByExtension.get(extension.toLowerCase()) ?? null;
  }

  list(): RegisteredLoaderInfo[] {
    return [...this.#loadersByExtension.entries()]
      .map(([extension, loader]) => ({
        id: loader.id,
        name: loader.name,
        extension,
        optional: loader.optional === true,
        installed: loader.installed !== false,
      }))
      .sort((left, right) => left.extension.localeCompare(right.extension));
  }
}
