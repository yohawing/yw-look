import {
  BackSide,
  AxesHelper,
  Bone,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  LineBasicMaterial,
  LineSegments,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshNormalMaterial,
  MeshStandardMaterial,
  ObjectSpaceNormalMap,
  Scene,
  SkinnedMesh,
  Texture,
  Vector3,
} from "three";
import { describe, expect, it, vi } from "vitest";
import {
  applyBackfaceCulling,
  collectSceneTraversal,
  applyDisplayMode,
  applyShadows,
  applySurfaceMaterialMode,
  disposeObject,
  getScaleWarning,
  applyUnlitMaterial,
  applyVertexColors,
  applySkeletonHelpers,
  traverseMeshesExcludingHelpers,
  normalizeObjectScale,
} from "../scene";
import { syncMmdTransparentMaterialRenderState } from "../../packs";

describe("load-time traversal snapshot", () => {
  it("preserves disableAutoFrame normalization parity", () => {
    const createSplatRoot = () => {
      const root = new Group();
      root.userData.disableAutoFrame = true;
      root.userData.splatBoundsMaxDimension = 540;
      return root;
    };
    const baselineRoot = createSplatRoot();
    const snapshotRoot = createSplatRoot();
    const traversal = collectSceneTraversal(snapshotRoot);

    const baseline = normalizeObjectScale(baselineRoot);
    const optimized = normalizeObjectScale(snapshotRoot, traversal);

    expect(optimized).toEqual(baseline);
    expect(optimized).toMatchObject({
      applied: true,
      factor: 0.1,
      originalMaxDimension: 540,
      normalizedMaxDimension: 540,
    });
  });

  it("uses the normalization dimension for warnings without recomputing bounds", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0]), 3),
    );
    const computeBoundsSpy = vi.spyOn(geometry, "computeBoundingBox");
    const root = new Group().add(new Mesh(geometry, new MeshBasicMaterial()));

    const warning = getScaleWarning(root, {
      applied: false,
      factor: 1,
      originalMaxDimension: 0.0005,
      normalizedMaxDimension: 0.0005,
      originalScale: null,
    });

    expect(warning).toBe(
      "Scale warning: the loaded content is extremely small.",
    );
    expect(computeBoundsSpy).not.toHaveBeenCalled();
  });
});

describe("skeleton local-axis helpers", () => {
  it("keeps local-axis endpoints bounded in world space under shear", () => {
    const scene = new Scene();
    const root = new Group();
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 3, 0, 0, 0, 3, 0]), 3),
    );
    root.add(new Mesh(geometry, new MeshBasicMaterial()));

    const bone = new Bone();
    bone.matrixAutoUpdate = false;
    // The second basis vector is sheared into the first and the Z basis is
    // non-uniformly scaled. A local axis rotation then produces more stretch
    // than getWorldScale() reports.
    bone.matrix.set(2, 1.8, 0, 0, 0, 0.8, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1);
    bone.userData.mmdLocalAxis = {
      x: [Math.SQRT1_2, Math.SQRT1_2, 0],
      z: [0, 0, 1],
    };
    root.add(bone);
    scene.add(root);

    applySkeletonHelpers(scene, root, true, true);
    scene.updateMatrixWorld(true);

    const axis = bone.children.find(
      (child): child is AxesHelper => child instanceof AxesHelper,
    );
    expect(axis).toBeDefined();

    const position = axis?.geometry.getAttribute("position");
    expect(position).toBeDefined();
    const origin = new Vector3().setFromMatrixPosition(axis!.matrixWorld);
    const endpoint = new Vector3();
    const lengths: number[] = [];
    for (let index = 0; index < position!.count; index += 1) {
      endpoint
        .fromBufferAttribute(position!, index)
        .applyMatrix4(axis!.matrixWorld);
      const length = endpoint.distanceTo(origin);
      if (length > 1e-8) {
        lengths.push(length);
      }
    }

    // The model max dimension is 3, so the target world-space axis length is
    // 3 * (0.02 / 3) = 0.02. All three RGB endpoints must stay within it.
    expect(lengths).toHaveLength(3);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(0.0200001);
  });
});

