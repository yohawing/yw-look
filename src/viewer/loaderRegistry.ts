import type { LoaderPlugin, RegisteredLoaderInfo } from "../types/viewer";

export type {
  LoaderContext,
  LoaderPlugin,
  RegisteredLoaderInfo,
} from "../types/viewer";

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
