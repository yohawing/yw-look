import type { Material, Mesh, Object3D } from "three";
import type { MmdRuntimeModelHandle } from "../../types/viewer";
import { syncMmdMaterialRenderStates } from "./userData";

export type MmdMaterialState = {
  diffuse: [number, number, number, number];
  specular: [number, number, number];
  specularPower: number;
  ambient: [number, number, number];
  edgeColor: [number, number, number, number];
  edgeSize: number;
  textureFactor: [number, number, number, number];
  sphereTextureFactor: [number, number, number, number];
  toonTextureFactor: [number, number, number, number];
};

export type MmdMaterialMorphOffset = MmdMaterialState & {
  materialIndex: number;
  operation: "multiply" | "add";
};

export type MmdMaterialMorph = {
  materialOffsets: MmdMaterialMorphOffset[];
  groupOffsets?: Array<{ morphIndex: number; weight: number }>;
  flipOffsets?: Array<{ morphIndex: number; weight: number }>;
};

export type MmdMaterialMorphData = {
  materials: MmdMaterialState[];
  morphs: MmdMaterialMorph[];
};

type MaterialStateSync = (
  materials: Material | Material[],
  states: readonly MmdMaterialState[],
) => void;

const MATERIAL_VECTOR_KEYS = [
  "diffuse",
  "specular",
  "ambient",
  "edgeColor",
  "textureFactor",
  "sphereTextureFactor",
  "toonTextureFactor",
] as const;

const MATERIAL_SCALAR_KEYS = ["specularPower", "edgeSize"] as const;

export function createMmdMaterialMorphData(
  materials: readonly Omit<
    MmdMaterialState,
    "textureFactor" | "sphereTextureFactor" | "toonTextureFactor"
  >[],
  morphs: readonly MmdMaterialMorph[],
): MmdMaterialMorphData {
  return {
    materials: materials.map((material) => ({
      diffuse: [...material.diffuse],
      specular: [...material.specular],
      specularPower: material.specularPower,
      ambient: [...material.ambient],
      edgeColor: [...material.edgeColor],
      edgeSize: material.edgeSize,
      textureFactor: [1, 1, 1, 1],
      sphereTextureFactor: [1, 1, 1, 1],
      toonTextureFactor: [1, 1, 1, 1],
    })),
    morphs: morphs.map((morph) => ({
      groupOffsets: morph.groupOffsets?.map((offset) => ({ ...offset })),
      flipOffsets: morph.flipOffsets?.map((offset) => ({ ...offset })),
      materialOffsets: morph.materialOffsets.map((offset) => ({
        ...offset,
        diffuse: [...offset.diffuse],
        specular: [...offset.specular],
        ambient: [...offset.ambient],
        edgeColor: [...offset.edgeColor],
        textureFactor: [...offset.textureFactor],
        sphereTextureFactor: [...offset.sphereTextureFactor],
        toonTextureFactor: [...offset.toonTextureFactor],
      })),
    })),
  };
}

export function evaluateMmdMaterialMorphs(
  data: MmdMaterialMorphData,
  weights: readonly number[],
): MmdMaterialState[] {
  return createMmdMaterialMorphEvaluator(data)(weights);
}

function createMmdMaterialMorphEvaluator(data: MmdMaterialMorphData) {
  const states = data.materials.map(cloneMaterialState);
  const multipliers = data.materials.map(createIdentityMaterialState);
  const additions = data.materials.map(createZeroMaterialState);

  return (weights: readonly number[]): MmdMaterialState[] => {
    for (let index = 0; index < states.length; index += 1) {
      copyMaterialState(states[index], data.materials[index]);
      resetMaterialState(multipliers[index], 1);
      resetMaterialState(additions[index], 0);
    }

    for (let morphIndex = 0; morphIndex < data.morphs.length; morphIndex += 1) {
      const morph = data.morphs[morphIndex];
      const weight = weights[morphIndex] ?? 0;
      if (weight === 0 || !Number.isFinite(weight)) continue;
      for (const offset of morph.materialOffsets) {
        const first = offset.materialIndex === -1 ? 0 : offset.materialIndex;
        const end = offset.materialIndex === -1 ? states.length : first + 1;
        for (
          let materialIndex = first;
          materialIndex < end;
          materialIndex += 1
        ) {
          if (!states[materialIndex]) continue;
          accumulateOffset(
            offset.operation === "multiply"
              ? multipliers[materialIndex]
              : additions[materialIndex],
            offset,
            weight,
          );
        }
      }
    }

    for (let index = 0; index < states.length; index += 1) {
      combineMaterialState(states[index], multipliers[index], additions[index]);
    }
    return states;
  };
}

