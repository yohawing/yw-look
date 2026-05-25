import { beforeEach, describe, expect, it, vi } from "vitest";
import { Group } from "three";
import type { SelectedFile } from "../../lib/files";

const mocks = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
  loadAsync: vi.fn(),
  readBinaryFile: vi.fn(),
  revokeObjectURL: vi.fn(),
  physicsBackend: { dispose: vi.fn() },
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
  loadAmmoNamespace: vi.fn(async () => ({})),
  createAmmoMmdPhysicsBackend: vi.fn(() => mocks.physicsBackend),
  parseVmd: vi.fn(() => ({
    kind: "vmd",
    metadata: { maxFrame: 60, modelName: "Hatsune Miku" },
    boneTracks: {},
    morphTracks: {},
    cameraFrames: [],
    lightFrames: [],
    selfShadowFrames: [],
    propertyFrames: [],
  })),
  parsePmxMetadata: vi.fn(() => ({
    format: "pmx",
    header: {
      version: 2.1,
      encoding: "utf-8",
      additionalUvCount: 1,
      indexSizes: { vertex: 4, texture: 1, material: 1, bone: 2 },
    },
    name: "初音ミク",
    englishName: "Hatsune Miku",
    comment: "Japanese comment",
    englishComment: "English comment",
    counts: {
      vertices: 100,
      faces: 200,
      textures: 3,
      materials: 2,
      bones: 20,
      morphs: 4,
      displayFrames: 2,
      rigidBodies: 3,
      joints: 1,
      softBodies: 0,
    },
    trailingBytes: 0,
  })),
  parsePmxSectionInventory: vi.fn(() => ({
    format: "pmx",
    trailingBytes: 0,
    sections: [
      { name: "vertices", count: 100, offset: 64, byteLength: 3200 },
      { name: "materials", count: 2, offset: 4096, byteLength: 256 },
    ],
  })),
  parsePmdMetadata: vi.fn(() => ({
    format: "pmd",
    header: { version: 1 },
    encoding: "shift-jis",
    name: "Legacy Model",
    englishName: "",
    comment: "",
    englishComment: "",
    counts: {
      vertices: 10,
      faces: 12,
      materials: 1,
      bones: 3,
      iks: 1,
      morphs: 0,
      displayFrames: 1,
      rigidBodies: 0,
      joints: 0,
      softBodies: 0,
    },
    trailingBytes: 0,
  })),
  parsePmdSectionInventory: vi.fn(() => ({
    format: "pmd",
    trailingBytes: 0,
    sections: [{ name: "vertices", count: 10, offset: 283, byteLength: 380 }],
  })),
  ThreeMmdLoader: class {
    constructor(readonly options?: unknown) {}

    loadModel(source: ArrayBuffer, options?: unknown) {
      return mocks.loadAsync(source, this, options);
    }
  },
}));

vi.mock("#yw-look-mmd-loader-entry", () => import("../mmd/loaderInstalled"));

import { loadMmdMotion, loadPreviewObject } from "../loaders";

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

const vmdFile: SelectedFile = {
  path: "C:\\mmd\\motion.vmd",
  fileName: "motion.vmd",
  extension: "vmd",
  kind: "motion",
  parentDirectory: "C:\\mmd",
};

