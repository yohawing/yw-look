import { describe, expect, it, vi } from "vitest";
import {
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Vector4,
} from "three";
import {
  syncMmdMaterialStates,
  syncMmdOutlineMaterialStates,
} from "@yohawing/three-mmd-loader";
import type { MmdRuntimeModelHandle } from "../../../types/viewer";
import {
  attachMmdMaterialMorphRuntime,
  createMmdMaterialMorphData,
  evaluateMmdMaterialMorphs,
  type MmdMaterialMorphOffset,
  type MmdMaterialState,
} from "../materialMorph";

const BASE_MATERIAL: MmdMaterialState = {
  diffuse: [0.8, 0.6, 0.4, 1],
  specular: [0.3, 0.2, 0.1],
  specularPower: 8,
  ambient: [0.2, 0.3, 0.4],
  edgeColor: [0.1, 0.2, 0.3, 1],
  edgeSize: 2,
  textureFactor: [1, 1, 1, 1],
  sphereTextureFactor: [1, 1, 1, 1],
  toonTextureFactor: [1, 1, 1, 1],
};

describe("evaluateMmdMaterialMorphs", () => {
  it("applies multiply weights at 0, 0.5, and 1 and restores the base state", () => {
    const data = createData([
      createOffset({
        operation: "multiply",
        diffuse: [0.5, 2, 1, 0.25],
        edgeSize: 0.5,
      }),
    ]);

    expect(evaluateMmdMaterialMorphs(data, [0])[0]).toEqual(BASE_MATERIAL);
    expectArrayCloseTo(
      evaluateMmdMaterialMorphs(data, [0.5])[0].diffuse,
      [0.6, 0.9, 0.4, 0.625],
    );
    expectArrayCloseTo(
      evaluateMmdMaterialMorphs(data, [1])[0].diffuse,
      [0.4, 1.2, 0.4, 0.25],
    );
    expect(evaluateMmdMaterialMorphs(data, [1])[0].edgeSize).toBe(1);
    expect(evaluateMmdMaterialMorphs(data, [0])[0]).toEqual(BASE_MATERIAL);
  });

  it("applies additive texture, sphere, toon, and edge factors", () => {
    const data = createData([
      createOffset({
        operation: "add",
        diffuse: [0.2, -0.2, 0.4, -0.5],
        edgeColor: [0.4, 0.2, 0, -0.4],
        textureFactor: [-0.5, 0.25, 0.5, -0.25],
        sphereTextureFactor: [0.2, 0.4, 0.6, 0.8],
        toonTextureFactor: [-0.2, -0.4, -0.6, -0.8],
      }),
    ]);
    const state = evaluateMmdMaterialMorphs(data, [0.5])[0];

    expectArrayCloseTo(state.diffuse, [0.9, 0.5, 0.6, 0.75]);
    expectArrayCloseTo(state.edgeColor, [0.3, 0.3, 0.3, 0.8]);
    expectArrayCloseTo(state.textureFactor, [0.75, 1.125, 1.25, 0.875]);
    expectArrayCloseTo(state.sphereTextureFactor, [1.1, 1.2, 1.3, 1.4]);
    expectArrayCloseTo(state.toonTextureFactor, [0.9, 0.8, 0.7, 0.6]);
  });

  it("composes global and individual offsets across multiple morphs", () => {
    const data = createMmdMaterialMorphData(
      [
        withoutTextureFactors(BASE_MATERIAL),
        withoutTextureFactors(BASE_MATERIAL),
      ],
      [
        {
          materialOffsets: [
            createOffset({
              materialIndex: -1,
              operation: "multiply",
              diffuse: [0.5, 0.5, 0.5, 1],
            }),
          ],
        },
        {
          materialOffsets: [
            createOffset({
              materialIndex: 1,
              operation: "add",
              diffuse: [0.1, 0.2, 0.3, -0.25],
            }),
          ],
        },
      ],
    );
    const states = evaluateMmdMaterialMorphs(data, [1, 1]);

    expect(states[0].diffuse).toEqual([0.4, 0.3, 0.2, 1]);
    expect(states[1].diffuse).toEqual([0.5, 0.5, 0.5, 0.75]);
  });
});

