import {
  AnimationClip,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  MirroredRepeatWrapping,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  ObjectLoader,
  RepeatWrapping,
  SRGBColorSpace,
  SkinnedMesh,
  Texture,
} from "three";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  canSerializeStaticNode,
  createStaticSceneObject,
  createStaticSceneObjectAsync,
  DEFAULT_STATIC_SCENE_BATCH_SIZE,
  hasAnimatedStaticSceneBlocker,
  toStaticScenePayload,
  type ModelParseWorkerStaticScenePayload,
} from "../staticScene";

class TestImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

beforeAll(() => {
  vi.stubGlobal("ImageData", TestImageData);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("ImageData", TestImageData);
});

function makeImageDataTexture(
  pixels: [number, number, number, number] = [255, 0, 0, 255],
) {
  const texture = new Texture(
    new ImageData(new Uint8ClampedArray(pixels), 1, 1),
  );
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = MirroredRepeatWrapping;
  texture.offset.set(0.25, 0.5);
  texture.repeat.set(2, 3);
  texture.center.set(0.5, 0.5);
  texture.rotation = 0.25;
  texture.needsUpdate = true;
  return texture;
}

function makeTexturedPbrMesh() {
  const material = new MeshStandardMaterial({
    map: makeImageDataTexture([255, 0, 0, 255]),
    normalMap: makeImageDataTexture([0, 0, 255, 255]),
    metalness: 0.5,
    roughness: 0.25,
  });
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
  mesh.name = "PbrMesh";
  return mesh;
}

