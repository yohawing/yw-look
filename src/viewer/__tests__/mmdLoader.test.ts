import { beforeEach, describe, expect, it, vi } from "vitest";
import { Group } from "three";
import type { SelectedFile } from "../../lib/files";

const mocks = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
  loadAsync: vi.fn(),
  readBinaryFile: vi.fn(),
  revokeObjectURL: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: mocks.convertFileSrc,
  invoke: vi.fn(),
}));

vi.mock("../../lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/files")>()),
  readBinaryFile: mocks.readBinaryFile,
}));

vi.mock("@moeru/three-mmd", () => ({
  MMDLoader: class {
    resourcePath = "";

    constructor(
      readonly plugins?: unknown[],
      readonly manager?: import("three").LoadingManager,
    ) {}

    setResourcePath(path: string) {
      this.resourcePath = path;
      return this;
    }

    loadAsync(url: string) {
      return mocks.loadAsync(url, this);
    }
  },
}));

import { loadPreviewObject } from "../loaders";

const pmxFile: SelectedFile = {
  path: "C:\\mmd\\初音ミク.pmx",
  fileName: "初音ミク.pmx",
  extension: "pmx",
  kind: "model",
  parentDirectory: "C:\\mmd",
};

const pmdFile: SelectedFile = {
  path: "C:\\mmd\\legacy.pmd",
  fileName: "legacy.pmd",
  extension: "pmd",
  kind: "model",
  parentDirectory: "C:\\mmd",
};

describe("MMD preview loader", () => {
  beforeEach(() => {
    mocks.convertFileSrc.mockClear();
    mocks.loadAsync.mockReset();
    mocks.readBinaryFile.mockReset();
    mocks.revokeObjectURL.mockReset();
    mocks.readBinaryFile.mockResolvedValue([0x50, 0x4d, 0x58, 0x20]);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mmd-model"),
      revokeObjectURL: mocks.revokeObjectURL,
    });
  });

  it("registers the optional MMD loader and returns a static mesh preview", async () => {
    const mesh = new Group();
    const stages: string[] = [];
    const warnings: string[] = [];

    mocks.loadAsync.mockImplementation((_url, loader) => {
      const resolvedTextureUrl = loader.manager.resolveURL(
        "C:/mmd/textures/missing.png",
      );
      loader.manager.onError?.(resolvedTextureUrl);
      return Promise.resolve({
        mesh,
        pmx: {
          header: {
            version: 2.1,
            modelName: "初音ミク",
            englishModelName: "Hatsune Miku",
          },
        },
      });
    });

    const result = await loadPreviewObject(pmxFile, undefined, {
      onStage: (stage) => stages.push(stage),
      onWarning: (warning) => warnings.push(warning),
    });

    expect(mocks.loadAsync).toHaveBeenCalledWith(
      "blob:mmd-model",
      expect.any(Object),
    );
    expect(mocks.convertFileSrc).toHaveBeenCalledWith(
      "C:\\mmd\\textures\\missing.png",
    );
    expect(mesh.name).toBe("Hatsune Miku");
    expect(mesh.userData.mmdSourceFile).toBe("C:\\mmd\\初音ミク.pmx");
    expect(result).toMatchObject({
      object: mesh,
      cleanupUrls: ["blob:mmd-model"],
      clips: [],
      formatVersion: "PMX 2.1",
    });
    expect(result.warnings).toEqual([
      "Missing MMD external asset: C:\\mmd\\textures\\missing.png. The model was loaded with a fallback or incomplete material.",
    ]);
    expect(warnings).toEqual(result.warnings);
    expect(stages).toEqual(["scan", "decode", "scene"]);
  });

  it("labels PMD previews by the opened source format", async () => {
    const mesh = new Group();

    mocks.loadAsync.mockResolvedValue({
      mesh,
      pmx: {
        header: {
          version: 1,
          modelName: "Legacy Model",
          englishModelName: "",
        },
      },
    });

    const result = await loadPreviewObject(pmdFile);

    expect(mesh.name).toBe("Legacy Model");
    expect(result.formatVersion).toBe("PMD 1");
  });

  it("revokes the model blob URL when parsing fails", async () => {
    mocks.loadAsync.mockRejectedValue(new Error("malformed PMX payload"));

    await expect(loadPreviewObject(pmxFile)).rejects.toThrow(
      "Unable to load MMD preview: malformed PMX payload",
    );
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:mmd-model");
  });
});
