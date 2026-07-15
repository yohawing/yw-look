import {
  Bone,
  BoxGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Uint16BufferAttribute,
  Vector3,
} from "three";
import type {
  MmdAnimationHandle,
  MmdRuntimeModelHandle,
} from "../../types/viewer";

type PreviewBone = {
  name: string;
  parent: string | null;
  position: readonly [number, number, number];
};

type RuntimeConstructor = new (options: {
  frameRate: number;
  physics: "none";
}) => NonNullable<MmdRuntimeModelHandle["runtime"]>;

const PREVIEW_BONES: readonly PreviewBone[] = [
  { name: "全ての親", parent: null, position: [0, 0, 0] },
  { name: "センター", parent: "全ての親", position: [0, 8, 0] },
  { name: "グルーブ", parent: "センター", position: [0, 9, 0] },
  { name: "下半身", parent: "グルーブ", position: [0, 10, 0] },
  { name: "上半身", parent: "グルーブ", position: [0, 10.5, 0] },
  { name: "上半身2", parent: "上半身", position: [0, 12.6, 0] },
  { name: "首", parent: "上半身2", position: [0, 14.4, 0] },
  { name: "頭", parent: "首", position: [0, 15.8, 0] },
  { name: "左目", parent: "頭", position: [0.35, 16.05, -0.35] },
  { name: "右目", parent: "頭", position: [-0.35, 16.05, -0.35] },
  { name: "両目", parent: "頭", position: [0, 16.05, -0.35] },
  { name: "左肩", parent: "上半身2", position: [1.15, 14.05, 0] },
  { name: "左腕", parent: "左肩", position: [2.25, 13.75, 0] },
  { name: "左ひじ", parent: "左腕", position: [4.05, 12.65, 0] },
  { name: "左手首", parent: "左ひじ", position: [5.55, 11.75, 0] },
  { name: "右肩", parent: "上半身2", position: [-1.15, 14.05, 0] },
  { name: "右腕", parent: "右肩", position: [-2.25, 13.75, 0] },
  { name: "右ひじ", parent: "右腕", position: [-4.05, 12.65, 0] },
  { name: "右手首", parent: "右ひじ", position: [-5.55, 11.75, 0] },
  { name: "左足", parent: "下半身", position: [0.9, 9.65, 0] },
  { name: "左ひざ", parent: "左足", position: [0.9, 5.7, 0.1] },
  { name: "左足首", parent: "左ひざ", position: [0.9, 1.65, 0] },
  { name: "左つま先", parent: "左足首", position: [0.9, 0.35, -1.25] },
  { name: "右足", parent: "下半身", position: [-0.9, 9.65, 0] },
  { name: "右ひざ", parent: "右足", position: [-0.9, 5.7, 0.1] },
  { name: "右足首", parent: "右ひざ", position: [-0.9, 1.65, 0] },
  { name: "右つま先", parent: "右足首", position: [-0.9, 0.35, -1.25] },
  { name: "左足ＩＫ", parent: "全ての親", position: [0.9, 1.65, 0] },
  { name: "左つま先ＩＫ", parent: "左足ＩＫ", position: [0.9, 0.35, -1.25] },
  { name: "右足ＩＫ", parent: "全ての親", position: [-0.9, 1.65, 0] },
  { name: "右つま先ＩＫ", parent: "右足ＩＫ", position: [-0.9, 0.35, -1.25] },
] as const;

const IK_BONE_NAMES = new Set([
  "左足ＩＫ",
  "左つま先ＩＫ",
  "右足ＩＫ",
  "右つま先ＩＫ",
]);

function toThreePosition(position: readonly [number, number, number]): Vector3 {
  return new Vector3(position[0], position[1], -position[2]);
}

function createPreviewSkeleton(trackNames: readonly string[]) {
  const definitions: PreviewBone[] = [...PREVIEW_BONES];
  const canonicalNames = new Set(PREVIEW_BONES.map((bone) => bone.name));
  const knownNames = new Set(definitions.map((bone) => bone.name));
  for (const name of trackNames) {
    if (!knownNames.has(name)) {
      definitions.push({ name, parent: "センター", position: [0, 8, 0] });
      knownNames.add(name);
    }
  }

  const bonesByName = new Map<string, Bone>();
  const positionsByName = new Map<string, Vector3>();
  for (const definition of definitions) {
    const bone = new Bone();
    bone.name = definition.name;
    bone.userData.mmdBoneName = definition.name;
    bone.userData.mmdEnglishBoneName = definition.name;
    bone.userData.motionPreviewCanonical = canonicalNames.has(definition.name);
    bonesByName.set(definition.name, bone);
    positionsByName.set(definition.name, toThreePosition(definition.position));
  }

  for (const definition of definitions) {
    const bone = bonesByName.get(definition.name)!;
    const worldPosition = positionsByName.get(definition.name)!;
    const parent = definition.parent
      ? bonesByName.get(definition.parent)
      : undefined;
    if (parent) {
      bone.position
        .copy(worldPosition)
        .sub(positionsByName.get(definition.parent!)!);
      parent.add(bone);
    } else {
      bone.position.copy(worldPosition);
    }
  }

  return {
    bones: definitions.map((definition) => bonesByName.get(definition.name)!),
    bonesByName,
  };
}

