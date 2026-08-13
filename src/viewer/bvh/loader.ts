import { Group, type KeyframeTrack, type Skeleton } from "three";
import { BVHLoader } from "three/examples/jsm/loaders/BVHLoader.js";
import { readBinaryFile, type SelectedFile } from "../../lib/files";
import type { LoaderContext } from "../loaderRegistry";
import type { LoadedPreview } from "../types";

function createAbortError(): Error {
  const error = new Error("Motion load was canceled.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function valuesAreFinite(values: ArrayLike<number>): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) {
      return false;
    }
  }
  return true;
}

function animatedBoneName(track: KeyframeTrack): string | null {
  if (track.name.endsWith(".position")) {
    return track.name.slice(0, -".position".length);
  }
  if (track.name.endsWith(".quaternion")) {
    return track.name.slice(0, -".quaternion".length);
  }
  return null;
}

function validateBvhResult(
  skeleton: Skeleton,
  clip: import("three").AnimationClip,
): void {
  if (skeleton.bones.length === 0 || !skeleton.bones[0]) {
    throw new Error("BVH contains no root bone.");
  }
  if (clip.tracks.length === 0) {
    throw new Error("BVH contains no animation tracks.");
  }
  if (!Number.isFinite(clip.duration) || clip.duration < 0) {
    throw new Error("BVH has an invalid animation duration.");
  }

  const boneNameCounts = new Map<string, number>();
  for (const bone of skeleton.bones) {
    boneNameCounts.set(bone.name, (boneNameCounts.get(bone.name) ?? 0) + 1);
  }

  for (const track of clip.tracks) {
    if (
      track.times.length === 0 ||
      !valuesAreFinite(track.times) ||
      !valuesAreFinite(track.values)
    ) {
      throw new Error(`BVH track "${track.name}" contains invalid keyframes.`);
    }
    const boneName = animatedBoneName(track);
    if (!boneName || boneNameCounts.get(boneName) !== 1) {
      throw new Error(
        `BVH track "${track.name}" does not identify one unique bone.`,
      );
    }
  }
}

export function parseBvhPreview(text: string, fileName: string): LoadedPreview {
  if (!/^\s*HIERARCHY(?:\r?\n|\s)/i.test(text) || !/\bMOTION\b/i.test(text)) {
    throw new Error("BVH must contain HIERARCHY and MOTION sections.");
  }

  let parsed: ReturnType<BVHLoader["parse"]>;
  try {
    parsed = new BVHLoader().parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse BVH: ${detail}`, { cause: error });
  }

  validateBvhResult(parsed.skeleton, parsed.clip);
  parsed.clip.name = fileName.replace(/\.bvh$/i, "") || "animation";

  const object = new Group();
  object.name = `${parsed.clip.name} Motion Preview`;
  object.userData.motionPreviewRig = true;
  object.add(parsed.skeleton.bones[0]);

  return {
    object,
    cleanupUrls: [],
    clips: [parsed.clip],
    formatVersion: "BVH",
    assetKind: "motion",
  };
}

export async function loadBvhPreviewObject(
  file: SelectedFile,
  context: LoaderContext = {},
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  throwIfAborted(context.signal);
  reportStage("decode");
  const buffer = await readBinaryFile(file.path);
  throwIfAborted(context.signal);
  const text = new TextDecoder().decode(buffer);
  reportStage("scene");
  const result = parseBvhPreview(text, file.fileName);
  throwIfAborted(context.signal);
  return result;
}