export function attachMmdMaterialMorphRuntime(
  model: MmdRuntimeModelHandle,
  data: MmdMaterialMorphData,
  syncMaterials: MaterialStateSync,
  syncOutlines: MaterialStateSync,
): void {
  const bodyMaterial = (model.mesh as Partial<Mesh>).material;
  const bodyMaterials = new Set(
    bodyMaterial
      ? Array.isArray(bodyMaterial)
        ? bodyMaterial
        : [bodyMaterial]
      : [],
  );
  const renderOrderMaterials = (model.renderOrderMeshes ?? []).flatMap(
    (proxy) => {
      const material = (proxy as Partial<Mesh>).material;
      if (!material) return [];
      const materialIndex = readRenderOrderMaterialIndex(proxy);
      return (Array.isArray(material) ? material : [material]).map((entry) => ({
        material: entry,
        materialIndex,
      }));
    },
  );
  const outlineMaterials = (model.outlineMeshes ?? []).flatMap((outline) => {
    const material = (outline as Partial<Mesh>).material;
    return material ? [material] : [];
  });
  const evaluate = createMmdMaterialMorphEvaluator(data);
  const runtimeWeights = Array.from(readMorphWeights(model.mesh));
  let lastWeights: number[] | null = null;

  model.syncMaterialMorphs = (directWeights) => {
    const meshWeights = readMorphWeights(model.mesh);
    const weights = directWeights
      ? resolveDirectMorphWeights(
          data,
          meshWeights,
          runtimeWeights,
          directWeights,
        )
      : meshWeights;
    if (!directWeights) copyWeights(runtimeWeights, meshWeights);
    if (lastWeights && weightsEqual(lastWeights, weights)) return;
    if (lastWeights) copyWeights(lastWeights, weights);
    else lastWeights = Array.from(weights);
    const states = evaluate(weights);
    if (bodyMaterial) syncMaterials(bodyMaterial, states);
    for (const { material, materialIndex } of renderOrderMaterials) {
      if (bodyMaterials.has(material)) continue;
      const state = states[materialIndex];
      if (!state) continue;
      syncMaterials(material, [state]);
      if (material.userData.mmdShadowOnlyRenderProxy === true) {
        material.colorWrite = false;
        material.depthWrite = false;
      }
    }
    for (const material of outlineMaterials) {
      syncOutlines(material, states);
    }
    syncMmdMaterialRenderStates(model.root ?? model.mesh);
  };
  model.syncMaterialMorphs();
}

export function syncMmdMaterialMorphRuntime(
  model: MmdRuntimeModelHandle,
): void {
  model.syncMaterialMorphs?.();
  if (!model.syncMaterialMorphs) {
    syncMmdMaterialRenderStates(model.root ?? model.mesh);
  }
}

function readMorphWeights(mesh: Object3D): readonly number[] {
  return (mesh as Partial<Mesh>).morphTargetInfluences ?? [];
}

function readRenderOrderMaterialIndex(proxy: Object3D): number {
  const value = proxy.userData.mmdMaterialRenderProxy?.materialIndex;
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function weightsEqual(previous: readonly number[], next: readonly number[]) {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) return false;
  }
  return true;
}

function copyWeights(target: number[], source: readonly number[]) {
  target.length = source.length;
  for (let index = 0; index < source.length; index += 1) {
    target[index] = source[index];
  }
}

function resolveDirectMorphWeights(
  data: MmdMaterialMorphData,
  meshWeights: readonly number[],
  runtimeWeights: readonly number[],
  directWeights: Readonly<Record<number, number>>,
): number[] {
  const effective = Array.from(meshWeights);
  const directIndices = new Set(
    Object.keys(directWeights).map((index) => Number(index)),
  );

  for (const morphIndex of directIndices) {
    const directWeight = directWeights[morphIndex];
    if (!Number.isFinite(directWeight)) continue;
    const runtimeWeight = runtimeWeights[morphIndex] ?? 0;
    expandDirectGroupWeight(
      data,
      effective,
      morphIndex,
      directWeight - runtimeWeight,
      directIndices,
      new Set(),
    );
  }
  return effective;
}