describe("staticScene textured PBR roundtrip", () => {
  it("preserves map and a PBR auxiliary texture through staticScene transfer", () => {
    const source = makeTexturedPbrMesh();
    expect(
      canSerializeStaticNode(source, { requireSerializableTextures: true }),
    ).toBe(true);

    const payload = toStaticScenePayload(source, false, {
      requireSerializableTextures: true,
    });
    expect(payload).not.toBeNull();
    expect(payload?.meshes[0].material).toMatchObject({
      type: "MeshStandardMaterial",
      textures: {
        map: {
          width: 1,
          height: 1,
          data: new Uint8ClampedArray([255, 0, 0, 255]),
        },
        normalMap: {
          width: 1,
          height: 1,
          data: new Uint8ClampedArray([0, 0, 255, 255]),
        },
      },
    });

    const restored = createStaticSceneObject(payload!);
    const restoredMesh = restored as Mesh;
    const restoredMaterial = restoredMesh.material as MeshStandardMaterial;

    expect(restoredMaterial.map).toBeTruthy();
    expect(restoredMaterial.normalMap).toBeTruthy();
    expect(restoredMaterial.map?.image).toMatchObject({
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 0, 255]),
    });
    expect(restoredMaterial.map?.colorSpace).toBe(SRGBColorSpace);
    expect(restoredMaterial.map?.flipY).toBe(false);
    expect(restoredMaterial.map?.wrapS).toBe(RepeatWrapping);
    expect(restoredMaterial.map?.wrapT).toBe(MirroredRepeatWrapping);
    expect(restoredMaterial.map?.offset.toArray()).toEqual([0.25, 0.5]);
    expect(restoredMaterial.map?.repeat.toArray()).toEqual([2, 3]);
    expect(restoredMaterial.map?.center.toArray()).toEqual([0.5, 0.5]);
    expect(restoredMaterial.map?.rotation).toBe(0.25);
    expect(restoredMaterial.normalMap?.image).toMatchObject({
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 255, 255]),
    });
    expect(restoredMaterial.metalness).toBe(0.5);
    expect(restoredMaterial.roughness).toBe(0.25);
  });

  it("rejects glTF-style materials with unsupported texture slots", () => {
    const material = new MeshStandardMaterial({
      map: makeImageDataTexture(),
      alphaMap: makeImageDataTexture([0, 255, 0, 255]),
    });
    const mesh = new Mesh(new BoxGeometry(), material);

    expect(
      canSerializeStaticNode(mesh, { requireSerializableTextures: true }),
    ).toBe(false);
    expect(
      toStaticScenePayload(mesh, false, {
        requireSerializableTextures: true,
      }),
    ).toBeNull();
  });

  it("preserves deferred FBX texture placeholders with source and transform", () => {
    const map = new Texture();
    map.userData.fbxSourceName = "Textures/albedo.png";
    map.colorSpace = SRGBColorSpace;
    map.flipY = false;
    map.wrapS = RepeatWrapping;
    map.wrapT = MirroredRepeatWrapping;
    map.offset.set(0.1, 0.2);
    map.repeat.set(2, 4);
    map.center.set(0.5, 0.25);
    map.rotation = 0.5;

    const normalMap = new Texture();
    normalMap.userData.fbxSourceName = "Textures/normal.dds";
    normalMap.wrapS = RepeatWrapping;
    normalMap.wrapT = RepeatWrapping;
    normalMap.offset.set(0, 0);
    normalMap.repeat.set(1, -1);

    const material = new MeshStandardMaterial({ map, normalMap });
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
    mesh.name = "DeferredMesh";

    // Soft FBX mode: deferred placeholders are serializable without ImageData.
    expect(canSerializeStaticNode(mesh)).toBe(true);
    // Strict glTF mode: deferred (non-ImageData) must not pass.
    expect(
      canSerializeStaticNode(mesh, { requireSerializableTextures: true }),
    ).toBe(false);

    const payload = toStaticScenePayload(mesh, false);
    expect(payload).not.toBeNull();
    expect(payload?.meshes[0].material).toMatchObject({
      textures: {
        map: {
          kind: "deferred",
          fbxSourceName: "Textures/albedo.png",
          colorSpace: SRGBColorSpace,
          flipY: false,
          wrapS: RepeatWrapping,
          wrapT: MirroredRepeatWrapping,
          offset: [0.1, 0.2],
          repeat: [2, 4],
          center: [0.5, 0.25],
          rotation: 0.5,
        },
        normalMap: {
          kind: "deferred",
          fbxSourceName: "Textures/normal.dds",
          offset: [0, 0],
          repeat: [1, -1],
        },
      },
    });

    const restored = createStaticSceneObject(payload!) as Mesh;
    const restoredMaterial = restored.material as MeshStandardMaterial;
    expect(restoredMaterial.map?.userData.fbxSourceName).toBe(
      "Textures/albedo.png",
    );
    expect(restoredMaterial.map?.offset.toArray()).toEqual([0.1, 0.2]);
    expect(restoredMaterial.map?.repeat.toArray()).toEqual([2, 4]);
    expect(restoredMaterial.map?.center.toArray()).toEqual([0.5, 0.25]);
    expect(restoredMaterial.map?.rotation).toBe(0.5);
    expect(restoredMaterial.map?.wrapS).toBe(RepeatWrapping);
    expect(restoredMaterial.map?.wrapT).toBe(MirroredRepeatWrapping);
    expect(restoredMaterial.map?.colorSpace).toBe(SRGBColorSpace);
    expect(restoredMaterial.map?.flipY).toBe(false);
    expect(restoredMaterial.normalMap?.userData.fbxSourceName).toBe(
      "Textures/normal.dds",
    );
    expect(restoredMaterial.normalMap?.repeat.toArray()).toEqual([1, -1]);
  });

  it("omits blob/data deferred sources while keeping ImageData textures", () => {
    const map = makeImageDataTexture([1, 2, 3, 255]);
    const emissiveMap = new Texture();
    emissiveMap.userData.fbxSourceName = "blob:http://localhost/abc";
    const material = new MeshStandardMaterial({ map, emissiveMap });
    const mesh = new Mesh(new BoxGeometry(), material);

    // Soft mode: non-serializable deferred source fails the whole texture map
    // (same as non-ImageData without source) so we do not partially transfer.
    const payload = toStaticScenePayload(mesh, false);
    // map is ImageData but emissiveMap is non-serializable → textures omitted
    expect(
      (payload?.meshes[0].material as { textures?: unknown }).textures,
    ).toBeUndefined();
  });
});

describe("staticScene animated and skinned blockers", () => {
  it("blocks animated root scenes", () => {
    const root = new Group();
    root.animations = [
      new AnimationClip("Move", 1, [
        new NumberKeyframeTrack(".position[x]", [0, 1], [0, 1]),
      ]),
    ];
    root.add(makeTexturedPbrMesh());

    expect(hasAnimatedStaticSceneBlocker(root)).toBe(true);
  });

  it("blocks skinned meshes", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(9), 3),
    );
    const skinned = new SkinnedMesh(
      geometry,
      new MeshStandardMaterial({ map: makeImageDataTexture() }),
    );
    const root = new Group();
    root.add(skinned);

    expect(hasAnimatedStaticSceneBlocker(root)).toBe(true);
  });

  it("blocks morph-target meshes", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(9), 3),
    );
    geometry.morphAttributes.position = [
      new BufferAttribute(new Float32Array(9), 3),
    ];
    const mesh = new Mesh(
      geometry,
      new MeshStandardMaterial({ map: makeImageDataTexture() }),
    );
    const root = new Group();
    root.add(mesh);

    expect(hasAnimatedStaticSceneBlocker(root)).toBe(true);
  });
});