describe("traverseMeshesExcludingHelpers", () => {
  it("skips viewport helpers and supports optional outline and shadow catcher filters", () => {
    const root = new Group();
    const regular = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    const outlineMaterial = new MeshBasicMaterial();
    outlineMaterial.userData.mmdOutlineMaterial = { materialIndex: 0 };
    const outline = new Mesh(new BufferGeometry(), outlineMaterial);
    const helperProxy = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    helperProxy.userData.__yw_wireframe_proxy = true;
    const catcher = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    catcher.name = "__yw_shadow_catcher";
    root.add(regular, outline, helperProxy, catcher);

    const visited: Mesh[] = [];
    traverseMeshesExcludingHelpers(root, (mesh) => visited.push(mesh));
    expect(visited).toEqual([regular, catcher]);

    const withOutline: Mesh[] = [];
    traverseMeshesExcludingHelpers(root, (mesh) => withOutline.push(mesh), {
      excludeMmdOutlineMeshes: false,
    });
    expect(withOutline).toEqual([regular, outline, catcher]);

    const withoutCatcher: Mesh[] = [];
    traverseMeshesExcludingHelpers(root, (mesh) => withoutCatcher.push(mesh), {
      excludeShadowCatcher: true,
    });
    expect(withoutCatcher).toEqual([regular]);
  });
});

