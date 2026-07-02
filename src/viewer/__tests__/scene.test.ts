import {
  BackSide,
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
  MeshStandardMaterial,
  Scene,
  SkinnedMesh,
  Texture,
} from "three";
import { describe, expect, it, vi } from "vitest";
import {
  applyBackfaceCulling,
  applyDisplayMode,
  applyShadows,
  applyUnlitMaterial,
  applyVertexColors,
  traverseMeshesExcludingHelpers,
} from "../scene";
import { syncMmdTransparentMaterialRenderState } from "../mmd/userData";

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
