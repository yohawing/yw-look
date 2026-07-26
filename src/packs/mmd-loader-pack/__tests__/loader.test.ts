import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
} from "three";
import type { SelectedFile } from "../../../lib/files";

const mocks = vi.hoisted(() => ({
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
  attachMmdSdefSkinning: vi.fn(),
  loadAsync: vi.fn(),
  initCore: vi.fn(),
  syncMmdMaterialStates: vi.fn(),
  syncMmdOutlineMaterialStates: vi.fn(),
  syncMmdSpecularDirection: vi.fn(),
  applyMmdLightStateToThreeDirectionalLight: vi.fn(
    (light, state, options = {}) => {
      if (!state) return light;
      light.color.setRGB(state.color[0], state.color[1], state.color[2]);
      const direction = options.directionScratch;
      direction?.set(
        -state.direction[0],
        -state.direction[1],
        state.direction[2],
      );
      if (direction && direction.lengthSq() > 0) {
        direction.normalize();
        light.target.position.set(0, 0, 0);
        light.position.copy(direction).multiplyScalar(5);
        light.target.updateMatrixWorld();
        light.updateMatrixWorld();
      }
      return light;
    },
  ),
  readBinaryFile: vi.fn(),
  revokeObjectURL: vi.fn(),
  runtimeSetAnimation: vi.fn(),
  runtimeTick: vi.fn(),
  runtimeReset: vi.fn(),
  fetchKuroko: vi.fn(),
  physicsBackend: { dispose: vi.fn() },
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: mocks.convertFileSrc,
  invoke: vi.fn(),
}));

vi.mock("../../../lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/files")>()),
  readBinaryFile: mocks.readBinaryFile,
}));