describe("attachMmdMaterialMorphRuntime", () => {
  it("syncs body transparency and outline state from runtime weights", () => {
    const bodyMaterial = new MeshToonMaterial({ opacity: 1 });
    bodyMaterial.side = DoubleSide;
    bodyMaterial.userData.mmdMaterial = {
      transparencyMode: "opaque",
      morphAlphaTransparent: true,
      flags: {},
    };
    bodyMaterial.userData.mmdMaterialFactorShader = {
      uniforms: {
        mmdMaterialAmbient: { value: new Color() },
        mmdSpecularColor: { value: new Color() },
        mmdSpecularPower: { value: 1 },
        mmdTextureFactor: { value: new Vector4(1, 1, 1, 1) },
        mmdToonTextureFactor: { value: new Vector4(1, 1, 1, 1) },
      },
    };
    bodyMaterial.userData.mmdSphereShader = {
      uniforms: { mmdSphereFactor: { value: new Vector4(1, 1, 1, 1) } },
    };
    const body = new Mesh(undefined, bodyMaterial);
    body.morphTargetInfluences = [0.5];
    const outlineMaterial = new MeshBasicMaterial();
    outlineMaterial.userData.mmdOutlineMaterial = {
      sourceMaterialIndex: 0,
      flags: {},
      fallback: false,
    };
    const outline = new Mesh(undefined, outlineMaterial);
    const root = new Group();
    root.add(body, outline);
    const model = {
      root,
      mesh: body,
      outlineMeshes: [outline],
    } as unknown as MmdRuntimeModelHandle;
    const data = createData([
      createOffset({
        operation: "add",
        diffuse: [0, 0, 0, -1],
        specular: [0.4, 0.2, 0.6],
        specularPower: 2,
        ambient: [0.2, 0.4, 0.6],
        edgeColor: [0.4, 0.2, 0.1, -1],
        edgeSize: -1,
        textureFactor: [-0.4, -0.2, 0.2, 0.4],
        sphereTextureFactor: [0.2, 0.4, 0.6, 0.8],
        toonTextureFactor: [-0.2, -0.4, -0.6, -0.8],
      }),
    ]);

    attachMmdMaterialMorphRuntime(
      model,
      data,
      syncMmdMaterialStates,
      syncMmdOutlineMaterialStates,
    );

    expect(bodyMaterial.opacity).toBe(0.5);
    expect(bodyMaterial.transparent).toBe(true);
    expect(bodyMaterial.forceSinglePass).toBe(true);
    expect(outlineMaterial.opacity).toBe(0.5);
    expect(outlineMaterial.userData.mmdOutlineMaterial.edgeSize).toBe(1.5);
    expect(
      bodyMaterial.userData.mmdMaterialFactorShader.uniforms.mmdSpecularPower
        .value,
    ).toBe(9);
    expect(
      bodyMaterial.userData.mmdMaterialFactorShader.uniforms.mmdTextureFactor.value.toArray(),
    ).toEqual([0.8, 0.9, 1.1, 1.2]);
    expect(
      bodyMaterial.userData.mmdSphereShader.uniforms.mmdSphereFactor.value.toArray(),
    ).toEqual([1.1, 1.2, 1.3, 1.4]);
    expect(
      bodyMaterial.userData.mmdMaterialFactorShader.uniforms.mmdToonTextureFactor.value.toArray(),
    ).toEqual([0.9, 0.8, 0.7, 0.6]);

    const temporarySurface = new MeshToonMaterial();
    body.material = temporarySurface;
    body.morphTargetInfluences[0] = 1;
    model.syncMaterialMorphs?.();
    expect(bodyMaterial.opacity).toBe(0);
    expect(temporarySurface.opacity).toBe(1);
    body.material = bodyMaterial;

    body.morphTargetInfluences[0] = 0;
    model.syncMaterialMorphs?.();
    expect(bodyMaterial.opacity).toBe(1);
    expect(bodyMaterial.transparent).toBe(false);
    expect(outlineMaterial.opacity).toBe(1);
    expect(outlineMaterial.userData.mmdOutlineMaterial.edgeSize).toBe(2);
  });

  it("uses supplied package sync functions", () => {
    const material = new MeshBasicMaterial();
    const mesh = new Mesh(undefined, material);
    const syncMaterials = vi.fn();
    const syncOutlines = vi.fn();
    const model = { mesh } as unknown as MmdRuntimeModelHandle;

    attachMmdMaterialMorphRuntime(
      model,
      createData([]),
      syncMaterials,
      syncOutlines,
    );

    expect(syncMaterials).toHaveBeenCalledOnce();
    expect(syncOutlines).not.toHaveBeenCalled();
    model.syncMaterialMorphs?.();
    expect(syncMaterials).toHaveBeenCalledOnce();
    mesh.morphTargetInfluences = [1];
    model.syncMaterialMorphs?.();
    expect(syncMaterials).toHaveBeenCalledTimes(2);
  });

  it("syncs an independent render-order proxy by its material index", () => {
    const bodyMaterials = [new MeshBasicMaterial(), new MeshBasicMaterial()];
    const body = new Mesh(undefined, bodyMaterials);
    body.morphTargetInfluences = [1];
    const proxyMaterial = new MeshBasicMaterial();
    proxyMaterial.userData.mmdShadowOnlyRenderProxy = true;
    const proxy = new Mesh(undefined, proxyMaterial);
    proxy.userData.mmdMaterialRenderProxy = { materialIndex: 1 };
    const syncMaterials = vi.fn();
    const model = {
      mesh: body,
      renderOrderMeshes: [proxy],
    } as unknown as MmdRuntimeModelHandle;
    const data = createMmdMaterialMorphData(
      [
        withoutTextureFactors(BASE_MATERIAL),
        withoutTextureFactors(BASE_MATERIAL),
      ],
      [
        {
          materialOffsets: [
            createOffset({
              materialIndex: 1,
              operation: "add",
              diffuse: [0.1, 0.2, 0.3, -0.5],
            }),
          ],
        },
      ],
    );

    attachMmdMaterialMorphRuntime(model, data, syncMaterials, vi.fn());

    expect(syncMaterials).toHaveBeenCalledWith(proxyMaterial, [
      expect.objectContaining({ diffuse: [0.9, 0.8, 0.7, 0.5] }),
    ]);
    expect(proxyMaterial.colorWrite).toBe(false);
    expect(proxyMaterial.depthWrite).toBe(false);
  });

  it("expands direct group and flip weights into material morph weights", () => {
    const material = new MeshBasicMaterial();
    const mesh = new Mesh(undefined, material);
    mesh.morphTargetInfluences = [0, 0, 0];
    const syncMaterials = vi.fn();
    const model = { mesh } as unknown as MmdRuntimeModelHandle;
    const data = createMmdMaterialMorphData(
      [withoutTextureFactors(BASE_MATERIAL)],
      [
        { materialOffsets: [], groupOffsets: [{ morphIndex: 1, weight: 0.5 }] },
        { materialOffsets: [], flipOffsets: [{ morphIndex: 2, weight: 0.5 }] },
        {
          materialOffsets: [
            createOffset({
              operation: "add",
              diffuse: [0.4, 0.2, 0, -0.4],
            }),
          ],
        },
      ],
    );
    attachMmdMaterialMorphRuntime(model, data, syncMaterials, vi.fn());
    syncMaterials.mockClear();

    mesh.morphTargetInfluences[0] = 1;
    model.syncMaterialMorphs?.({ 0: 1 });

    expect(syncMaterials).toHaveBeenCalledWith(
      material,
      expect.arrayContaining([
        expect.objectContaining({ diffuse: [0.9, 0.65, 0.4, 0.9] }),
      ]),
    );

    syncMaterials.mockClear();
    mesh.morphTargetInfluences = [1, 0, 0.5];
    model.syncMaterialMorphs?.({ 0: 1, 2: 0.5 });
    expect(syncMaterials).toHaveBeenCalledWith(
      material,
      expect.arrayContaining([
        // A direct child value is a final override, so it replaces its parent
        // group/flip contribution instead of adding on top of it.
        expect.objectContaining({ diffuse: [1, 0.7, 0.4, 0.8] }),
      ]),
    );
  });
});