function expandDirectGroupWeight(
  data: MmdMaterialMorphData,
  effective: number[],
  morphIndex: number,
  delta: number,
  directIndices: ReadonlySet<number>,
  path: Set<number>,
) {
  if (delta === 0 || path.has(morphIndex)) return;
  const morph = data.morphs[morphIndex];
  const offsets = morph?.flipOffsets ?? morph?.groupOffsets ?? [];
  if (offsets.length === 0) return;
  path.add(morphIndex);
  for (const offset of offsets) {
    if (directIndices.has(offset.morphIndex)) continue;
    const contribution = delta * offset.weight;
    effective[offset.morphIndex] =
      (effective[offset.morphIndex] ?? 0) + contribution;
    expandDirectGroupWeight(
      data,
      effective,
      offset.morphIndex,
      contribution,
      directIndices,
      path,
    );
  }
  path.delete(morphIndex);
}

function accumulateOffset(
  target: MmdMaterialState,
  offset: MmdMaterialMorphOffset,
  weight: number,
) {
  for (const key of MATERIAL_VECTOR_KEYS) {
    const targetValues = target[key];
    const offsetValues = offset[key];
    for (let index = 0; index < targetValues.length; index += 1) {
      if (offset.operation === "multiply") {
        targetValues[index] *= 1 + (offsetValues[index] - 1) * weight;
      } else {
        targetValues[index] += offsetValues[index] * weight;
      }
    }
  }
  for (const key of MATERIAL_SCALAR_KEYS) {
    if (offset.operation === "multiply") {
      target[key] *= 1 + (offset[key] - 1) * weight;
    } else {
      target[key] += offset[key] * weight;
    }
  }
}

function combineMaterialState(
  base: MmdMaterialState,
  multiplier: MmdMaterialState,
  addition: MmdMaterialState,
): MmdMaterialState {
  for (const key of MATERIAL_VECTOR_KEYS) {
    for (let index = 0; index < base[key].length; index += 1) {
      base[key][index] =
        base[key][index] * multiplier[key][index] + addition[key][index];
    }
  }
  for (const key of MATERIAL_SCALAR_KEYS) {
    base[key] = base[key] * multiplier[key] + addition[key];
  }
  return base;
}

function cloneMaterialState(state: MmdMaterialState): MmdMaterialState {
  return {
    diffuse: [...state.diffuse],
    specular: [...state.specular],
    specularPower: state.specularPower,
    ambient: [...state.ambient],
    edgeColor: [...state.edgeColor],
    edgeSize: state.edgeSize,
    textureFactor: [...state.textureFactor],
    sphereTextureFactor: [...state.sphereTextureFactor],
    toonTextureFactor: [...state.toonTextureFactor],
  };
}

function copyMaterialState(target: MmdMaterialState, source: MmdMaterialState) {
  for (const key of MATERIAL_VECTOR_KEYS) {
    const targetValues = target[key];
    const sourceValues = source[key];
    for (let index = 0; index < targetValues.length; index += 1) {
      targetValues[index] = sourceValues[index];
    }
  }
  for (const key of MATERIAL_SCALAR_KEYS) target[key] = source[key];
}

function resetMaterialState(target: MmdMaterialState, value: number) {
  for (const key of MATERIAL_VECTOR_KEYS) target[key].fill(value);
  for (const key of MATERIAL_SCALAR_KEYS) target[key] = value;
}

function createIdentityMaterialState(): MmdMaterialState {
  return {
    diffuse: [1, 1, 1, 1],
    specular: [1, 1, 1],
    specularPower: 1,
    ambient: [1, 1, 1],
    edgeColor: [1, 1, 1, 1],
    edgeSize: 1,
    textureFactor: [1, 1, 1, 1],
    sphereTextureFactor: [1, 1, 1, 1],
    toonTextureFactor: [1, 1, 1, 1],
  };
}

function createZeroMaterialState(): MmdMaterialState {
  return {
    diffuse: [0, 0, 0, 0],
    specular: [0, 0, 0],
    specularPower: 0,
    ambient: [0, 0, 0],
    edgeColor: [0, 0, 0, 0],
    edgeSize: 0,
    textureFactor: [0, 0, 0, 0],
    sphereTextureFactor: [0, 0, 0, 0],
    toonTextureFactor: [0, 0, 0, 0],
  };
}
