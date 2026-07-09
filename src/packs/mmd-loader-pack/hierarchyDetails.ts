import type { MmdBoneEntry, ObjectInfo } from "../../types/viewer";

export type MmdHierarchyDetailRow = {
  id: string;
  label: string;
  value: string | number;
  tone?: "muted";
  mono?: boolean;
};

export type MmdBoneDetails = {
  title: string;
  rows: MmdHierarchyDetailRow[];
};

function fmtMmdNumber(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function fmtMmdVec(value: readonly number[] | null): string {
  return value ? value.map(fmtMmdNumber).join(", ") : "none";
}

function fmtMmdFlags(flags: Record<string, boolean> | null): string {
  if (!flags) return "none";
  const enabled = Object.entries(flags)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  return enabled.length > 0 ? enabled.join(", ") : "none";
}

export function formatMmdMorphTargetMeta(
  target: ObjectInfo["morphTargets"][number],
): string | null {
  const { mmd } = target;
  if (!mmd) return null;
  const parts = [
    mmd.boneOffsetCount > 0 ? `bone:${mmd.boneOffsetCount}` : null,
    mmd.groupOffsetCount > 0 ? `group:${mmd.groupOffsetCount}` : null,
    mmd.flipOffsetCount > 0 ? `flip:${mmd.flipOffsetCount}` : null,
    mmd.impulseOffsetCount > 0 ? `impulse:${mmd.impulseOffsetCount}` : null,
  ].filter((part): part is string => part !== null);
  const offsets = parts.length > 0 ? parts.join(" ") : "offsets:none";
  const englishName =
    mmd.englishName && mmd.englishName !== target.name
      ? `${mmd.englishName} · `
      : "";
  return `${mmd.type ?? "mmd"} · ${englishName}${offsets}`;
}

export function getMmdBoneDetails(
  bone: MmdBoneEntry | null,
): MmdBoneDetails | null {
  if (!bone) return null;

  const rows: Array<MmdHierarchyDetailRow | false | null | undefined> = [
    bone.boneIndex !== null && {
      id: "index",
      label: "Index",
      value: bone.boneIndex,
      mono: true,
    },
    bone.name
      ? {
          id: "mmd-name",
          label: "MMD Name",
          value: bone.name,
          mono: true,
        }
      : null,
    bone.englishName && bone.englishName !== bone.name
      ? {
          id: "english",
          label: "English",
          value: bone.englishName,
          tone: "muted",
          mono: true,
        }
      : null,
    {
      id: "parent",
      label: "Parent",
      value:
        bone.parentIndex !== null && bone.parentIndex >= 0
          ? `${bone.parentIndex}${bone.parentName ? ` · ${bone.parentName}` : ""}`
          : "none",
      tone: "muted",
      mono: true,
    },
    {
      id: "rest-pos",
      label: "Rest Pos",
      value: fmtMmdVec(bone.restPosition),
      mono: true,
    },
    bone.layer !== null && {
      id: "layer",
      label: "Layer",
      value: bone.layer,
      mono: true,
    },
    bone.appendTransform && {
      id: "append",
      label: "Append",
      value: `${bone.appendTransform.parentIndex}${
        bone.appendTransform.parentName
          ? ` · ${bone.appendTransform.parentName}`
          : ""
      } x${fmtMmdNumber(bone.appendTransform.weight)}`,
      mono: true,
    },
    {
      id: "flags",
      label: "Flags",
      value: fmtMmdFlags(bone.flags),
      mono: true,
    },
    bone.ik && {
      id: "ik-role",
      label: "IK Role",
      value: bone.ik.roles.join(", "),
      mono: true,
    },
    bone.ik && {
      id: "ik-chain",
      label: "IK Chain",
      value: `goal:${bone.ik.goalBoneIndex ?? "?"} target:${
        bone.ik.effectorBoneIndex ?? "?"
      } links:${bone.ik.linkCount ?? "?"}`,
      mono: true,
    },
    bone.ik &&
      (bone.ik.iterationCount !== null ||
        bone.ik.maxAnglePerIteration !== null) && {
        id: "ik-solve",
        label: "IK Solve",
        value: `iter:${bone.ik.iterationCount ?? "?"} angle:${
          bone.ik.maxAnglePerIteration !== null
            ? fmtMmdNumber(bone.ik.maxAnglePerIteration)
            : "?"
        }`,
        mono: true,
      },
    bone.ik &&
      bone.ik.limitKinds.length > 0 && {
        id: "ik-limits",
        label: "IK Limits",
        value: bone.ik.limitKinds.join(", "),
        mono: true,
      },
  ];

  return {
    title: "MMD Bone",
    rows: rows.filter((row): row is MmdHierarchyDetailRow => Boolean(row)),
  };
}
