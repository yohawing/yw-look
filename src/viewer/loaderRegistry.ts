import type { FormatPack } from "../types/format-pack";
import type { RegisteredLoaderInfo } from "../types/viewer";

export type {
  LoaderContext,
  LoaderPlugin,
  RegisteredLoaderInfo,
} from "../types/viewer";
export type {
  FormatPack,
  PackMetadata,
  PackRuntime,
} from "../types/format-pack";

export class LoaderRegistry {
  readonly #packsById = new Map<string, FormatPack>();
  readonly #loadersByExtension = new Map<string, FormatPack>();

  register(pack: FormatPack): void {
    const existingPack = this.#packsById.get(pack.id);
    if (existingPack && existingPack !== pack) {
      throw new Error(`Loader pack already registered: ${pack.id}`);
    }
    this.#packsById.set(pack.id, pack);

    for (const extension of pack.extensions) {
      const normalized = extension.toLowerCase();
      if (this.#loadersByExtension.has(normalized)) {
        throw new Error(`Loader already registered for .${normalized}`);
      }
      this.#loadersByExtension.set(normalized, pack);
    }
  }

  getByExtension(extension: string): FormatPack | null {
    return this.#loadersByExtension.get(extension.toLowerCase()) ?? null;
  }

  getById(id: string): FormatPack | null {
    return this.#packsById.get(id) ?? null;
  }

  listPacks(): FormatPack[] {
    return [...this.#packsById.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
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