describe("MMD preview loader", () => {
  beforeEach(() => {
    mocks.convertFileSrc.mockClear();
    mocks.loadAsync.mockReset();
    mocks.readBinaryFile.mockReset();
    mocks.revokeObjectURL.mockReset();
    mocks.readBinaryFile.mockResolvedValue([0x50, 0x4d, 0x58, 0x20]);
    mocks.physicsBackend.dispose.mockClear();
  });

  it("registers the optional MMD loader and returns a static mesh preview", async () => {
    const mesh = new Group();
    mesh.userData.mmdModel = {
      diagnostics: [
        {
          level: "warning",
          code: "UNSUPPORTED_MORPH",
          message: "Unsupported morph types are present.",
        },
      ],
    };
    const outlineMesh = new Group();
    const renderOrderMesh = new Group();
    const stages: string[] = [];
    const warnings: string[] = [];

    mocks.readBinaryFile.mockImplementation(async (path: string) => {
      if (path.endsWith("\\textures\\missing.png")) {
        throw new Error("missing texture");
      }
      if (path.endsWith("\\toon01.bmp")) {
        throw new Error("missing built-in toon sibling");
      }
      return [0x50, 0x4d, 0x58, 0x20];
    });
    mocks.loadAsync.mockImplementation(async (_source, loader) => {
      expect(loader.options.geometryAwareAlpha).toBe(true);
      expect(loader.options.runtime).toMatchObject({
        frameRate: 30,
        physics: "external",
        physicsBackend: mocks.physicsBackend,
      });
      const resolver = loader.options.textureResolver;
      const diffuse = await resolver.resolve("textures/diffuse.bmp");
      expect(diffuse).toBeInstanceOf(Blob);
      expect(diffuse.type).toBe("image/bmp");
      await expect(resolver.resolve("textures/diffuse.bmp")).resolves.toBe(
        diffuse,
      );
      await expect(resolver.resolve("textures/missing.png")).resolves.toBe(
        undefined,
      );
      const compound = await resolver.resolve(
        "textures/missing.png*effects/sphere.sph",
      );
      expect(compound).toBeInstanceOf(Blob);
      await expect(
        resolver.resolve("https://example.com/mmd/diffuse.png"),
      ).resolves.toBe("https://example.com/mmd/diffuse.png");
      await expect(resolver.resolve("toon01.bmp")).resolves.toContain(
        "three-mmd-loader/dist/three/assets/mmd/toon01.bmp",
      );
      await expect(resolver.resolve("toon02.bmp")).resolves.toBeInstanceOf(
        Blob,
      );
      return Promise.resolve({
        mesh,
        outlineMeshes: [outlineMesh],
        renderOrderMeshes: [renderOrderMesh],
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
      { outlines: true, frustumCulled: false },
    );
    expect(mocks.convertFileSrc).not.toHaveBeenCalled();
    expect(result.object.name).toBe("Hatsune Miku Preview");
    expect(mesh.name).toBe("Hatsune Miku");
    expect(result.object.userData.__ywMmdModel).toBeDefined();
    expect(result.object.userData.mmd).toBeUndefined();
    expect(mesh.userData.__ywMmdModel).toBeDefined();
    expect(mesh.userData.mmd).toBeUndefined();
    expect(mesh.userData.mmdSourceFile).toBe("C:\\mmd\\初音ミク.pmx");
    expect(result.object.children).toEqual([
      mesh,
      outlineMesh,
      renderOrderMesh,
    ]);
    expect(outlineMesh.userData.__ywSelectionProxyTarget).toBe(mesh);
    expect(renderOrderMesh.userData.__ywSelectionProxyTarget).toBe(mesh);
    expect(result).toMatchObject({
      cleanupUrls: [],
      cleanupCallbacks: [expect.any(Function)],
      clips: [],
      formatVersion: "PMX 2.1",
      skipScaleNormalization: true,
      lighting: {
        ambientIntensity: 0.15,
        keyIntensity: 1,
        keyPosition: [3, 4, 5],
        fillIntensity: 0,
      },
      rendering: {
        logarithmicDepthBuffer: true,
        outputColorSpace: "srgb",
        toneMapping: 0,
        toneMappingExposure: 1,
      },
      mmdMetadata: {
        format: "pmx",
        version: 2.1,
        encoding: "utf-8",
        name: "初音ミク",
        englishName: "Hatsune Miku",
        comment: "Japanese comment",
        englishComment: "English comment",
        additionalUvCount: 1,
        trailingBytes: 0,
        counts: {
          vertices: 100,
          faces: 200,
          textures: 3,
          materials: 2,
          bones: 20,
          morphs: 4,
          displayFrames: 2,
          rigidBodies: 3,
          joints: 1,
          softBodies: 0,
        },
        sections: [
          { name: "vertices", count: 100, offset: 64, byteLength: 3200 },
          { name: "materials", count: 2, offset: 4096, byteLength: 256 },
        ],
        diagnostics: [
          {
            level: "warning",
            code: "UNSUPPORTED_MORPH",
            message: "Unsupported morph types are present.",
          },
        ],
      },
    });
    expect(result.warnings).toEqual([
      "Missing MMD external asset: C:\\mmd\\textures\\missing.png. The model was loaded with a fallback or incomplete material.",
      "Unsupported MMD sphere texture: C:\\mmd\\effects\\unsupported.sph. The model was loaded without this sphere map.",
    ]);
    expect(warnings).toEqual(result.warnings);
    expect(stages).toEqual(["scan", "decode", "scene"]);
    result.cleanupCallbacks?.[0]?.();
    expect(mocks.physicsBackend.dispose).toHaveBeenCalledTimes(1);
  });

  it("labels PMD previews by the opened source format", async () => {
    const mesh = new Group();

    mocks.loadAsync.mockResolvedValue({
      mesh,
      outlineMeshes: [],
      renderOrderMeshes: [],
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

  it("loads VMD motion duration from MMD metadata", async () => {
    const result = await loadMmdMotion(vmdFile);

    expect(result.label).toBe("motion.vmd");
    expect(result.duration).toBe(2);
    expect(result.animation.metadata.maxFrame).toBe(60);
  });
});