vi.mock("@yohawing/three-mmd-loader", () => ({
  attachMmdSdefSkinning: mocks.attachMmdSdefSkinning,
  loadAmmoNamespace: vi.fn(async () => ({})),
  createAmmoMmdPhysicsBackend: vi.fn(() => mocks.physicsBackend),
  initCore: mocks.initCore,
  applyMmdLightStateToThreeDirectionalLight:
    mocks.applyMmdLightStateToThreeDirectionalLight,
  syncMmdMaterialStates: mocks.syncMmdMaterialStates,
  syncMmdOutlineMaterialStates: mocks.syncMmdOutlineMaterialStates,
  syncMmdSpecularDirection: mocks.syncMmdSpecularDirection,
  parseVmd: vi.fn(() => ({
    kind: "vmd",
    metadata: { maxFrame: 60, modelName: "Hatsune Miku" },
    boneTracks: { センター: {}, customBone: {} },
    morphTracks: { smile: {} },
    cameraFrames: [{ frame: 45 }],
    lightFrames: [{ frame: 30 }],
    selfShadowFrames: [],
    propertyFrames: [],
  })),
  parseVmdMetadata: vi.fn(() => ({
    format: "vmd",
    signature: "Vocaloid Motion Data 0002",
    encoding: "shift-jis",
    modelName: "Hatsune Miku",
    counts: {
      bones: 3,
      morphs: 2,
      cameras: 1,
      lights: 1,
      selfShadows: 0,
      properties: 0,
    },
    trailingBytes: 0,
  })),
  parseVmdSectionInventory: vi.fn(() => ({
    format: "vmd",
    signature: "Vocaloid Motion Data 0002",
    encoding: "shift-jis",
    modelName: "Hatsune Miku",
    counts: {
      bones: 3,
      morphs: 2,
      cameras: 1,
      lights: 1,
      selfShadows: 0,
      properties: 0,
    },
    trailingBytes: 0,
    sections: [
      {
        name: "bone",
        count: 3,
        countOffset: 50,
        dataOffset: 54,
        byteLength: 333,
      },
      {
        name: "morph",
        count: 2,
        countOffset: 387,
        dataOffset: 391,
        byteLength: 46,
      },
    ],
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

vi.mock("#yw-look-mmd-loader-entry", () => import("../loaderInstalled"));

import * as threeMmdLoader from "@yohawing/three-mmd-loader";
import { loadMmdMotion, loadPreviewObject } from "../../../viewer/loaders";
import { applySelectionMaterialCustomizer } from "../../../viewer";
import {
  loadMmdMotionPreviewObject,
  loadMmdPreviewObject,
  syncMmdPreviewSpecularDirection,
} from "../loaderInstalled";
import { collectMmdMetadata } from "../metadata";
import { isInternalMmdProxyObject } from "../userData";
import {
  findObjectBySelectionKey,
  selectionKeyForObject,
} from "../../../viewport/selection";

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

function createParsedMaterialMorphModel() {
  return {
    skeleton: () => ({ bones: [] }),
    materials: () => [
      {
        diffuse: [1, 1, 1, 1],
        specular: [0, 0, 0],
        specularPower: 1,
        ambient: [0, 0, 0],
        edgeColor: [0, 0, 0, 1],
        edgeSize: 1,
      },
    ],
    morphs: () => [
      {
        materialOffsets: [
          {
            materialIndex: -1,
            operation: "add",
            diffuse: [0, 0, 0, -1],
            specular: [0, 0, 0],
            specularPower: 0,
            ambient: [0, 0, 0],
            edgeColor: [0, 0, 0, -0.5],
            edgeSize: -0.5,
            textureFactor: [0, 0, 0, 0],
            sphereTextureFactor: [0, 0, 0, 0],
            toonTextureFactor: [0, 0, 0, 0],
          },
        ],
      },
    ],
  };
}

describe("MMD preview loader", () => {
  beforeEach(() => {
    mocks.convertFileSrc.mockClear();
    mocks.attachMmdSdefSkinning.mockClear();
    mocks.initCore.mockReset();
    mocks.initCore.mockResolvedValue({
      loadModel: vi.fn(() => ({
        skeleton: () => ({ bones: [] }),
        materials: () => [],
        morphs: () => [],
      })),
    });
    mocks.syncMmdMaterialStates.mockReset();
    mocks.syncMmdOutlineMaterialStates.mockReset();
    mocks.syncMmdSpecularDirection.mockReset();
    mocks.applyMmdLightStateToThreeDirectionalLight.mockClear();
    mocks.loadAsync.mockReset();
    mocks.readBinaryFile.mockReset();
    mocks.revokeObjectURL.mockReset();
    mocks.runtimeSetAnimation.mockReset();
    mocks.runtimeTick.mockReset();
    mocks.runtimeReset.mockReset();
    mocks.fetchKuroko.mockReset();
    mocks.fetchKuroko.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([0x50, 0x4d, 0x58]).buffer,
    });
    vi.stubGlobal("fetch", mocks.fetchKuroko);
    mocks.readBinaryFile.mockResolvedValue(
      new Uint8Array([0x50, 0x4d, 0x58, 0x20]).buffer,
    );
    mocks.physicsBackend.dispose.mockClear();
  });

  it("applies the upstream VMD light direction convention numerically", async () => {
    const material = new MeshBasicMaterial();
    const mesh = new Mesh(undefined, material);
    const traverse = vi.spyOn(mesh, "traverse");
    const light = new DirectionalLight("#ffffff", 1);
    light.position.set(9, 9, 9);
    const model = {
      mesh,
      runtime: {
        reset: vi.fn(),
        setAnimation: vi.fn(),
        tick: vi.fn(),
        lightState: vi.fn(() => ({
          color: [0.2, 0.4, 0.6] as const,
          direction: [0.25, -0.5, 0.75] as const,
        })),
      },
    };

    const sync = await syncMmdPreviewSpecularDirection(model, light);

    expect(sync).toBeTypeOf("function");
    expect(light.color.r).toBeCloseTo(0.2);
    expect(light.color.g).toBeCloseTo(0.4);
    expect(light.color.b).toBeCloseTo(0.6);
    // three-mmd-loader maps MMD direction [x,y,z] to Three direction
    // [-x,-y,+z] and places the key at distance 5 from its origin target.
    expect(light.target.position.toArray()).toEqual([0, 0, 0]);
    expect(light.position.x).toBeCloseTo(-1.336306);
    expect(light.position.y).toBeCloseTo(2.672612);
    expect(light.position.z).toBeCloseTo(4.008919);
    expect(mocks.syncMmdSpecularDirection).toHaveBeenCalledWith(
      [material],
      light,
    );
    sync?.();
    expect(traverse).toHaveBeenCalledOnce();
  });

  it("keeps the preset light untouched when VMD has no light track", async () => {
    const mesh = new Mesh(undefined, new MeshBasicMaterial());
    const light = new DirectionalLight("#ffffff", 1);
    light.color.setRGB(0.7, 0.6, 0.5);
    light.position.set(3, 4, 5);
    const initialPosition = light.position.toArray();
    const model = {
      mesh,
      runtime: {
        reset: vi.fn(),
        setAnimation: vi.fn(),
        tick: vi.fn(),
        lightState: vi.fn(() => undefined),
      },
    };

    const sync = await syncMmdPreviewSpecularDirection(model, light);
    sync?.();
    sync?.();

    expect(light.color.toArray()).toEqual([0.7, 0.6, 0.5]);
    expect(light.position.toArray()).toEqual(initialPosition);
    expect(mocks.syncMmdSpecularDirection).toHaveBeenCalledTimes(1);
  });

  it("restores the mount baseline when a light track becomes absent", async () => {
    const mesh = new Mesh(undefined, new MeshBasicMaterial());
    const light = new DirectionalLight("#ffffff", 1);
    light.color.setRGB(0.7, 0.6, 0.5);
    light.position.set(3, 4, 5);
    light.target.position.set(1, 2, 3);
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
    const baselineColor = light.color.clone();
    const baselinePosition = light.position.clone();
    const baselineTarget = light.target.position.clone();
    const lightState = vi
      .fn()
      .mockReturnValueOnce({
        color: [0.2, 0.4, 0.6] as const,
        direction: [0.25, -0.5, 0.75] as const,
      })
      .mockReturnValue(undefined);
    const model = {
      mesh,
      runtime: {
        reset: vi.fn(),
        setAnimation: vi.fn(),
        tick: vi.fn(),
        lightState,
      },
    };

    const sync = await syncMmdPreviewSpecularDirection(model, light);
    expect(light.position.toArray()).not.toEqual(baselinePosition.toArray());
    lightState.mockReturnValue(undefined);
    sync?.();

    expect(light.color.toArray()).toEqual(baselineColor.toArray());
    expect(light.position.toArray()).toEqual(baselinePosition.toArray());
    expect(light.target.position.toArray()).toEqual(baselineTarget.toArray());
    expect(light.matrixWorld.elements[12]).toBeCloseTo(baselinePosition.x);
    expect(light.target.matrixWorld.elements[13]).toBeCloseTo(baselineTarget.y);
    expect(mocks.syncMmdSpecularDirection).toHaveBeenCalledTimes(2);
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
        {
          level: "warning",
          code: "UNSUPPORTED_MORPH",
          message: "Unsupported morph types are present.",
        },
        {
          level: "warning",
          code: "IK_PMX_LINK_LIMITS_APPROXIMATE",
          message: "PMX IK link limits were approximated.",
        },
        {
          level: "warning",
          code: "BONE_FIXED_AXIS_CONSTRAINTS_UNSUPPORTED",
          message: "Fixed axis constraints are not supported.",
        },
        {
          level: "warning",
          code: "BONE_LOCAL_AXIS_CONSTRAINTS_UNSUPPORTED",
          message: "Local axis constraints are not supported.",
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
      return new Uint8Array([0x50, 0x4d, 0x58, 0x20]).buffer;
    });
    mocks.loadAsync.mockImplementation(async (_source, loader) => {
      expect(loader.options.geometryAwareAlpha).toBe(true);
      expect(loader.options.runtime).toMatchObject({
        frameRate: 30,
        physics: "none",
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
        diagnostics: {
          textures: [
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
            {
              level: "warning",
              code: "TEXTURE_RESOLVE_FAILED",
              materialIndex: 3,
              textureKind: "diffuse",
              path: "C:\\mmd\\private\\secret.png",
            },
          ],
        },
      });
    });

    const result = await loadPreviewObject(pmxFile, undefined, {
      onStage: (stage) => stages.push(stage),
      onWarning: (warning) => warnings.push(warning),
    });

    expect(mocks.loadAsync).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.any(Object),
      {
        outline: true,
        materialRenderOrder: true,
        morphSplit: true,
        frustumCulled: false,
      },
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
      cleanupCallbacks: [],
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
    });
    expect("mmdMetadata" in result).toBe(false);
    expect(collectMmdMetadata(result.object, pmxFile)).toMatchObject({
      kind: "mmd",
      asset: {
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
      "Missing MMD external asset: textures/missing.png. The model was loaded with a fallback or incomplete material.",
      "Unsupported MMD sphere texture: effects/unsupported.sph. The model was loaded without this sphere map.",
      "Missing MMD external asset: secret.png. The model was loaded with a fallback or incomplete material.",
    ]);
    expect(warnings).toEqual(result.warnings);
    expect(stages).toEqual(["scan", "decode", "scene"]);
    expect(mocks.physicsBackend.dispose).not.toHaveBeenCalled();
  });

  it("attaches parsed PMX material morphs to runtime mesh weights", async () => {
    const material = new MeshToonMaterial();
    const mesh = new Mesh(undefined, material);
    mesh.morphTargetInfluences = [0.5];
    const outlineMaterial = new MeshBasicMaterial();
    const outline = new Mesh(undefined, outlineMaterial);
    mocks.initCore.mockResolvedValue({
      loadModel: vi.fn(() => ({
        skeleton: () => ({ bones: [] }),
        materials: () => [
          {
            diffuse: [1, 1, 1, 1],
            specular: [0, 0, 0],
            specularPower: 1,
            ambient: [0, 0, 0],
            edgeColor: [0, 0, 0, 1],
            edgeSize: 1,
          },
        ],
        morphs: () => [
          {
            materialOffsets: [
              {
                materialIndex: -1,
                operation: "add",
                diffuse: [0, 0, 0, -1],
                specular: [0, 0, 0],
                specularPower: 0,
                ambient: [0, 0, 0],
                edgeColor: [0, 0, 0, -0.5],
                edgeSize: -0.5,
                textureFactor: [0, 0, 0, 0],
                sphereTextureFactor: [0, 0, 0, 0],
                toonTextureFactor: [0, 0, 0, 0],
              },
            ],
          },
        ],
      })),
    });
    mocks.loadAsync.mockResolvedValue({
      mesh,
      outlineMeshes: [outline],
      renderOrderMeshes: [],
      diagnostics: { textures: [] },
    });

    const result = await loadPreviewObject(pmxFile);

    expect(result.mmdModel?.syncMaterialMorphs).toBeTypeOf("function");
    expect(mocks.syncMmdMaterialStates).toHaveBeenCalledWith(
      material,
      expect.arrayContaining([
        expect.objectContaining({ diffuse: [1, 1, 1, 0.5], edgeSize: 0.75 }),
      ]),
    );
    expect(mocks.syncMmdOutlineMaterialStates).toHaveBeenCalledWith(
      outlineMaterial,
      expect.any(Array),
    );
  });

  it("reports a warning when parsed material morph sync cannot initialize", async () => {
    const mesh = new Mesh(undefined, new MeshToonMaterial());
    mesh.morphTargetInfluences = [0.5];
    mocks.initCore.mockResolvedValue({
      loadModel: vi.fn(createParsedMaterialMorphModel),
    });
    mocks.syncMmdMaterialStates.mockImplementationOnce(() => {
      throw new Error("material sync failed");
    });
    mocks.loadAsync.mockResolvedValue({
      mesh,
      outlineMeshes: [],
      renderOrderMeshes: [],
      diagnostics: { textures: [] },
    });

    const result = await loadPreviewObject(pmxFile);

    expect(result.warnings).toContain(
      "PMX material morphs were found, but runtime material synchronization could not be initialized.",
    );
    expect(result.mmdModel?.syncMaterialMorphs).toBeUndefined();
  });

  it("labels PMD previews by the opened source format", async () => {
    const mesh = new Group();

    mocks.loadAsync.mockResolvedValue({
      mesh,
      outlineMeshes: [],
      renderOrderMeshes: [],
      diagnostics: { textures: [] },
    });

    const result = await loadPreviewObject(pmdFile);

    expect(mesh.name).toBe("Legacy Model");
    expect(result.formatVersion).toBe("PMD 1");
  });

  it("keeps PMX root and mesh selection keys distinct", async () => {
    const root = new Group();
    const mesh = new Group();
    const morphSplitBody = new Mesh();
    morphSplitBody.userData.mmdMorphSplitBody = { materialIndex: 0 };
    mesh.userData.mmdMorphSplitBodyMeshes = [morphSplitBody];
    root.add(mesh, morphSplitBody);
    mocks.loadAsync.mockResolvedValue({
      root,
      mesh,
      outlineMeshes: [],
      renderOrderMeshes: [],
      diagnostics: { textures: [] },
    });

    const result = await loadPreviewObject(pmxFile);
    const rootKey = selectionKeyForObject(root);
    const meshKey = selectionKeyForObject(mesh);

    expect(root.name).toBe("Hatsune Miku");
    expect(mesh.name).toBe("Hatsune Miku");
    expect(rootKey).toBe("Hatsune Miku::mmd-root");
    expect(meshKey).toBe("Hatsune Miku::mmd-mesh");
    expect(selectionKeyForObject(morphSplitBody)).toBe(meshKey);
    expect(isInternalMmdProxyObject(morphSplitBody)).toBe(true);
    expect(findObjectBySelectionKey(result.object, meshKey!)).toBe(mesh);
  });

  it("customizes SDEF and QDEF selection materials without copying source shaders", async () => {
    const mesh = new Mesh();
    mesh.geometry.userData.mmdSdef = { vertexCount: 1 };
    const morphSplitBody = new Mesh();
    morphSplitBody.geometry.userData.mmdQdef = { vertexCount: 1 };
    mesh.userData.mmdMorphSplitBodyMeshes = [morphSplitBody];
    const outline = new Mesh();
    outline.geometry.userData.mmdSdef = { vertexCount: 1 };
    const renderOrder = new Mesh();
    renderOrder.geometry.userData.mmdQdef = { vertexCount: 1 };
    const regular = new Mesh();
    mocks.loadAsync.mockResolvedValue({
      mesh,
      outlineMeshes: [outline, regular],
      renderOrderMeshes: [renderOrder],
      diagnostics: { textures: [] },
    });

    await loadPreviewObject(pmxFile);
    const selectionMaterials = [mesh, morphSplitBody, outline, renderOrder].map(
      (candidate) => {
        const material = new MeshBasicMaterial();
        applySelectionMaterialCustomizer(candidate, material);
        return material;
      },
    );
    applySelectionMaterialCustomizer(regular, new MeshBasicMaterial());

    expect(mocks.attachMmdSdefSkinning).toHaveBeenCalledTimes(4);
    expect(
      mocks.attachMmdSdefSkinning.mock.calls.map(([material]) => material),
    ).toEqual(selectionMaterials);
    expect(
      (
        threeMmdLoader as typeof threeMmdLoader & {
          attachMmdSdefSkinning: unknown;
        }
      ).attachMmdSdefSkinning,
    ).toBe(mocks.attachMmdSdefSkinning);
  });

  it("suppresses PMX local axis attach failures from user warnings", async () => {
    const mesh = new Group();
    const warnings: string[] = [];
    mocks.initCore.mockRejectedValue(new Error("WASM instantiate failed"));
    mocks.loadAsync.mockResolvedValue({
      mesh,
      outlineMeshes: [],
      renderOrderMeshes: [],
      diagnostics: { textures: [] },
    });

    const result = await loadPreviewObject(pmxFile, undefined, {
      onWarning: (warning) => warnings.push(warning),
    });

    expect(result.warnings).toEqual([]);
    expect(warnings).toEqual([]);
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

  it("loads VMD as an animated standalone kuroko preview", async () => {
    const kurokoMesh = new Mesh(
      undefined,
      new MeshBasicMaterial({ color: 0x111111 }),
    );
    kurokoMesh.name = "yw_test_model";
    const kurokoRoot = new Group();
    kurokoRoot.add(kurokoMesh);
    mocks.loadAsync.mockResolvedValue({
      root: kurokoRoot,
      mesh: kurokoMesh,
      outlineMeshes: [],
      renderOrderMeshes: [],
      diagnostics: { textures: [] },
      runtime: {
        reset: mocks.runtimeReset,
        setAnimation: mocks.runtimeSetAnimation,
        tick: mocks.runtimeTick,
      },
    });
    const stages: string[] = [];
    const result = await loadPreviewObject(vmdFile, undefined, {
      onStage: (stage) => stages.push(stage),
    });

    expect(result.object).toBeInstanceOf(Group);
    expect(result.object.name).toBe("Hatsune Miku Motion Preview");
    expect(result.object.userData.motionPreviewRig).toBe(true);
    expect(result.object.userData.mmdMotionSourceFile).toBe(
      "C:\\mmd\\motion.vmd",
    );
    expect(result).toMatchObject({
      cleanupUrls: [],
      clips: [],
      formatVersion: "VMD",
      skipScaleNormalization: true,
      assetKind: "motion",
      mmdMotion: {
        duration: 2,
        label: "motion.vmd",
      },
    });
    expect(result.mmdModel?.mesh).toBe(kurokoMesh);
    expect(result.object.getObjectByName("yw_test_model")).toBe(kurokoMesh);
    expect(mocks.fetchKuroko).toHaveBeenCalledWith(
      expect.stringContaining("yw_test_model.pmx"),
      { signal: undefined },
    );
    expect(mocks.runtimeSetAnimation).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "vmd" }),
      kurokoMesh,
    );
    expect(mocks.runtimeTick).toHaveBeenCalledWith(0, {
      mesh: kurokoMesh,
      ik: true,
      physics: false,
    });
    expect("mmdMetadata" in result).toBe(false);
    expect(collectMmdMetadata(result.object, vmdFile)).toMatchObject({
      kind: "mmd",
      asset: {
        format: "vmd",
        version: null,
        encoding: "shift-jis",
        name: "Hatsune Miku",
        counts: {
          maxFrame: 60,
          boneTracks: 2,
          morphTracks: 1,
          boneKeyframes: 3,
          morphKeyframes: 2,
          cameraKeyframes: 1,
          lightKeyframes: 1,
        },
        sections: [
          { name: "bone", count: 3, offset: 54, byteLength: 333 },
          { name: "morph", count: 2, offset: 391, byteLength: 46 },
        ],
      },
    });
    expect(stages).toEqual(["scan", "decode", "scene"]);
  });

  it("rejects with AbortError before file read when the PMX signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      loadMmdPreviewObject(pmxFile, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.readBinaryFile).not.toHaveBeenCalled();
    expect(mocks.loadAsync).not.toHaveBeenCalled();
  });

  it("rejects with AbortError after file read and prevents PMX loadModel", async () => {
    const controller = new AbortController();
    mocks.readBinaryFile.mockImplementation(async () => {
      controller.abort();
      return new Uint8Array([0x50, 0x4d, 0x58, 0x20]).buffer;
    });

    await expect(
      loadMmdPreviewObject(pmxFile, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.loadAsync).not.toHaveBeenCalled();
  });

  it("rejects with AbortError after loadModel resolves and skips warnings and scene reporting", async () => {
    const mesh = new Group();
    mesh.userData.mmdModel = { diagnostics: [] };
    const controller = new AbortController();
    const stages: string[] = [];
    const warnings: string[] = [];

    mocks.loadAsync.mockImplementation(async () => {
      controller.abort();
      return {
        mesh,
        outlineMeshes: [],
        renderOrderMeshes: [],
        diagnostics: {
          textures: [
            {
              level: "warning",
              code: "TEXTURE_RESOLVE_FAILED",
              materialIndex: 0,
              textureKind: "diffuse",
              path: "textures/missing.png",
            },
          ],
        },
      };
    });

    await expect(
      loadMmdPreviewObject(pmxFile, {
        signal: controller.signal,
        onStage: (stage) => stages.push(stage),
        onWarning: (warning) => warnings.push(warning),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(stages).toEqual(["scan", "decode"]);
    expect(warnings).toEqual([]);
  });

  it("rejects with AbortError after file read and prevents VMD parsing and scene creation", async () => {
    const controller = new AbortController();
    const stages: string[] = [];
    vi.mocked(threeMmdLoader.parseVmd).mockClear();
    mocks.readBinaryFile.mockImplementation(async () => {
      controller.abort();
      return new Uint8Array([0x56, 0x4d, 0x44, 0x20]).buffer;
    });

    await expect(
      loadMmdMotionPreviewObject(vmdFile, {
        signal: controller.signal,
        onStage: (stage) => stages.push(stage),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(threeMmdLoader.parseVmd).not.toHaveBeenCalled();
    expect(stages).toEqual(["scan"]);
  });

  it("rejects with AbortError before file read when non-preview motion signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      loadMmdMotion(vmdFile, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.readBinaryFile).not.toHaveBeenCalled();
    expect(threeMmdLoader.parseVmd).not.toHaveBeenCalled();
  });

  it("rejects with AbortError after file read and prevents non-preview VMD parsing", async () => {
    const controller = new AbortController();
    vi.mocked(threeMmdLoader.parseVmd).mockClear();
    mocks.readBinaryFile.mockImplementation(async () => {
      controller.abort();
      return new Uint8Array([0x56, 0x4d, 0x44, 0x20]).buffer;
    });

    await expect(
      loadMmdMotion(vmdFile, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(threeMmdLoader.parseVmd).not.toHaveBeenCalled();
  });

  it("rejects with AbortError after parseVmd resolves and prevents returning non-preview motion", async () => {
    const controller = new AbortController();
    vi.mocked(threeMmdLoader.parseVmd).mockImplementation(() => {
      controller.abort();
      return {
        kind: "vmd",
        metadata: { maxFrame: 60, modelName: "Hatsune Miku" },
        boneTracks: { センター: {} },
        morphTracks: { smile: {} },
        cameraFrames: [{ frame: 45 }],
        lightFrames: [{ frame: 30 }],
        selfShadowFrames: [],
        propertyFrames: [],
      };
    });

    await expect(
      loadMmdMotion(vmdFile, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