describe("staticScene existing static format behavior", () => {
  it("keeps untextured OBJ-style meshes serializable without strict textures", () => {
    const mesh = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ color: 0xc7d2e3 }),
    );
    const root = new Group();
    root.add(mesh);

    expect(canSerializeStaticNode(root)).toBe(true);
    expect(toStaticScenePayload(root, true)).not.toBeNull();
    expect(
      createStaticSceneObject(toStaticScenePayload(root, true)!),
    ).toBeTruthy();
  });

  it("keeps single-mesh PLY/STL-style roots serializable", () => {
    const mesh = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ color: 0xd7dde8 }),
    );

    expect(canSerializeStaticNode(mesh)).toBe(true);
    const payload = toStaticScenePayload(mesh, false);
    expect(payload?.rootKind).toBe("mesh");
    expect(payload?.meshes).toHaveLength(1);
  });
});

function makeNestedInstancedScene(includeOrdinaryMesh: boolean) {
  const root = new Group();
  const container = new Group();
  const instances = new InstancedMesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ color: 0xffffff }),
    3,
  );
  container.add(instances);
  if (includeOrdinaryMesh) {
    root.add(
      new Mesh(
        new BoxGeometry(1, 1, 1),
        new MeshStandardMaterial({ color: 0xc7d2e3 }),
      ),
    );
  }
  root.add(container);
  return root;
}

function makeInstancedJsonScene() {
  const root = new Group();
  root.position.set(5, -3, 2);

  root.add(
    new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ color: 0xc7d2e3 }),
    ),
  );

  const container = new Group();
  container.name = "InstanceContainer";
  container.position.set(1, 1, 1);
  const instances = new InstancedMesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ color: 0xffffff }),
    3,
  );
  instances.name = "Instances";
  instances.position.set(0, 2, 0);
  const matrices = [
    new Matrix4().makeTranslation(0, 0, 0),
    new Matrix4().makeTranslation(2, 1, 0),
    new Matrix4().makeTranslation(-1, 0, 3),
  ];
  const colors = [0xff0000, 0x00ff00, 0x0000ff];
  matrices.forEach((matrix, index) => {
    instances.setMatrixAt(index, matrix);
    instances.setColorAt(index, new Color(colors[index]));
  });
  instances.instanceMatrix.needsUpdate = true;
  instances.instanceColor!.needsUpdate = true;
  container.add(instances);
  root.add(container);
  root.updateMatrixWorld(true);
  instances.computeBoundingBox();

  return { root, instances };
}

describe("staticScene instancing fallback boundary", () => {
  it("rejects nested and mixed InstancedMesh trees in both payload modes", () => {
    for (const root of [
      makeNestedInstancedScene(false),
      makeNestedInstancedScene(true),
    ]) {
      expect(canSerializeStaticNode(root)).toBe(false);
      expect(toStaticScenePayload(root, false)).toBeNull();
      expect(toStaticScenePayload(root, true)).toBeNull();
    }
  });

  it("preserves instance count, matrices, colors, and world bounds in Object JSON fallback", () => {
    const { root, instances } = makeInstancedJsonScene();
    const sceneJson = root.toJSON();
    const restored = new ObjectLoader().parse(sceneJson);
    const restoredInstances = restored.getObjectByName("Instances");

    expect(restoredInstances).toBeInstanceOf(InstancedMesh);
    if (!(restoredInstances instanceof InstancedMesh)) {
      throw new Error("Object JSON fallback did not restore InstancedMesh");
    }

    expect(restoredInstances.count).toBe(instances.count);
    const sourceMatrix = new Matrix4();
    const restoredMatrix = new Matrix4();
    for (let index = 0; index < instances.count; index += 1) {
      instances.getMatrixAt(index, sourceMatrix);
      restoredInstances.getMatrixAt(index, restoredMatrix);
      expect(restoredMatrix.elements).toEqual(sourceMatrix.elements);
    }

    expect(restoredInstances.instanceColor).not.toBeNull();
    expect(Array.from(restoredInstances.instanceColor!.array)).toEqual(
      Array.from(instances.instanceColor!.array),
    );

    restored.updateMatrixWorld(true);
    restoredInstances.computeBoundingBox();
    const sourceWorldBounds = new Box3()
      .copy(instances.boundingBox!)
      .applyMatrix4(instances.matrixWorld);
    const restoredWorldBounds = new Box3()
      .copy(restoredInstances.boundingBox!)
      .applyMatrix4(restoredInstances.matrixWorld);
    expect(restoredWorldBounds.min.toArray()).toEqual(
      sourceWorldBounds.min.toArray(),
    );
    expect(restoredWorldBounds.max.toArray()).toEqual(
      sourceWorldBounds.max.toArray(),
    );
  });
});

