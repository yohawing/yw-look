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

vi.mock("@yohawing/three-mmd-loader", () => ({
  parsePmxMetadata: vi.fn(() => ({
    format: "pmx",
    header: { version: 2.1 },
    name: "初音ミク",
    englishName: "Hatsune Miku",
  })),
  parsePmdMetadata: vi.fn(() => ({
    format: "pmd",
    header: { version: 1 },
    name: "Legacy Model",
    englishName: "",
  })),
  ThreeMmdLoader: class {
    constructor(readonly options?: unknown) {}

    loadModel(source: ArrayBuffer, options?: unknown) {
      return mocks.loadAsync(source, this, options);
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
  });

  it("registers the optional MMD loader and returns a static mesh preview", async () => {
    const mesh = new Group();
    const stages: string[] = [];
    const warnings: string[] = [];

    mocks.loadAsync.mockImplementation(async (_source, loader) => {
      const resolver = loader.options.textureResolver;
      await expect(resolver.resolve("textures/missing.png")).resolves.toBe(
        "asset://localhost/C:\\mmd\\textures\\missing.png",
      );
      await expect(
        resolver.resolve("https://example.com/mmd/diffuse.png"),
      ).resolves.toBe("https://example.com/mmd/diffuse.png");
      return Promise.resolve({
        mesh,
        textureDiagnostics: [
          {
            level: "warning",
            code: "TEXTURE_RESOLVE_FAILED",
            materialIndex: 0,
            textureKind: "diffuse",
            path: "textures/missing.png",
          },
          {
            level: "warning",
            code: "TEXTURE_RESOLVE_FAILED",
            materialIndex: 1,
            textureKind: "diffuse",
            path: "textures/missing.png",
          },
          {
            level: "warning",
            code: "SPHERE_MAP_NOT_SUPPORTED",
            materialIndex: 2,
            textureKind: "sphere",
            path: "effects/unsupported.sph",
          },
        ],
      });
    });

    const result = await loadPreviewObject(pmxFile, undefined, {
      onStage: (stage) => stages.push(stage),
      onWarning: (warning) => warnings.push(warning),
    });

    expect(mocks.loadAsync).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.any(Object),
      { outlines: false },
    );
    expect(mocks.convertFileSrc).toHaveBeenCalledWith(
      "C:\\mmd\\textures\\missing.png",
    );
    expect(mesh.name).toBe("Hatsune Miku");
    expect(mesh.userData.mmdSourceFile).toBe("C:\\mmd\\初音ミク.pmx");
    expect(result).toMatchObject({
      object: mesh,
      cleanupUrls: [],
      clips: [],
      formatVersion: "PMX 2.1",
    });
    expect(result.warnings).toEqual([
      "Missing MMD external asset: C:\\mmd\\textures\\missing.png. The model was loaded with a fallback or incomplete material.",
      "Unsupported MMD sphere texture: C:\\mmd\\effects\\unsupported.sph. The model was loaded without this sphere map.",
    ]);
    expect(warnings).toEqual(result.warnings);
    expect(stages).toEqual(["scan", "decode", "scene"]);
  });

  it("labels PMD previews by the opened source format", async () => {
    const mesh = new Group();

    mocks.loadAsync.mockResolvedValue({
      mesh,
      textureDiagnostics: [],
    });

    const result = await loadPreviewObject(pmdFile);

    expect(mesh.name).toBe("Legacy Model");
    expect(result.formatVersion).toBe("PMD 1");
  });

  it("wraps parser failures with MMD context", async () => {
    mocks.loadAsync.mockRejectedValue(new Error("malformed PMX payload"));

    await expect(loadPreviewObject(pmxFile)).rejects.toThrow(
      "Unable to load MMD preview: malformed PMX payload",
    );
  });
});