describe("scene material display helpers", () => {
  it("renders textured wireframe as a mesh with a line overlay", () => {
    const root = new Group();
    const texture = new Texture();
    const material = new MeshBasicMaterial({ color: 0xff3300, map: texture });
    const mesh = new Mesh(new BufferGeometry(), material);
    mesh.geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    root.add(mesh);

    applyDisplayMode(root, "texturedWireframe");

    const overlays = mesh.children.filter(
      (child): child is LineSegments => child instanceof LineSegments,
    );
    const overlayMaterial = overlays[0].material as LineBasicMaterial;
    expect(material.wireframe).toBe(false);
    expect(material.map).toBe(texture);
    expect(overlays).toHaveLength(1);
    expect(overlays[0].renderOrder).toBe(mesh.renderOrder + 1);
    expect(overlayMaterial).toBeInstanceOf(LineBasicMaterial);
    expect(overlayMaterial.color.getHexString()).toBe("5e6ad2");
    expect(overlayMaterial.opacity).toBe(0.78);
    const disposeOverlayMaterial = vi.spyOn(overlayMaterial, "dispose");

    applyDisplayMode(root, "texturedWireframe");

    expect(disposeOverlayMaterial).toHaveBeenCalledTimes(1);
    expect(
      mesh.children.filter((child) => child instanceof LineSegments),
    ).toHaveLength(1);

    applyDisplayMode(root, "wireframe");

    const wireframeMaterial = mesh.material as unknown as MeshBasicMaterial;
    expect(wireframeMaterial).toBeInstanceOf(MeshBasicMaterial);
    expect(wireframeMaterial).not.toBe(material);
    expect(wireframeMaterial.wireframe).toBe(true);
    expect(wireframeMaterial.color.getHexString()).toBe("f7f8f8");
    expect(wireframeMaterial.map).toBeNull();
    expect(wireframeMaterial.toneMapped).toBe(false);
    expect(material.wireframe).toBe(false);
    expect(material.color.getHexString()).toBe("ff3300");
    expect(material.map).toBe(texture);
    expect(
      mesh.children.filter((child) => child instanceof LineSegments),
    ).toHaveLength(0);

    applyDisplayMode(root, "textured");

    expect(mesh.material).toBe(material);
    expect(material.wireframe).toBe(false);
    expect(material.color.getHexString()).toBe("ff3300");
    expect(material.map).toBe(texture);
  });

  it("uses unlit neutral wireframe materials for lit source materials", () => {
    const root = new Group();
    const material = new MeshStandardMaterial({ color: 0x2288ff });
    const mesh = new Mesh(new BufferGeometry(), material);
    mesh.geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    root.add(mesh);

    applyDisplayMode(root, "wireframe");

    const wireframeMaterial = mesh.material as unknown as MeshBasicMaterial;
    expect(wireframeMaterial).toBeInstanceOf(MeshBasicMaterial);
    expect(wireframeMaterial.wireframe).toBe(true);
    expect(wireframeMaterial.color.getHexString()).toBe("f7f8f8");
    expect(wireframeMaterial.toneMapped).toBe(false);
    expect(material.wireframe).toBe(false);
    expect(material.color.getHexString()).toBe("2288ff");

    applyDisplayMode(root, "textured");

    expect(mesh.material).toBe(material);
  });

  it("preserves authored hidden material state in wireframe mode", () => {
    const root = new Group();
    const material = new MeshBasicMaterial({
      color: 0xff3300,
      opacity: 0,
      transparent: true,
    });
    material.visible = false;
    const mesh = new Mesh(new BufferGeometry(), material);
    root.add(mesh);

    applyDisplayMode(root, "wireframe");

    const wireframeMaterial = mesh.material as MeshBasicMaterial;
    expect(wireframeMaterial.visible).toBe(false);
    expect(wireframeMaterial.transparent).toBe(true);
    expect(wireframeMaterial.opacity).toBe(0);
  });

  it("renders skinned textured wireframes with a following mesh proxy", () => {
    const root = new Group();
    const material = new MeshBasicMaterial({ color: 0xff3300 });
    const skinned = new SkinnedMesh(new BufferGeometry(), material);
    skinned.geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    skinned.morphTargetDictionary = { smile: 0 };
    skinned.morphTargetInfluences = [0.5];
    root.add(skinned);

    applyDisplayMode(root, "texturedWireframe");

    const proxies = skinned.children.filter(
      (child): child is Mesh =>
        child instanceof Mesh && !(child instanceof LineSegments),
    );
    expect(material.wireframe).toBe(false);
    expect(material.color.getHexString()).toBe("ff3300");
    expect(proxies).toHaveLength(1);
    expect(proxies[0]).toBeInstanceOf(SkinnedMesh);
    expect(proxies[0].geometry).toBe(skinned.geometry);
    expect(proxies[0].morphTargetDictionary).toBe(
      skinned.morphTargetDictionary,
    );
    expect(proxies[0].morphTargetInfluences).toBe(
      skinned.morphTargetInfluences,
    );
    expect((proxies[0].material as MeshBasicMaterial).wireframe).toBe(true);
    expect(
      (proxies[0].material as MeshBasicMaterial).color.getHexString(),
    ).toBe("5e6ad2");
    expect((proxies[0].material as MeshBasicMaterial).transparent).toBe(false);
    expect(
      skinned.children.filter((child) => child instanceof LineSegments),
    ).toHaveLength(0);

    applyDisplayMode(root, "textured");

    expect(skinned.children).toHaveLength(0);
    expect(material.wireframe).toBe(false);
  });

  it("keeps wireframe proxies out of unlit material toggles", () => {
    const root = new Group();
    const material = new MeshBasicMaterial({ color: 0xff3300 });
    const skinned = new SkinnedMesh(new BufferGeometry(), material);
    skinned.geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    root.add(skinned);

    applyDisplayMode(root, "texturedWireframe");

    const proxy = skinned.children.find(
      (child): child is SkinnedMesh => child instanceof SkinnedMesh,
    );
    expect(proxy).toBeDefined();
    const proxyMaterial = proxy?.material;

    applyUnlitMaterial(root, true);

    expect(proxy?.material).toBe(proxyMaterial);
    expect(proxy?.userData._ywUnlitOriginal).toBeUndefined();
  });

  it("preserves authored material visibility on wireframe proxies", () => {
    const root = new Group();
    const material = new MeshBasicMaterial({
      opacity: 0,
      transparent: true,
      side: BackSide,
    });
    material.visible = false;
    const skinned = new SkinnedMesh(new BufferGeometry(), material);
    skinned.geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    root.add(skinned);

    applyDisplayMode(root, "texturedWireframe");

    const proxy = skinned.children.find(
      (child): child is SkinnedMesh => child instanceof SkinnedMesh,
    );
    const proxyMaterial = proxy?.material as MeshBasicMaterial;
    expect(proxyMaterial.visible).toBe(false);
    expect(proxyMaterial.transparent).toBe(true);
    expect(proxyMaterial.opacity).toBe(0);
    expect(proxyMaterial.side).toBe(BackSide);
    expect(proxyMaterial.wireframe).toBe(true);
  });

  it("keeps wireframe proxies out of shadow toggles", () => {
    const scene = new Scene();
    const root = new Group();
    const light = new DirectionalLight();
    const material = new MeshBasicMaterial({ color: 0xff3300 });
    const skinned = new SkinnedMesh(new BufferGeometry(), material);
    skinned.geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    root.add(skinned);
    scene.add(root);

    applyDisplayMode(root, "texturedWireframe");

    const proxy = skinned.children.find(
      (child): child is SkinnedMesh => child instanceof SkinnedMesh,
    );

    applyShadows(scene, root, light, true);

    expect(skinned.castShadow).toBe(true);
    expect(skinned.receiveShadow).toBe(true);
    expect(proxy?.castShadow).toBe(false);
    expect(proxy?.receiveShadow).toBe(false);
  });

  it("renders instanced textured wireframes with a following mesh proxy", () => {
    const root = new Group();
    const material = new MeshBasicMaterial({ color: 0xff3300 });
    const instanced = new InstancedMesh(new BufferGeometry(), material, 2);
    instanced.geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    root.add(instanced);

    applyDisplayMode(root, "texturedWireframe");

    const proxies = instanced.children.filter(
      (child): child is InstancedMesh =>
        child instanceof InstancedMesh && !(child instanceof LineSegments),
    );
    expect(material.wireframe).toBe(false);
    expect(proxies).toHaveLength(1);
    expect(proxies[0].geometry).toBe(instanced.geometry);
    expect(proxies[0].instanceMatrix).toBe(instanced.instanceMatrix);
    expect((proxies[0].material as MeshBasicMaterial).wireframe).toBe(true);
    expect(
      instanced.children.filter((child) => child instanceof LineSegments),
    ).toHaveLength(0);
  });

  it("honors unlit toggles made while wireframe mode is active", () => {
    const root = new Group();
    const material = new MeshBasicMaterial({ color: 0xff3300 });
    const mesh = new Mesh(new BufferGeometry(), material);
    mesh.geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    root.add(mesh);

    applyDisplayMode(root, "wireframe");
    applyUnlitMaterial(root, true);
    applyDisplayMode(root, "textured");

    const unlitMaterial = mesh.material as MeshBasicMaterial;
    expect(unlitMaterial).toBeInstanceOf(MeshBasicMaterial);
    expect(unlitMaterial).not.toBe(material);
    expect(unlitMaterial.color.getHexString()).toBe("ff3300");
    expect(unlitMaterial.wireframe).toBe(false);

    applyUnlitMaterial(root, false);

    expect(mesh.material).toBe(material);
    expect(material.color.getHexString()).toBe("ff3300");
    expect(material.wireframe).toBe(false);
  });

  it("applies material controls to stored originals while wireframe mode is active", () => {
    const root = new Group();
    const material = new MeshBasicMaterial({ side: FrontSide });
    const mesh = new Mesh(new BufferGeometry(), material);
    root.add(mesh);

    applyDisplayMode(root, "wireframe");
    applyBackfaceCulling(root, false);
    applyDisplayMode(root, "textured");

    expect(mesh.material).toBe(material);
    expect(material.side).toBe(DoubleSide);
  });

  it("forces single-pass rendering for double-sided transparent MMD materials", () => {
    const root = new Group();
    const material = new MeshBasicMaterial({
      transparent: true,
      opacity: 0.45,
      side: FrontSide,
    });
    material.userData.mmdMaterial = { transparencyMode: "alphaBlend" };
    const mesh = new Mesh(new BufferGeometry(), material);
    root.add(mesh);

    applyBackfaceCulling(root, false);

    expect(material.side).toBe(DoubleSide);
    expect(material.forceSinglePass).toBe(true);

    applyBackfaceCulling(root, true);

    expect(material.side).toBe(FrontSide);
    expect(material.forceSinglePass).toBe(false);
  });

  it("prevents hidden MMD color-suppressed materials from writing depth", () => {
    const material = new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      side: DoubleSide,
    });
    material.colorWrite = false;
    material.depthWrite = true;
    material.userData.mmdMaterial = { transparencyMode: "alphaBlend" };

    syncMmdTransparentMaterialRenderState(material);

    expect(material.depthWrite).toBe(false);
    expect(material.forceSinglePass).toBe(true);
  });

  it("prevents fully transparent MMD outline materials from writing depth", () => {
    const material = new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      side: BackSide,
    });
    material.depthWrite = true;
    material.userData.mmdOutlineMaterial = { materialIndex: 0 };

    syncMmdTransparentMaterialRenderState(material);

    expect(material.depthWrite).toBe(false);
  });

  it("preserves MMD transparent render state when creating unlit materials", () => {
    const root = new Group();
    const material = new MeshBasicMaterial({
      transparent: true,
      opacity: 0.45,
      side: DoubleSide,
    });
    material.forceSinglePass = true;
    material.userData.mmdMaterial = { transparencyMode: "alphaBlend" };
    const mesh = new Mesh(new BufferGeometry(), material);
    root.add(mesh);

    applyUnlitMaterial(root, true);

    const unlit = mesh.material as MeshBasicMaterial;
    expect(unlit).not.toBe(material);
    expect(unlit.userData.mmdMaterial).toBe(material.userData.mmdMaterial);
    expect(unlit.transparent).toBe(true);
    expect(unlit.side).toBe(DoubleSide);
    expect(unlit.forceSinglePass).toBe(true);
  });

  it("disposes unlit originals without double-disposing shared map textures", () => {
    const root = new Group();
    const texture = new Texture();
    const material = new MeshBasicMaterial({ map: texture });
    const mesh = new Mesh(new BufferGeometry(), material);
    root.add(mesh);
    const disposeTexture = vi.spyOn(texture, "dispose");
    const disposeMaterial = vi.spyOn(material, "dispose");

    applyUnlitMaterial(root, true);

    const unlit = mesh.material as MeshBasicMaterial;
    const disposeUnlit = vi.spyOn(unlit, "dispose");

    disposeObject(root);

    expect(disposeMaterial).toHaveBeenCalledTimes(1);
    expect(disposeUnlit).toHaveBeenCalledTimes(1);
    expect(disposeTexture).toHaveBeenCalledTimes(1);
    expect(mesh.userData._ywUnlitOriginal).toBeUndefined();
  });

  it("disposes originalMap textures that are hidden by display mode", () => {
    const root = new Group();
    const texture = new Texture();
    const material = new MeshBasicMaterial({ map: texture });
    const mesh = new Mesh(new BufferGeometry(), material);
    root.add(mesh);
    const disposeTexture = vi.spyOn(texture, "dispose");

    applyDisplayMode(root, "untextured");

    expect(material.map).toBeNull();
    expect(material.userData.originalMap).toBe(texture);

    disposeObject(root);

    expect(disposeTexture).toHaveBeenCalledTimes(1);
  });

  it("disposes original textured materials when unlit is enabled in wireframe mode", () => {
    const root = new Group();
    const map = new Texture();
    const normalMap = new Texture();
    const material = new MeshStandardMaterial({ map, normalMap });
    const mesh = new Mesh(new BufferGeometry(), material);
    mesh.geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    root.add(mesh);
    const disposeMap = vi.spyOn(map, "dispose");
    const disposeNormalMap = vi.spyOn(normalMap, "dispose");
    const disposeMaterial = vi.spyOn(material, "dispose");

    applyDisplayMode(root, "wireframe");
    applyUnlitMaterial(root, true);

    const wireframe = mesh.material as unknown as MeshBasicMaterial;
    const unlit = mesh.userData.__yw_wireframe_original_material as
      MeshBasicMaterial | MeshBasicMaterial[];
    const disposeWireframe = vi.spyOn(wireframe, "dispose");
    const disposeUnlit = vi.spyOn(
      Array.isArray(unlit) ? unlit[0] : unlit,
      "dispose",
    );

    disposeObject(root);

    expect(disposeMaterial).toHaveBeenCalledTimes(1);
    expect(disposeWireframe).toHaveBeenCalledTimes(1);
    expect(disposeUnlit).toHaveBeenCalledTimes(1);
    expect(disposeMap).toHaveBeenCalledTimes(1);
    expect(disposeNormalMap).toHaveBeenCalledTimes(1);
    expect(mesh.userData._ywUnlitOriginal).toBeUndefined();
    expect(mesh.userData.__yw_wireframe_original_material).toBeUndefined();
  });

  it("preserves vertex color toggles made while wireframe mode is active", () => {
    const root = new Group();
    const material = new MeshBasicMaterial();
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    geometry.setAttribute(
      "color",
      new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), 3),
    );
    const mesh = new Mesh(geometry, material);
    root.add(mesh);

    applyDisplayMode(root, "wireframe");
    applyVertexColors(root, true);
    applyDisplayMode(root, "textured");

    expect(mesh.material).toBe(material);
    expect(material.vertexColors).toBe(true);
  });

  it("keeps MMD outline materials out of global lighting toggles but applies wireframe display", () => {
    const root = new Group();
    const regularMaterial = new MeshBasicMaterial({ side: FrontSide });
    const renderProxyMaterial = new MeshBasicMaterial({ side: FrontSide });
    const outlineMaterial = new MeshBasicMaterial({ side: BackSide });
    outlineMaterial.userData.mmdOutlineMaterial = {};

    const regular = new Mesh(new BufferGeometry(), regularMaterial);
    const renderProxy = new Mesh(new BufferGeometry(), renderProxyMaterial);
    renderProxy.userData.mmdMaterialRenderProxy = { materialIndex: 0 };
    const outline = new Mesh(new BufferGeometry(), outlineMaterial);
    outline.userData.mmdOutlineProxy = { source: "combined" };
    root.add(regular, renderProxy, outline);

    applyBackfaceCulling(root, false);
    applyDisplayMode(root, "wireframe");
    applyUnlitMaterial(root, true);

    expect(regularMaterial.side).toBe(DoubleSide);
    expect(regularMaterial.wireframe).toBe(false);
    expect(regular.material).not.toBe(regularMaterial);
    expect((regular.material as MeshBasicMaterial).wireframe).toBe(true);
    expect(renderProxyMaterial.side).toBe(DoubleSide);
    expect(renderProxyMaterial.wireframe).toBe(false);
    expect(renderProxy.material).not.toBe(renderProxyMaterial);
    expect(outlineMaterial.side).toBe(BackSide);
    expect(outlineMaterial.wireframe).toBe(false);
    expect(outline.material).not.toBe(outlineMaterial);
    expect((outline.material as MeshBasicMaterial).wireframe).toBe(true);

    applyDisplayMode(root, "textured");

    expect(outline.material).toBe(outlineMaterial);
    expect(outlineMaterial.wireframe).toBe(false);
  });

  it("preserves material-only MMD outline identity in wireframe mode", () => {
    const root = new Group();
    const outlineMaterial = new MeshBasicMaterial({ side: BackSide });
    outlineMaterial.userData.mmdOutlineMaterial = { materialIndex: 0 };
    const outline = new Mesh(new BufferGeometry(), outlineMaterial);
    outline.geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    );
    root.add(outline);

    applyDisplayMode(root, "wireframe");

    const wireframeMaterial = outline.material as MeshBasicMaterial;
    expect(wireframeMaterial).not.toBe(outlineMaterial);
    expect(wireframeMaterial.wireframe).toBe(true);
    expect(wireframeMaterial.userData.mmdOutlineMaterial).toBe(
      outlineMaterial.userData.mmdOutlineMaterial,
    );

    applyBackfaceCulling(root, false);
    applyDisplayMode(root, "texturedWireframe");

    expect(outline.material).toBe(outlineMaterial);
    expect(outlineMaterial.side).toBe(BackSide);
    expect(
      outline.children.filter((child) => child instanceof LineSegments),
    ).toHaveLength(0);
  });
});