function makeFlatMeshPayload(
  name: string,
  color: number,
): ModelParseWorkerStaticScenePayload["meshes"][number] {
  const mesh = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ color }),
  );
  mesh.name = name;
  mesh.position.set(color & 0xff, 0, 0);
  mesh.updateMatrixWorld(true);
  const payload = toStaticScenePayload(mesh, false);
  if (!payload) {
    throw new Error("failed to build flat mesh payload");
  }
  return payload.meshes[0];
}

describe("staticScene cooperative flat reconstruction", () => {
  it("exposes a conservative default batch size", () => {
    expect(DEFAULT_STATIC_SCENE_BATCH_SIZE).toBe(16);
  });

  it("matches sync reconstruction content and mesh order", async () => {
    const payload: ModelParseWorkerStaticScenePayload = {
      rootKind: "group",
      rootName: "FlatRoot",
      rootUserData: { format: "fbx" },
      meshes: [
        makeFlatMeshPayload("A", 0xff0000),
        makeFlatMeshPayload("B", 0x00ff00),
        makeFlatMeshPayload("C", 0x0000ff),
      ],
    };

    const sync = createStaticSceneObject(payload) as Group;
    const asyncResult = (await createStaticSceneObjectAsync(payload, {
      batchSize: 1,
      yieldFn: async () => undefined,
    })) as Group;

    expect(asyncResult.name).toBe(sync.name);
    expect(asyncResult.userData).toEqual(sync.userData);
    expect(asyncResult.children.map((child) => child.name)).toEqual(
      sync.children.map((child) => child.name),
    );
    expect(asyncResult.children).toHaveLength(3);
    for (let i = 0; i < 3; i += 1) {
      const syncMesh = sync.children[i] as Mesh;
      const asyncMesh = asyncResult.children[i] as Mesh;
      expect(asyncMesh.position.toArray()).toEqual(syncMesh.position.toArray());
      expect((asyncMesh.material as MeshStandardMaterial).color.getHex()).toBe(
        (syncMesh.material as MeshStandardMaterial).color.getHex(),
      );
    }
  });

  it("yields between batches for large flat payloads", async () => {
    const meshCount = 5;
    const payload: ModelParseWorkerStaticScenePayload = {
      rootKind: "group",
      rootName: "Many",
      rootUserData: {},
      meshes: Array.from({ length: meshCount }, (_, i) =>
        makeFlatMeshPayload(`M${i}`, 0x101010 + i),
      ),
    };

    let yieldCount = 0;
    const restored = (await createStaticSceneObjectAsync(payload, {
      batchSize: 2,
      yieldFn: async () => {
        yieldCount += 1;
      },
    })) as Group;

    // Yields before mesh index 2 and 4 (not before 0).
    expect(yieldCount).toBe(2);
    expect(restored.children.map((child) => child.name)).toEqual([
      "M0",
      "M1",
      "M2",
      "M3",
      "M4",
    ]);
  });

  it("returns a single mesh root without wrapping in a group", async () => {
    const payload: ModelParseWorkerStaticScenePayload = {
      rootKind: "mesh",
      rootName: "Solo",
      rootUserData: { alone: true },
      meshes: [makeFlatMeshPayload("Solo", 0xc7d2e3)],
    };

    const restored = await createStaticSceneObjectAsync(payload, {
      yieldFn: async () => undefined,
    });

    expect(restored).toBeInstanceOf(Mesh);
    expect(restored.name).toBe("Solo");
  });

  it("rejects with AbortError when aborted between batches", async () => {
    const payload: ModelParseWorkerStaticScenePayload = {
      rootKind: "group",
      rootName: "AbortMe",
      rootUserData: {},
      meshes: Array.from({ length: 4 }, (_, i) =>
        makeFlatMeshPayload(`M${i}`, 0x202020 + i),
      ),
    };

    const controller = new AbortController();
    let yields = 0;

    const promise = createStaticSceneObjectAsync(payload, {
      batchSize: 1,
      signal: controller.signal,
      yieldFn: async () => {
        yields += 1;
        if (yields === 1) {
          controller.abort();
        }
      },
    });

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(yields).toBe(1);
  });

  it("keeps the synchronous API available for callers that need it", () => {
    const payload: ModelParseWorkerStaticScenePayload = {
      rootKind: "group",
      rootName: "Sync",
      rootUserData: {},
      meshes: [makeFlatMeshPayload("One", 0xffffff)],
    };
    const restored = createStaticSceneObject(payload) as Group;
    expect(restored.children).toHaveLength(1);
    expect(restored.children[0].name).toBe("One");
  });
});