function addKurokoGeometry(bones: readonly Bone[]) {
  const material = new MeshBasicMaterial({ color: 0x30343a });
  const up = new Vector3(0, 1, 0);

  for (const bone of bones) {
    if (
      !(bone.parent instanceof Bone) ||
      bone.parent.name === "全ての親" ||
      bone.userData.motionPreviewCanonical !== true ||
      IK_BONE_NAMES.has(bone.name)
    ) {
      continue;
    }
    const length = bone.position.length();
    if (length < 0.2) {
      continue;
    }
    const radius = bone.name === "首" || bone.name === "頭" ? 0.28 : 0.16;
    const segment = new Mesh(
      new CylinderGeometry(radius, radius, length, 8),
      material,
    );
    segment.name = `${bone.name} 黒子`;
    segment.position.copy(bone.position).multiplyScalar(0.5);
    segment.quaternion.copy(
      new Quaternion().setFromUnitVectors(
        up,
        bone.position.clone().normalize(),
      ),
    );
    segment.userData.motionPreviewKuroko = true;
    bone.parent.add(segment);
  }

  for (const bone of bones) {
    if (
      bone.userData.motionPreviewCanonical !== true ||
      IK_BONE_NAMES.has(bone.name) ||
      bone.name === "全ての親"
    ) {
      continue;
    }
    const radius = bone.name === "頭" ? 0.72 : 0.22;
    const joint = new Mesh(new SphereGeometry(radius, 12, 8), material);
    joint.name = `${bone.name} 黒子ジョイント`;
    joint.userData.motionPreviewKuroko = true;
    bone.add(joint);
  }
}

function boneIndex(bonesByName: ReadonlyMap<string, Bone>, name: string) {
  const bone = bonesByName.get(name);
  if (!bone) return -1;
  return [...bonesByName.values()].indexOf(bone);
}

function createIkChains(bonesByName: ReadonlyMap<string, Bone>) {
  const legChain = (side: "左" | "右") => ({
    goalBoneIndex: boneIndex(bonesByName, `${side}足ＩＫ`),
    effectorBoneIndex: boneIndex(bonesByName, `${side}足首`),
    iterationCount: 20,
    maxAnglePerIteration: Math.PI / 4,
    links: [
      {
        boneIndex: boneIndex(bonesByName, `${side}ひざ`),
        enabled: true,
        limitsKind: "pmdKnee",
        angleLimit: {
          minimumAngle: [-Math.PI, 0, 0],
          maximumAngle: [-0.002, 0, 0],
        },
      },
      { boneIndex: boneIndex(bonesByName, `${side}足`), enabled: true },
    ],
  });
  const toeChain = (side: "左" | "右") => ({
    goalBoneIndex: boneIndex(bonesByName, `${side}つま先ＩＫ`),
    effectorBoneIndex: boneIndex(bonesByName, `${side}つま先`),
    iterationCount: 4,
    maxAnglePerIteration: Math.PI / 4,
    links: [
      { boneIndex: boneIndex(bonesByName, `${side}足首`), enabled: true },
    ],
  });
  return [legChain("左"), toeChain("左"), legChain("右"), toeChain("右")];
}

export function createVmdMotionPreviewRig(
  animation: MmdAnimationHandle & { boneTracks?: Record<string, unknown> },
  Runtime: RuntimeConstructor,
): {
  object: SkinnedMesh;
  mmdModel: MmdRuntimeModelHandle;
} {
  const { bones, bonesByName } = createPreviewSkeleton(
    Object.keys(animation.boneTracks ?? {}),
  );
  const skeleton = new Skeleton(bones);
  const runtimeGeometry = new BoxGeometry(0.001, 0.001, 0.001);
  const runtimeVertexCount = runtimeGeometry.getAttribute("position").count;
  runtimeGeometry.setAttribute(
    "skinIndex",
    new Uint16BufferAttribute(new Uint16Array(runtimeVertexCount * 4), 4),
  );
  const skinWeights = new Float32Array(runtimeVertexCount * 4);
  for (let index = 0; index < runtimeVertexCount; index += 1) {
    skinWeights[index * 4] = 1;
  }
  runtimeGeometry.setAttribute(
    "skinWeight",
    new Float32BufferAttribute(skinWeights, 4),
  );
  const mesh = new SkinnedMesh(
    runtimeGeometry,
    new MeshBasicMaterial({ color: 0x000000, visible: false }),
  );
  mesh.name = "VMD 黒子モデル";
  mesh.add(bones[0]);
  mesh.bind(skeleton);
  mesh.userData.mmdIkChains = createIkChains(bonesByName);
  mesh.userData.motionPreviewRig = true;
  addKurokoGeometry(bones);

  const runtime = new Runtime({ frameRate: 30, physics: "none" });
  runtime.setAnimation(animation, mesh);
  runtime.tick(0, { mesh, ik: true, physics: false });

  return {
    object: mesh,
    mmdModel: { mesh, runtime },
  };
}