function createNormalGeometry() {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
  );
  geometry.setAttribute(
    "normal",
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  );
  return geometry;
}

describe("normal surface material mode", () => {
  it("preserves normal texture coordinates and scale without owning the texture", () => {
    const texture = new Texture();
    texture.channel = 1;
    texture.offset.set(0.2, 0.3);
    texture.repeat.set(2, 3);
    texture.rotation = 0.5;
    const original = new MeshStandardMaterial({ normalMap: texture });
    original.normalScale.set(0.4, -0.7);
    original.normalMapType = ObjectSpaceNormalMap;
    const plain = new MeshBasicMaterial();
    const authored = [original, plain];
    const mesh = new Mesh(createNormalGeometry(), authored);
    const root = new Group().add(mesh);
    const disposeTexture = vi.spyOn(texture, "dispose");

    for (const nextMode of ["unlit", "shaded"] as const) {
      applySurfaceMaterialMode(root, "normals");
      const normals = mesh.material as unknown as MeshNormalMaterial[];
      expect(normals[0].normalMap).toBe(texture);
      expect(normals[0].normalScale).toEqual(original.normalScale);
      expect(normals[0].normalScale).not.toBe(original.normalScale);
      expect(normals[0].normalMapType).toBe(ObjectSpaceNormalMap);
      expect(normals[1].normalMap).toBeNull();
      applyDisplayMode(root, "wireframe");
      applyDisplayMode(root, "textured");
      expect(mesh.material).toBe(normals);
      applySurfaceMaterialMode(root, nextMode);
      expect(disposeTexture).not.toHaveBeenCalled();
    }
    expect(mesh.material).toBe(authored);
    expect(original.normalMap).toBe(texture);
  });

  it("replaces a static mesh surface while preserving authored render state", () => {
    const root = new Group();
    const original = new MeshStandardMaterial({
      depthTest: false,
      depthWrite: false,
      opacity: 0.42,
      side: BackSide,
      transparent: true,
    });
    original.visible = false;
    original.colorWrite = false;
    const mesh = new Mesh(createNormalGeometry(), original);
    root.add(mesh);

    applySurfaceMaterialMode(root, "normals");

    const normal = mesh.material as unknown as MeshNormalMaterial;
    expect(normal).toBeInstanceOf(MeshNormalMaterial);
    expect(normal).not.toBe(original);
    expect(normal.visible).toBe(false);
    expect(normal.opacity).toBe(0.42);
    expect(normal.transparent).toBe(true);
    expect(normal.side).toBe(BackSide);
    expect(normal.depthTest).toBe(false);
    expect(normal.depthWrite).toBe(false);
    expect(normal.colorWrite).toBe(false);
    expect(root.children).toEqual([mesh]);

    const disposeNormal = vi.spyOn(normal, "dispose");
    applySurfaceMaterialMode(root, "shaded");

    expect(mesh.material).toBe(original);
    expect(disposeNormal).toHaveBeenCalledTimes(1);
  });

  it("restores the exact authored material array and disposes each temporary", () => {
    const first = new MeshStandardMaterial({ side: FrontSide });
    const second = new MeshBasicMaterial({ side: DoubleSide });
    const authored = [first, second];
    const mesh = new Mesh(createNormalGeometry(), authored);
    const root = new Group().add(mesh);

    applySurfaceMaterialMode(root, "normals");

    const normals = mesh.material as unknown as MeshNormalMaterial[];
    expect(normals).toHaveLength(2);
    expect(
      normals.every((material) => material instanceof MeshNormalMaterial),
    ).toBe(true);
    expect(normals[0].side).toBe(FrontSide);
    expect(normals[1].side).toBe(DoubleSide);
    const disposals = normals.map((material) => vi.spyOn(material, "dispose"));

    applySurfaceMaterialMode(root, "shaded");

    expect(mesh.material).toBe(authored);
    expect(mesh.material[0]).toBe(first);
    expect(mesh.material[1]).toBe(second);
    for (const dispose of disposals) {
      expect(dispose).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps skinned and morph state on the rendered mesh", () => {
    const original = new MeshStandardMaterial();
    const mesh = new SkinnedMesh(createNormalGeometry(), original);
    mesh.morphTargetDictionary = { smile: 0 };
    mesh.morphTargetInfluences = [0.75];
    const influences = mesh.morphTargetInfluences;
    const dictionary = mesh.morphTargetDictionary;
    const geometry = mesh.geometry;
    const root = new Group().add(mesh);

    applySurfaceMaterialMode(root, "normals");

    expect(mesh.material).toBeInstanceOf(MeshNormalMaterial);
    expect(mesh).toBeInstanceOf(SkinnedMesh);
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.morphTargetDictionary).toBe(dictionary);
    expect(mesh.morphTargetInfluences).toBe(influences);

    applySurfaceMaterialMode(root, "shaded");
    expect(mesh.material).toBe(original);
  });

  it("keeps MMD outline meshes authored while replacing regular surfaces", () => {
    const regularMaterial = new MeshStandardMaterial();
    const outlineMaterial = new MeshBasicMaterial();
    outlineMaterial.userData.mmdOutlineMaterial = { materialIndex: 0 };
    const regular = new Mesh(createNormalGeometry(), regularMaterial);
    const outline = new Mesh(createNormalGeometry(), outlineMaterial);
    const root = new Group().add(regular, outline);

    applySurfaceMaterialMode(root, "normals");

    expect(regular.material).toBeInstanceOf(MeshNormalMaterial);
    expect(outline.material).toBe(outlineMaterial);

    applySurfaceMaterialMode(root, "shaded");
    expect(regular.material).toBe(regularMaterial);
    expect(outline.material).toBe(outlineMaterial);
  });

  it("keeps wireframe overlay and only as independent layers", () => {
    const original = new MeshStandardMaterial();
    const mesh = new Mesh(createNormalGeometry(), original);
    const root = new Group().add(mesh);

    applySurfaceMaterialMode(root, "normals");
    const normal = mesh.material;
    applyDisplayMode(root, "texturedWireframe");

    expect(mesh.material).toBe(normal);
    expect(mesh.children.some((child) => child instanceof LineSegments)).toBe(
      true,
    );

    applyDisplayMode(root, "wireframe");
    expect(mesh.material).toBeInstanceOf(MeshBasicMaterial);
    expect((mesh.material as unknown as MeshBasicMaterial).wireframe).toBe(
      true,
    );

    applyDisplayMode(root, "textured");
    expect(mesh.material).toBe(normal);

    applyDisplayMode(root, "wireframe");
    applySurfaceMaterialMode(root, "shaded");
    expect((mesh.material as unknown as MeshBasicMaterial).wireframe).toBe(
      true,
    );
    applyDisplayMode(root, "textured");
    expect(mesh.material).toBe(original);
  });

  it("restores authored references through forward and reverse surface switching", () => {
    const original = new MeshStandardMaterial({ vertexColors: false });
    const mesh = new Mesh(createNormalGeometry(), original);
    mesh.geometry.setAttribute(
      "color",
      new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), 3),
    );
    const root = new Group().add(mesh);

    for (const mode of [
      "normals",
      "unlit",
      "vertexColors",
      "shaded",
      "vertexColors",
      "unlit",
      "normals",
      "shaded",
    ] as const) {
      applySurfaceMaterialMode(root, mode);
      if (mode === "normals") {
        expect(mesh.material).toBeInstanceOf(MeshNormalMaterial);
      } else if (mode === "unlit") {
        expect(mesh.material).toBeInstanceOf(MeshBasicMaterial);
        expect(mesh.material).not.toBe(original);
      } else {
        expect(mesh.material).toBe(original);
        expect(original.vertexColors).toBe(mode === "vertexColors");
      }
    }
  });

  it("updates backface state underneath normals and restores it", () => {
    const original = new MeshStandardMaterial({ side: BackSide });
    const mesh = new Mesh(createNormalGeometry(), original);
    const root = new Group().add(mesh);

    applySurfaceMaterialMode(root, "normals");
    applyBackfaceCulling(root, false);
    expect((mesh.material as unknown as MeshNormalMaterial).side).toBe(
      DoubleSide,
    );
    expect(original.side).toBe(DoubleSide);

    applySurfaceMaterialMode(root, "shaded");
    expect(mesh.material).toBe(original);
    expect(original.side).toBe(DoubleSide);
    applyBackfaceCulling(root, true);
    expect(original.side).toBe(BackSide);
  });

  it("disposes temporary and authored materials once during asset disposal", () => {
    const original = new MeshStandardMaterial();
    const mesh = new Mesh(createNormalGeometry(), original);
    const root = new Group().add(mesh);
    applySurfaceMaterialMode(root, "normals");
    const normal = mesh.material as unknown as MeshNormalMaterial;
    const disposeOriginal = vi.spyOn(original, "dispose");
    const disposeNormal = vi.spyOn(normal, "dispose");

    disposeObject(root);

    expect(disposeOriginal).toHaveBeenCalledTimes(1);
    expect(disposeNormal).toHaveBeenCalledTimes(1);
  });
});
