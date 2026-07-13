import {
  AnimationClip,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  SkinnedMesh,
  Texture,
} from "three";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  canUseStaticSceneResult,
  createWorkerFbxLoadingManager,
} from "../modelParse.worker";

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

    expect(canUseStaticSceneResult("fbx", root)).toBe(true);
  });
});

describe("worker FBX DOM-free LoadingManager", () => {
  it("registers image/DDS/TGA handlers that return fbxSourceName placeholders", () => {
    const manager = createWorkerFbxLoadingManager();

    const dds = manager.getHandler("Textures/normal.dds");
    const tga = manager.getHandler("Textures/mask.tga");
    const png = manager.getHandler("Textures/albedo.png");
    const jpg = manager.getHandler("foo/bar.JPG");

    expect(dds).toBeTruthy();
    expect(tga).toBeTruthy();
    expect(png).toBeTruthy();
    expect(jpg).toBeTruthy();

    const load = (handler: NonNullable<typeof dds>, url: string) =>
      (handler as unknown as { load: (u: string) => Texture }).load(url);

    const ddsTex = load(dds!, "Textures/normal.dds");
    const tgaTex = load(tga!, "Textures/mask.tga");
    const pngTex = load(png!, "Textures/albedo.png");

    expect(ddsTex.userData.fbxSourceName).toBe("Textures/normal.dds");
    expect(tgaTex.userData.fbxSourceName).toBe("Textures/mask.tga");
    expect(pngTex.userData.fbxSourceName).toBe("Textures/albedo.png");
    expect(pngTex.name).toBe("albedo.png");

    // Handlers must not create ImageData or touch DOM APIs.
    expect(ddsTex.image).toBeFalsy();
    expect(tgaTex.image).toBeFalsy();
  });
});
