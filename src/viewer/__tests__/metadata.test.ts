/**
 * Regression tests for src/viewer/metadata.ts.
 *
 * Background: ColladaLoader can leave Object3D.name as `null` (rather than
 * the empty string) when the source document has no name attribute. The
 * earlier `object.name.trim()` call threw a TypeError on such inputs and the
 * load failure was masked by the AssetViewport overlay logic, so the user
 * saw a stuck "Loading" state instead of an error message.
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import {
  AnimationClip,
  BufferGeometry,
  Bone,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  InterpolateDiscrete,
  InterpolateLinear,
  InterpolateSmooth,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  PerspectiveCamera,
  PointLight,
  QuaternionKeyframeTrack,
  SkinnedMesh,
  Skeleton,
  Texture,
  VectorKeyframeTrack,
} from "three";
import {
  buildAnimationClipMetadata,
  collectAssetMetadata,
  refreshTextureSourceKinds,
  scheduleTextureThumbnailEnrichment,
} from "../metadata";
import {
  applyDisplayMode,
  collectSceneTraversal,
  normalizeObjectScale,
  applySurfaceMaterialMode,
} from "../scene";
import type { SelectedFile } from "../../lib/files";

const fakeFile: SelectedFile = {
  path: "/tmp/fake.dae",
  fileName: "fake.dae",
  extension: "dae",
  kind: "model",
  parentDirectory: "/tmp",
};

it("separates USDZ members and channels while retaining resource locators", () => {
  const root = new Group();
  const sources = [
    String.raw`\\?\F:\toy.usdz[a/same.png]`,
    String.raw`\\?\F:\toy.usdz[b/same.png]`,
  ];
  for (const source of sources) {
    const texture = new Texture();
    texture.name = source;
    const material = new MeshBasicMaterial({ map: texture, alphaMap: texture });
    root.add(new Mesh(new BufferGeometry(), material));
  }
  const file = { ...fakeFile, extension: "usdz" };
  const result = collectAssetMetadata(root, file, [], null);
  expect(result.metadata.textures).toHaveLength(4);
  for (const entry of result.metadata.textures) {
    expect(entry.label).toBe("same.png");
    expect(entry.sourceKind).toBe("embedded");
    expect(entry.containerPath).toBe(String.raw`\\?\F:\toy.usdz`);
    expect(sources).toContain(entry.sourcePath);
    expect(["a/same.png", "b/same.png"]).toContain(entry.internalPath);
  }
  expect(
    refreshTextureSourceKinds(result.metadata, file, result.textureRegistry),
  ).toBe(result.metadata);
});

it.each([
  ["usd", "external"],
  ["glb", "embedded"],
])("preserves %s texture source semantics", (extension, sourceKind) => {
  const texture = new Texture();
  texture.name = "textures/albedo.png";
  const root = new Mesh(
    new BufferGeometry(),
    new MeshBasicMaterial({ map: texture }),
  );
  const entry = collectAssetMetadata(root, { ...fakeFile, extension }, [], null)
    .metadata.textures[0];
  expect(entry).toMatchObject({
    label: "albedo.png",
    sourcePath: "textures/albedo.png",
    sourceKind,
  });
  expect(entry.containerPath).toBeUndefined();
});

it("counts usable vertex color meshes from geometry rather than material flags", () => {
  const root = new Group();
  const colored = new Mesh(
    new BufferGeometry(),
    new MeshBasicMaterial({ vertexColors: false }),
  );
  colored.geometry.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  colored.geometry.setAttribute(
    "color",
    new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3),
  );
  root.add(
    colored,
    new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({ vertexColors: true }),
    ),
  );
  expect(
    collectAssetMetadata(root, fakeFile, [], null).metadata
      .vertexColorMeshCount,
  ).toBe(1);
  colored.geometry.deleteAttribute("color");
  expect(
    collectAssetMetadata(root, fakeFile, [], null).metadata
      .vertexColorMeshCount,
  ).toBe(0);
});

it("keeps authored material and texture metadata while vertex colors are active", () => {
  const texture = new Texture();
  texture.name = "Authored texture";
  const material = new MeshBasicMaterial({ map: texture, color: 0x123456 });
  material.name = "Authored material";
  const mesh = new Mesh(new BufferGeometry(), material);
  mesh.name = "Mesh";
  const root = new Group().add(mesh);
  const before = collectAssetMetadata(root, fakeFile, [], null);
  applySurfaceMaterialMode(root, "vertexColors");
  const after = collectAssetMetadata(root, fakeFile, [], null);
  expect(after.metadata.materials).toEqual(before.metadata.materials);
  expect(after.metadata.objectInfo).toEqual(before.metadata.objectInfo);
  expect(after.metadata.textures).toEqual(before.metadata.textures);
  expect([...after.textureRegistry.values()]).toEqual([texture]);
});

const fakeMmdFile: SelectedFile = {
  path: "/tmp/miku.pmx",
  fileName: "miku.pmx",
  extension: "pmx",
  kind: "model",
  parentDirectory: "/tmp",
};

function createTexturedMeshRoot() {
  const image = document.createElement("img");
  const texture = new Texture(image);
  texture.name = "diffuse.png";
  const material = new MeshBasicMaterial({ map: texture });
  const mesh = new Mesh(new BufferGeometry(), material);
  mesh.name = "TexturedMesh";
  const root = new Group();
  root.add(mesh);
  return { root, texture };
}

function createManualTaskScheduler() {
  const callbacks: Array<() => void> = [];
  return {
    scheduleTask: (callback: () => void) => {
      callbacks.push(callback);
      return () => {
        const index = callbacks.indexOf(callback);
        if (index >= 0) {
          callbacks.splice(index, 1);
        }
      };
    },
    runNext: () => {
      callbacks.shift()?.();
    },
    get pendingCount() {
      return callbacks.length;
    },
  };
}

function mockCanvasThumbnail(thumbnailUrl = "data:image/jpeg;base64,thumb") {
  const drawImageMock = vi.fn();
  const createImageDataMock = vi.fn((width: number, height: number) => ({
    data: new Uint8ClampedArray(width * height * 4),
  }));
  const putImageDataMock = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        createImageData: createImageDataMock,
        drawImage: drawImageMock,
        putImageData: putImageDataMock,
      }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    thumbnailUrl,
  );
  return drawImageMock;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("collectAssetMetadata", () => {
  it("reuses one scene traversal for load-time scale, display, and metadata work", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.name = "Triangle";
    const root = new Group();
    root.add(mesh);
    const traverseSpy = vi.spyOn(root, "traverse");

    const traversal = collectSceneTraversal(root);
    normalizeObjectScale(root, traversal);
    applyDisplayMode(root, "texturedWireframe", traversal);
    const result = collectAssetMetadata(
      root,
      fakeFile,
      [],
      null,
      undefined,
      traversal,
    );

    expect(traverseSpy).toHaveBeenCalledTimes(1);
    expect(result.metadata.meshCount).toBe(1);
    expect(result.metadata.objectInfo.Triangle).toBeDefined();
    expect(
      result.metadata.objectInfo.__yw_textured_wireframe_overlay,
    ).toBeUndefined();
  });

  it("does not throw when an Object3D has a null name (Collada parity)", () => {
    const root = new Group();
    // Simulate ColladaLoader assigning null instead of "" — this is what
    // actually broke the DAE preview pipeline in the wild.
    (root as unknown as { name: unknown }).name = null;

    const mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    mesh.name = "tetra";
    root.add(mesh);

    expect(() => collectAssetMetadata(root, fakeFile, [], null)).not.toThrow();
  });

  it("preserves an unnamed Group root for non-USD assets (DAE/OBJ unnamed groups stay visible)", () => {
    // The synthetic-wrapper predicate is intentionally narrow: an
    // unnamed Group is only collapsed when it sits next to a `__upAxis`
    // child (the unique marker of yw-look's USD→GLB pipeline). DAE and
    // OBJ loaders frequently produce legitimate unnamed Groups that
    // must remain in the tree.
    const root = new Group();
    (root as unknown as { name: unknown }).name = null;

    const result = collectAssetMetadata(root, fakeFile, [], null);
    expect(result.metadata.hierarchy[0]?.name).toBe("");
  });

  it("inlines an unnamed Group wrapper's children when it parents __upAxis (USD pipeline marker)", () => {
    // The combination "unnamed Group with a __upAxis child" is a
    // pipeline-internal wrapper from #46 and should be elided so the
    // user-facing hierarchy starts at the actual USD stage root.
    const root = new Group();
    (root as unknown as { name: unknown }).name = null;
    const upAxis = new Group();
    upAxis.name = "__upAxis";
    const stageRoot = new Group();
    stageRoot.name = "Kitchen_set";
    upAxis.add(stageRoot);
    root.add(upAxis);

    const result = collectAssetMetadata(root, fakeFile, [], null);
    expect(result.metadata.hierarchy.map((n) => n.name)).toEqual([
      "Kitchen_set",
    ]);
  });

  it("hides the __upAxis synthetic node from the user-facing hierarchy", () => {
    // #46 inserts a single `__upAxis` node carrying the Z→Y rotation
    // matrix; it is a plumbing detail and should never surface in the UI.
    const root = new Group();
    root.name = "scene";
    const upAxis = new Group();
    upAxis.name = "__upAxis";
    const stageRoot = new Group();
    stageRoot.name = "Kitchen_set";
    upAxis.add(stageRoot);
    root.add(upAxis);

    const result = collectAssetMetadata(root, fakeFile, [], null);
    // The named outer "scene" Group IS surfaced (it has a name); the
    // __upAxis wrapper is inlined so Kitchen_set becomes a direct child.
    expect(result.metadata.hierarchy[0]?.name).toBe("scene");
    expect(result.metadata.hierarchy[0]?.children.map((c) => c.name)).toEqual([
      "Kitchen_set",
    ]);
  });

  it("preserves real names when present", () => {
    const root = new Group();
    root.name = "MyRoot";
    const result = collectAssetMetadata(root, fakeFile, [], null);
    expect(result.metadata.hierarchy[0]?.name).toBe("MyRoot");
  });

  it("derives display label from primPath basename to bypass GLTFLoader name suffixing", () => {
    // Three.js GLTFLoader appends `_1`, `_2` ... when glTF node names
    // collide globally (Kitchen_set has many sibling `Geom` xforms).
    // For USD-sourced nodes we surface the SdfPath basename instead so
    // the UI matches what usdview shows.
    const root = new Group();
    root.name = "scene";
    const colliding = new Group();
    colliding.name = "Geom_1";
    colliding.userData.primPath = "/Kitchen_set/Props_grp/Ceiling_grp/Geom";
    root.add(colliding);

    const result = collectAssetMetadata(root, fakeFile, [], null);
    expect(result.metadata.hierarchy[0]?.children[0]?.name).toBe("Geom");
    expect(result.metadata.hierarchy[0]?.children[0]?.primPath).toBe(
      "/Kitchen_set/Props_grp/Ceiling_grp/Geom",
    );
  });

  it("enumerates Three.js Light children as USD light entries (#35)", () => {
    const root = new Group();
    const sun = new DirectionalLight(0xfff5cc, 2.5);
    sun.name = "Sun";
    const fill = new PointLight(0x88aaff, 1.25);
    fill.name = "Fill";
    root.add(sun);
    root.add(fill);

    const result = collectAssetMetadata(root, fakeFile, [], null);

    expect(result.metadata.lights).toHaveLength(2);
    const [sunEntry, fillEntry] = result.metadata.lights;
    expect(sunEntry.name).toBe("Sun");
    expect(sunEntry.type).toBe("DirectionalLight");
    expect(sunEntry.intensity).toBe(2.5);
    expect(sunEntry.color).toBe("#fff5cc");
    expect(fillEntry.type).toBe("PointLight");

    // Lights must not be miscounted as meshes in nodeCount-derived budgets.
    expect(result.metadata.meshCount).toBe(0);
  });

  it("tolerates null name on light / camera (Collada parity)", () => {
    const root = new Group();
    const light = new DirectionalLight(0xffffff, 1);
    (light as unknown as { name: unknown }).name = null;
    const cam = new PerspectiveCamera();
    (cam as unknown as { name: unknown }).name = null;
    root.add(light);
    root.add(cam);

    expect(() => collectAssetMetadata(root, fakeFile, [], null)).not.toThrow();

    const result = collectAssetMetadata(root, fakeFile, [], null);
    expect(result.metadata.lights[0]?.name).toBe("DirectionalLight");
    expect(result.metadata.cameras[0]?.name).toBe("PerspectiveCamera");
  });

  it("enumerates camera children with projection metadata (#34)", () => {
    const root = new Group();
    const cam = new PerspectiveCamera(40, 1.5, 0.01, 5000);
    cam.name = "Hero";
    root.add(cam);

    const result = collectAssetMetadata(root, fakeFile, [], null);

    expect(result.metadata.cameras).toHaveLength(1);
    const [camEntry] = result.metadata.cameras;
    expect(camEntry.name).toBe("Hero");
    expect(camEntry.projection).toBe("perspective");
    expect(camEntry.fov).toBe(40);
    expect(camEntry.aspect).toBe(1.5);
    expect(camEntry.near).toBe(0.01);
    expect(camEntry.far).toBe(5000);
  });

  it("records mesh bindings on each material entry (#36)", () => {
    const root = new Group();
    const sharedMat = new MeshBasicMaterial();
    sharedMat.name = "Body";
    const trim = new MeshBasicMaterial();
    trim.name = "Trim";

    const torso = new Mesh(new BufferGeometry(), sharedMat);
    torso.name = "Torso";
    const arm = new Mesh(new BufferGeometry(), sharedMat);
    arm.name = "Arm";
    const collar = new Mesh(new BufferGeometry(), trim);
    collar.name = "Collar";
    root.add(torso);
    root.add(arm);
    root.add(collar);

    const result = collectAssetMetadata(root, fakeFile, [], null);

    const body = result.metadata.materials.find((m) => m.name === "Body");
    const trimEntry = result.metadata.materials.find((m) => m.name === "Trim");
    expect(body?.boundMeshes).toEqual(["Torso", "Arm"]);
    expect(trimEntry?.boundMeshes).toEqual(["Collar"]);
  });

  it("prefers MMD Japanese material names and records MMD parameters", () => {
    const root = new Group();
    const material = new MeshBasicMaterial();
    const texture = new Texture();
    texture.name = "Base Color Texture";
    material.map = texture;
    material.name = "Body_EN";
    material.userData.mmdMaterial = {
      materialIndex: 2,
      name: "体",
      englishName: "Body_EN",
      diffuse: [0.8, 0.7, 0.6, 0.5],
      specular: [0.2, 0.25, 0.3],
      ambient: [0.1, 0.12, 0.14],
      specularPower: 12.5,
      edgeColor: [0, 0, 0, 1],
      edgeSize: 0.75,
      texturePath: "textures/body.png",
      sphereTexturePath: "textures/body.spa",
      sphereMode: "add",
      toonTexturePath: "toon/toon01.bmp",
      sharedToonIndex: 1,
      transparencyMode: "blend",
      renderOrderBucket: "transparent",
      faceCount: 1200,
      flags: { doubleSided: true, castShadow: false },
      unsupportedDrawFlags: ["pointDraw"],
    };
    const mesh = new Mesh(new BufferGeometry(), material);
    mesh.name = "Miku";
    root.add(mesh);

    const result = collectAssetMetadata(root, fakeMmdFile, [], null);

    expect(result.metadata.materials[0]?.name).toBe("体");
    expect(result.metadata.objectInfo.Miku?.materialNames).toEqual(["体"]);
    expect(result.metadata.materials[0]?.mmd).toMatchObject({
      materialIndex: 2,
      name: "体",
      englishName: "Body_EN",
      diffuse: [0.8, 0.7, 0.6, 0.5],
      texturePath: "textures/body.png",
      sphereMode: "add",
      unsupportedDrawFlags: ["pointDraw"],
    });
    expect(result.metadata.textures[0]?.label).toBe("body.png");
  });

  it("deduplicates separate MMD texture instances that reference the same file", () => {
    const root = new Group();
    for (const materialName of ["Face", "Body"]) {
      const texture = new Texture();
      texture.name = "Base Color Texture";
      const material = new MeshBasicMaterial({ map: texture });
      material.name = materialName;
      material.userData.mmdMaterial = {
        name: materialName,
        texturePath: "textures/shared.tga",
      };
      root.add(new Mesh(new BufferGeometry(), material));
    }

    const result = collectAssetMetadata(root, fakeMmdFile, [], null);

    expect(result.metadata.textures).toHaveLength(1);
    expect(result.metadata.textures[0]?.label).toBe("shared.tga");
    expect(result.textureRegistry.size).toBe(1);
  });

  it("records MMD bone parameters for selected bone inspection", () => {
    const root = new Group();
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
    mesh.name = "Miku";

    const center = new Bone();
    center.name = "Center_EN";
    center.userData.mmdBoneName = "センター";
    center.userData.mmdEnglishBoneName = "Center_EN";
    center.userData.mmdRestPosition = [0, 10, 0];
    center.userData.mmdLayer = 0;

    const arm = new Bone();
    arm.name = "Arm_EN";
    arm.userData.mmdBoneName = "腕";
    arm.userData.mmdEnglishBoneName = "Arm_EN";
    arm.userData.mmdRestPosition = [1, 12, 0];
    arm.userData.mmdLayer = 1;
    arm.userData.mmdAppendTransform = { parentIndex: 0, weight: 0.5 };
    arm.userData.mmdFlags = {
      appendRotate: true,
      appendTranslate: false,
      transformAfterPhysics: true,
    };

    center.add(arm);
    mesh.add(center);
    mesh.bind(new Skeleton([center, arm]));
    mesh.userData.mmdIkChains = [
      {
        goalBoneIndex: 1,
        effectorBoneIndex: 0,
        iterationCount: 8,
        maxAnglePerIteration: 0.25,
        links: [{ boneIndex: 1, limitsKind: "pmxLinkLimit" }],
      },
    ];
    root.add(mesh);

    const result = collectAssetMetadata(root, fakeMmdFile, [], null);

    expect(JSON.stringify(result.metadata.hierarchy)).toContain(
      '"displayName":"腕"',
    );
    expect(result.metadata.objectInfo.Arm_EN?.mmdBone).toMatchObject({
      boneIndex: 1,
      parentIndex: 0,
      parentName: "センター",
      name: "腕",
      englishName: "Arm_EN",
      restPosition: [1, 12, 0],
      layer: 1,
      appendTransform: {
        parentIndex: 0,
        parentName: "センター",
        weight: 0.5,
      },
      flags: {
        appendRotate: true,
        appendTranslate: false,
        transformAfterPhysics: true,
      },
      ik: {
        roles: ["goal", "link"],
        goalBoneIndex: 1,
        effectorBoneIndex: 0,
        iterationCount: 8,
        maxAnglePerIteration: 0.25,
        linkCount: 1,
        limitKinds: ["pmxLinkLimit"],
      },
    });
  });

  it("prefers MMD Japanese morph names and records morph metadata", () => {
    const root = new Group();
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.name = "Face";
    mesh.morphTargetInfluences = [0.4];
    mesh.morphTargetDictionary = { Smile_EN: 0 };
    mesh.userData.mmdMorphs = [
      {
        name: "笑い",
        englishName: "Smile_EN",
        type: "group",
        boneOffsets: [{ boneIndex: 0 }],
        groupOffsets: [{ morphIndex: 0 }],
        flipOffsets: [{ morphIndex: 0 }],
        impulseOffsets: [{ rigidBodyIndex: 0 }],
      },
    ];
    root.add(mesh);

    const result = collectAssetMetadata(root, fakeMmdFile, [], null);

    expect(result.metadata.objectInfo.Face?.morphTargets).toEqual([
      {
        index: 0,
        name: "笑い",
        value: 0.4,
        mmd: {
          name: "笑い",
          englishName: "Smile_EN",
          type: "group",
          boneOffsetCount: 1,
          groupOffsetCount: 1,
          flipOffsetCount: 1,
          impulseOffsetCount: 1,
        },
      },
    ]);
  });

  it("excludes MMD outline and render-order proxy meshes from metadata", () => {
    const root = new Group();
    root.name = "MMD Preview";
    const sourceMat = new MeshBasicMaterial();
    sourceMat.name = "Body";
    const outlineMat = new MeshBasicMaterial();
    outlineMat.name = "Outline";
    outlineMat.userData.mmdOutlineMaterial = {};
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );

    const source = new Mesh(geometry, sourceMat);
    source.name = "Model";
    const outline = new Mesh(geometry, outlineMat);
    outline.name = "Model outline";
    outline.userData.mmdOutlineProxy = { source: "combined" };
    const renderProxy = new Mesh(geometry, sourceMat);
    renderProxy.name = "Model material 0";
    renderProxy.userData.mmdMaterialRenderProxy = { materialIndex: 0 };
    root.add(source, outline, renderProxy);

    const result = collectAssetMetadata(root, fakeFile, [], null);

    expect(
      result.metadata.hierarchy[0]?.children.map((node) => node.name),
    ).toEqual(["Model"]);
    expect(result.metadata.meshCount).toBe(1);
    expect(result.metadata.materialCount).toBe(1);
    expect(result.metadata.objectInfo["Model outline"]).toBeUndefined();
    expect(result.metadata.objectInfo["Model material 0"]).toBeUndefined();
  });

  it("excludes viewport wireframe proxy meshes from metadata", () => {
    const root = new Group();
    root.name = "MMD Preview";
    const material = new MeshBasicMaterial();
    material.name = "Body";
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );

    const source = new SkinnedMesh(geometry, material);
    source.name = "Model";
    root.add(source);

    applyDisplayMode(root, "texturedWireframe");

    const result = collectAssetMetadata(root, fakeFile, [], null);

    expect(
      result.metadata.hierarchy[0]?.children.map((node) => node.name),
    ).toEqual(["Model"]);
    expect(result.metadata.meshCount).toBe(1);
    expect(result.metadata.materialCount).toBe(1);
    expect(
      result.metadata.objectInfo.__yw_textured_wireframe_proxy,
    ).toBeUndefined();
  });

  it("records morph target names and initial influences on mesh info", () => {
    const root = new Group();
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    const blink = new Float32BufferAttribute(
      [0, 0.1, 0, 1, 0.1, 0, 0, 1.1, 0],
      3,
    );
    blink.name = "blink_L";
    geometry.morphAttributes.position = [blink];

    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.name = "Face";
    mesh.updateMorphTargets();
    if (mesh.morphTargetInfluences) {
      mesh.morphTargetInfluences[0] = 0.65;
    }
    root.add(mesh);

    const result = collectAssetMetadata(root, fakeFile, [], null);

    expect(result.metadata.objectInfo.Face?.morphTargets).toEqual([
      { index: 0, name: "blink_L", value: 0.65, mmd: null },
    ]);
  });

  it("omits heavy runtime userData from object inspector metadata", () => {
    const root = new Group();
    const mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    mesh.name = "RuntimeMesh";
    mesh.userData.mmdModel = { huge: new Array(1000).fill(0) };
    mesh.userData.mmdPhysics = { rigidBodies: new Array(1000).fill({}) };
    mesh.userData.mmdMorphs = new Array(1000).fill({});
    mesh.userData.mmdIkChains = new Array(1000).fill({});
    mesh.userData.mmdSourceFile = "C:\\mmd\\model.pmx";
    mesh.userData.vrm = { scene: root };
    mesh.userData.author = "visible";
    root.add(mesh);

    const result = collectAssetMetadata(root, fakeFile, [], null);

    expect(result.metadata.objectInfo.RuntimeMesh?.userData).toEqual({
      author: "visible",
    });
  });

  it("uses (unnamed mesh) for binding entries without a name", () => {
    const root = new Group();
    const mat = new MeshBasicMaterial();
    mat.name = "M";
    const mesh = new Mesh(new BufferGeometry(), mat);
    (mesh as unknown as { name: unknown }).name = null;
    root.add(mesh);

    const result = collectAssetMetadata(root, fakeFile, [], null);

    expect(result.metadata.materials[0].boundMeshes).toEqual([
      "(unnamed mesh)",
    ]);
  });

  it("marks unflipped MMD textures for display-only vertical preview flipping", () => {
    const texture = new Texture();
    texture.name = "diffuse.bmp";
    texture.flipY = false;
    const material = new MeshBasicMaterial({ map: texture });
    const mesh = new Mesh(new BufferGeometry(), material);
    mesh.name = "Miku";
    const root = new Group();
    root.add(mesh);

    const result = collectAssetMetadata(root, fakeMmdFile, [], null);

    expect(result.metadata.textures[0]).toMatchObject({
      label: "diffuse.bmp",
      previewFlipY: true,
    });
    expect(texture.flipY).toBe(false);
  });

  it("does not re-flip MMD textures that already request flipY", () => {
    const texture = new Texture();
    texture.name = "toon.bmp";
    texture.flipY = true;
    const material = new MeshBasicMaterial({ map: texture });
    const mesh = new Mesh(new BufferGeometry(), material);
    mesh.name = "Miku";
    const root = new Group();
    root.add(mesh);

    const result = collectAssetMetadata(root, fakeMmdFile, [], null);

    expect(result.metadata.textures[0]).toMatchObject({
      label: "toon.bmp",
    });
    expect(result.metadata.textures[0]?.previewFlipY).toBeUndefined();
    expect(texture.flipY).toBe(true);
  });

  it("collects texture metadata without synchronously generating thumbnails", () => {
    const { root, texture } = createTexturedMeshRoot();

    const result = collectAssetMetadata(root, fakeFile, [], null);

    expect(result.metadata.textures[0]).toMatchObject({
      id: texture.uuid,
      label: "diffuse.png",
      thumbnailUrl: null,
    });
    expect(result.textureRegistry.get(texture.uuid)).toBe(texture);
  });

  it("preserves unresolved FBX texture state for the Texture tab", () => {
    const texture = new Texture();
    texture.name = "missing.png";
    texture.userData.fbxSourceName = "../Textures/missing.png";
    texture.userData.textureSourceKind = "unresolved";
    const material = new MeshBasicMaterial({ map: texture });
    const root = new Group();
    root.add(new Mesh(new BufferGeometry(), material));

    const result = collectAssetMetadata(root, fakeFile, [], null);

    expect(result.metadata.textures[0]).toMatchObject({
      label: "missing.png",
      sourcePath: "../Textures/missing.png",
      sourceKind: "unresolved",
    });
  });

  it("keeps hydrated FBX textures resolved", () => {
    const texture = new Texture();
    texture.name = "albedo.png";
    texture.userData.fbxSourceName = "Textures/albedo.png";
    texture.userData.textureSourceKind = "external";
    const material = new MeshBasicMaterial({ map: texture });
    const root = new Group();
    root.add(new Mesh(new BufferGeometry(), material));

    const result = collectAssetMetadata(root, fakeFile, [], null);

    expect(result.metadata.textures[0]).toMatchObject({
      label: "albedo.png",
      sourcePath: "Textures/albedo.png",
      sourceKind: "external",
    });
  });

  it("refreshes unresolved texture metadata after deferred hydration succeeds", () => {
    const texture = new Texture();
    texture.name = "albedo.png";
    texture.userData.fbxSourceName = "Textures/albedo.png";
    texture.userData.textureSourceKind = "unresolved";
    const material = new MeshBasicMaterial({ map: texture });
    const root = new Group();
    root.add(new Mesh(new BufferGeometry(), material));
    const collected = collectAssetMetadata(root, fakeFile, [], null);

    texture.userData.textureSourceKind = "external";
    const refreshed = refreshTextureSourceKinds(
      collected.metadata,
      fakeFile,
      collected.textureRegistry,
    );

    expect(refreshed.textures[0]).toMatchObject({
      sourcePath: "Textures/albedo.png",
      sourceKind: "external",
    });
  });

  it("enriches texture thumbnails on scheduled tasks while preserving metadata fields", () => {
    const { root } = createTexturedMeshRoot();
    const result = collectAssetMetadata(root, fakeFile, [], null);
    const updates: Array<typeof result.metadata> = [];
    const scheduler = createManualTaskScheduler();
    const drawImage = mockCanvasThumbnail();

    scheduleTextureThumbnailEnrichment({
      metadata: result.metadata,
      onUpdate: (metadata) => updates.push(metadata),
      scheduleTask: scheduler.scheduleTask,
      textureRegistry: result.textureRegistry,
    });

    expect(updates).toHaveLength(0);
    scheduler.runNext();

    expect(updates).toHaveLength(1);
    expect(updates[0].textures[0]).toMatchObject({
      channel: "Base Color",
      dimensions: "0x0",
      label: "diffuse.png",
      sourceKind: "unknown",
      thumbnailUrl: "data:image/jpeg;base64,thumb",
    });
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it("generates thumbnails from raw RGBA texture data such as TGA DataTexture images", () => {
    const texture = new Texture();
    texture.name = "face.tga";
    texture.image = {
      data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
      height: 1,
      width: 2,
    };
    const material = new MeshBasicMaterial({ map: texture });
    const root = new Group();
    root.add(new Mesh(new BufferGeometry(), material));
    const result = collectAssetMetadata(root, fakeFile, [], null);
    const updates: Array<typeof result.metadata> = [];
    const scheduler = createManualTaskScheduler();
    const drawImage = mockCanvasThumbnail("data:image/jpeg;base64,tga-thumb");

    scheduleTextureThumbnailEnrichment({
      metadata: result.metadata,
      onUpdate: (metadata) => updates.push(metadata),
      scheduleTask: scheduler.scheduleTask,
      textureRegistry: result.textureRegistry,
    });
    scheduler.runNext();

    expect(updates[0]?.textures[0]?.thumbnailUrl).toBe(
      "data:image/jpeg;base64,tga-thumb",
    );
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it("replaces a placeholder thumbnail after deferred texture hydration", () => {
    const texture = new Texture<{
      data: Uint8Array;
      height: number;
      width: number;
    }>();
    texture.name = "body.tga";
    texture.image = {
      data: new Uint8Array([0, 0, 0, 0]),
      height: 1,
      width: 1,
    };
    const material = new MeshBasicMaterial({ map: texture });
    const root = new Group();
    root.add(new Mesh(new BufferGeometry(), material));
    const result = collectAssetMetadata(root, fakeFile, [], null);
    const updates: Array<typeof result.metadata> = [];
    const scheduler = createManualTaskScheduler();
    const drawImage = mockCanvasThumbnail();

    const scheduled = scheduleTextureThumbnailEnrichment({
      metadata: result.metadata,
      onUpdate: (metadata) => updates.push(metadata),
      scheduleTask: scheduler.scheduleTask,
      textureRegistry: result.textureRegistry,
    });
    scheduler.runNext();

    expect(updates).toHaveLength(1);
    expect(updates[0]?.textures[0]?.thumbnailUrl).not.toBeNull();
    expect(drawImage).toHaveBeenCalledTimes(1);

    // An unrelated metadata refresh must not redraw a stable texture.
    scheduled.refresh();
    scheduler.runNext();
    expect(updates).toHaveLength(1);
    expect(drawImage).toHaveBeenCalledTimes(1);

    // TGA hydration mutates the existing DataTexture image in the loader.
    texture.image.data = new Uint8Array([255, 0, 0, 255]);
    texture.image.width = 1;
    texture.image.height = 1;
    scheduled.refresh();
    scheduler.runNext();

    expect(updates).toHaveLength(2);
    expect(updates[1]?.textures[0]?.thumbnailUrl).not.toBeNull();
    expect(drawImage).toHaveBeenCalledTimes(2);
  });

  it("cancels scheduled texture thumbnail enrichment", () => {
    const { root } = createTexturedMeshRoot();
    const result = collectAssetMetadata(root, fakeFile, [], null);
    const updates: Array<typeof result.metadata> = [];
    const scheduler = createManualTaskScheduler();
    mockCanvasThumbnail();

    const scheduled = scheduleTextureThumbnailEnrichment({
      metadata: result.metadata,
      onUpdate: (metadata) => updates.push(metadata),
      scheduleTask: scheduler.scheduleTask,
      textureRegistry: result.textureRegistry,
    });

    scheduled.cancel();
    scheduler.runNext();

    expect(updates).toHaveLength(0);
    expect(scheduler.pendingCount).toBe(0);
  });

  it("skips thumbnail updates when the texture registry no longer matches", () => {
    const { root } = createTexturedMeshRoot();
    const result = collectAssetMetadata(root, fakeFile, [], null);
    const updates: Array<typeof result.metadata> = [];
    const scheduler = createManualTaskScheduler();
    mockCanvasThumbnail();

    scheduleTextureThumbnailEnrichment({
      metadata: result.metadata,
      onUpdate: (metadata) => updates.push(metadata),
      scheduleTask: scheduler.scheduleTask,
      shouldContinue: () => false,
      textureRegistry: result.textureRegistry,
    });

    scheduler.runNext();

    expect(updates).toHaveLength(0);
  });

  it("skips missing texture registry entries during thumbnail enrichment", () => {
    const { root } = createTexturedMeshRoot();
    const result = collectAssetMetadata(root, fakeFile, [], null);
    const updates: Array<typeof result.metadata> = [];
    const scheduler = createManualTaskScheduler();
    mockCanvasThumbnail();

    scheduleTextureThumbnailEnrichment({
      metadata: result.metadata,
      onUpdate: (metadata) => updates.push(metadata),
      scheduleTask: scheduler.scheduleTask,
      textureRegistry: new Map(),
    });

    scheduler.runNext();

    expect(updates).toHaveLength(0);
  });

  it("uses GLB node basename directly as fixture name (#46 hierarchy-aware path)", () => {
    // #46: the Rust USD→GLB backend now emits prim basenames directly as
    // node names (e.g. "Key" instead of "Key_light_node"). GLTFLoader copies
    // those names onto the Three.js fixture objects. The inspector no longer
    // needs to strip any suffix — the raw name IS the authored USD prim basename.
    const root = new Group();
    const light = new DirectionalLight(0xffffff, 1);
    light.name = "Key";
    const cam = new PerspectiveCamera();
    cam.name = "Hero";
    root.add(light);
    root.add(cam);

    const result = collectAssetMetadata(root, fakeFile, [], null);
    expect(result.metadata.lights[0]?.name).toBe("Key");
    expect(result.metadata.cameras[0]?.name).toBe("Hero");
  });
});

describe("buildAnimationClipMetadata", () => {
  it("extracts clip summary, track details, parsed target paths, frame rate, and interpolation labels", () => {
    const positionTrack = new VectorKeyframeTrack(
      "Hip.position",
      [0, 0.25, 0.5, 1],
      [0, 0, 0, 1, 0, 0, 2, 0, 0, 4, 0, 0],
      InterpolateLinear,
    );
    const opacityTrack = new NumberKeyframeTrack(
      "Body.material.opacity",
      [0, 0.25, 0.75],
      [0, 0.5, 1],
      InterpolateDiscrete,
    );
    const clip = new AnimationClip("Walk", 1.25, [positionTrack, opacityTrack]);

    const [metadata] = buildAnimationClipMetadata([clip]);

    expect(metadata).toMatchObject({
      name: "Walk",
      duration: 1.25,
      trackCount: 2,
      keyframeCount: 7,
      estimatedFrameRate: 4,
    });
    expect(metadata.tracks[0]).toEqual({
      name: "Hip.position",
      target: "Hip",
      propertyPath: "position",
      keyframeCount: 4,
      timeRange: [0, 1],
      interpolation: "linear",
    });
    expect(metadata.tracks[1]).toEqual({
      name: "Body.material.opacity",
      target: "Body",
      propertyPath: "material.opacity",
      keyframeCount: 3,
      timeRange: [0, 0.75],
      interpolation: "discrete",
    });
  });

  it("extracts bone names from .bones[BoneName] track targets", () => {
    const rotationTrack = new QuaternionKeyframeTrack(
      ".bones[LeftArm].quaternion",
      [0, 0.5],
      [0, 0, 0, 1, 0, 0.707, 0, 0.707],
      InterpolateSmooth,
    );
    const [metadata] = buildAnimationClipMetadata([
      new AnimationClip("Bone motion", 0.5, [rotationTrack]),
    ]);

    expect(metadata.tracks[0]).toEqual({
      name: ".bones[LeftArm].quaternion",
      target: "LeftArm",
      propertyPath: "bones[LeftArm].quaternion",
      keyframeCount: 2,
      timeRange: [0, 0.5],
      interpolation: "linear",
    });
  });

  it("maps InterpolateSmooth to 'smooth' for non-quaternion tracks", () => {
    const smoothTrack = new NumberKeyframeTrack(
      "Arm.scale",
      [0, 1],
      [0, 1],
      InterpolateSmooth,
    );
    const [metadata] = buildAnimationClipMetadata([
      new AnimationClip("Smooth", 1, [smoothTrack]),
    ]);

    expect(metadata.tracks[0]?.interpolation).toBe("smooth");
  });

  it("falls back to splitting on the final dot when PropertyBinding parsing fails", () => {
    const malformedTrack = new NumberKeyframeTrack(
      "Broken[Node].visibility",
      [0, 1],
      [0, 1],
      InterpolateLinear,
    );
    const [metadata] = buildAnimationClipMetadata([
      new AnimationClip("Malformed binding", 1, [malformedTrack]),
    ]);

    expect(metadata.tracks[0]).toMatchObject({
      name: "Broken[Node].visibility",
      target: "Broken[Node]",
      propertyPath: "visibility",
    });
  });

  it("handles tracks with zero or one keyframe without estimating a frame rate", () => {
    const singleKeyTrack = new NumberKeyframeTrack(
      "Static.opacity",
      [0.75],
      [1],
      InterpolateLinear,
    );
    const emptyTrack = new NumberKeyframeTrack(
      "Empty.opacity",
      [0],
      [0],
      InterpolateLinear,
    );
    emptyTrack.times = new Float32Array();
    emptyTrack.values = new Float32Array();

    const [metadata] = buildAnimationClipMetadata([
      new AnimationClip("Sparse", 1, [singleKeyTrack, emptyTrack]),
    ]);

    expect(metadata.keyframeCount).toBe(1);
    expect(metadata.estimatedFrameRate).toBeNull();
    expect(metadata.tracks[0]).toMatchObject({
      keyframeCount: 1,
      timeRange: [0.75, 0.75],
    });
    expect(metadata.tracks[1]).toMatchObject({
      keyframeCount: 0,
      timeRange: [0, 0],
    });
  });

  it("returns an empty array for an empty clip list", () => {
    expect(buildAnimationClipMetadata([])).toEqual([]);
  });

  it("reports track timeRange as the finite min and max time values", () => {
    const unsortedTrack = new NumberKeyframeTrack(
      "Scrub.weight",
      [2, 0.5, 1.25],
      [1, 0, 0.5],
      InterpolateLinear,
    );
    const [metadata] = buildAnimationClipMetadata([
      new AnimationClip("Unsorted", 2, [unsortedTrack]),
    ]);

    expect(metadata.tracks[0]?.timeRange).toEqual([0.5, 2]);
  });
});
