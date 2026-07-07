import {
  AnimationClip,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  MirroredRepeatWrapping,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  RepeatWrapping,
  SRGBColorSpace,
  SkinnedMesh,
  Texture,
} from "three";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  canSerializeStaticNode,
  createStaticSceneObject,
  hasAnimatedStaticSceneBlocker,
  toStaticScenePayload,
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
