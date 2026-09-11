import {
  AnimationClip,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  SkinnedMesh,
  Texture,
} from "three";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { canUseStaticSceneResult } from "../modelParse.worker";
import {
  createStaticSceneObjectAsync,
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

function makeImageDataTexture() {
  const texture = new Texture(
    new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1),
  );
  texture.needsUpdate = true;
  return texture;
}

function makeStaticGlbScene() {
  const root = new Group();
  root.add(
    new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({
        map: makeImageDataTexture(),
        roughnessMap: makeImageDataTexture(),
      }),
    ),
  );
  return root;
}

function makeStaticExternalTextureScene() {
  const root = new Group();
  root.add(
    new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({
        map: new Texture(document.createElement("img")),
      }),
    ),
  );
  return root;
}

describe("model parse worker static scene policy", () => {
  it("enables staticScene for textured static GLB scenes", () => {
    expect(canUseStaticSceneResult("glb", makeStaticGlbScene())).toBe(true);
    expect(canUseStaticSceneResult("gltf", makeStaticGlbScene())).toBe(true);
  });

  it("routes InstancedMesh scenes through Object JSON for GLB, glTF, and FBX", () => {
    const root = new Group();
    root.add(
      new InstancedMesh(
        new BoxGeometry(1, 1, 1),
        new MeshStandardMaterial({ color: 0xffffff }),
        3,
      ),
    );

    for (const kind of ["glb", "gltf", "fbxGlb"] as const) {
      expect(canUseStaticSceneResult(kind, root)).toBe(false);
    }
  });

  it("rejects residual non-serializable texture payloads for GLB and glTF scenes", () => {
    const root = makeStaticExternalTextureScene();

    expect(canUseStaticSceneResult("glb", root)).toBe(false);
    expect(canUseStaticSceneResult("gltf", root)).toBe(false);
  });

  it("rejects animated GLB/glTF scenes", () => {
    const root = makeStaticGlbScene();
    root.animations = [
      new AnimationClip("Spin", 1, [
        new NumberKeyframeTrack(".rotation[x]", [0, 1], [0, 1]),
      ]),
    ];

    expect(canUseStaticSceneResult("glb", root)).toBe(false);
    expect(canUseStaticSceneResult("gltf", root)).toBe(false);
  });

  it("rejects skinned GLB/glTF scenes", () => {
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

    expect(canUseStaticSceneResult("glb", root)).toBe(false);
    expect(canUseStaticSceneResult("gltf", root)).toBe(false);
  });

  it("keeps existing OBJ and PLY static scene eligibility", () => {
    const objRoot = new Group();
    objRoot.add(
      new Mesh(
        new BoxGeometry(1, 1, 1),
        new MeshStandardMaterial({ color: 0xc7d2e3 }),
      ),
    );
    const plyMesh = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ color: 0xd7dde8 }),
    );

    expect(canUseStaticSceneResult("obj", objRoot)).toBe(true);
    expect(canUseStaticSceneResult("ply", plyMesh)).toBe(true);
    expect(canUseStaticSceneResult("stl", plyMesh)).toBe(true);
    expect(canUseStaticSceneResult("dae", objRoot)).toBe(true);
  });

  it("enables staticScene for FBX meshes with deferred texture placeholders", () => {
    const map = new Texture();
    map.userData.fbxSourceName = "Textures/wall.png";
    const root = new Group();
    root.add(
      new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ map })),
    );

    expect(canUseStaticSceneResult("fbxGlb", root)).toBe(true);
  });

  it("preserves native fbxGlb deferred identity together with the visible placeholder", async () => {
    const map = makeImageDataTexture();
    map.userData.fbxSourceName = "Parts01.png";
    map.userData.fbxDeferred = true;
    const root = new Group();
    root.add(
      new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ map })),
    );

    expect(canUseStaticSceneResult("fbxGlb", root)).toBe(true);
    const payload = toStaticScenePayload(root, false);
    expect(payload).toBeTruthy();
    const rebuilt = await createStaticSceneObjectAsync(payload!);
    const mesh = rebuilt.children[0] as Mesh;
    const rebuiltMap = (mesh.material as MeshStandardMaterial).map;
    expect(rebuiltMap?.userData.fbxSourceName).toBe("Parts01.png");
    expect(rebuiltMap?.userData.fbxDeferred).toBe(true);
    expect(rebuiltMap?.image).toEqual(map.image);
  });
});