function createData(offsets: MmdMaterialMorphOffset[]) {
  return createMmdMaterialMorphData(
    [withoutTextureFactors(BASE_MATERIAL)],
    [{ materialOffsets: offsets }],
  );
}

function withoutTextureFactors(state: MmdMaterialState) {
  const { textureFactor, sphereTextureFactor, toonTextureFactor, ...base } =
    state;
  void textureFactor;
  void sphereTextureFactor;
  void toonTextureFactor;
  return base;
}

function createOffset(
  overrides: Partial<MmdMaterialMorphOffset>,
): MmdMaterialMorphOffset {
  const operation = overrides.operation ?? "add";
  const identity = operation === "multiply" ? 1 : 0;
  return {
    materialIndex: 0,
    operation,
    diffuse: [identity, identity, identity, identity],
    specular: [identity, identity, identity],
    specularPower: identity,
    ambient: [identity, identity, identity],
    edgeColor: [identity, identity, identity, identity],
    edgeSize: identity,
    textureFactor: [identity, identity, identity, identity],
    sphereTextureFactor: [identity, identity, identity, identity],
    toonTextureFactor: [identity, identity, identity, identity],
    ...overrides,
  };
}

function expectArrayCloseTo(
  actual: readonly number[],
  expected: readonly number[],
) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value));
}
