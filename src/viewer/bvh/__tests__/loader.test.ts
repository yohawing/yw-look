import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AnimationMixer, Bone, Group, LoopOnce } from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SelectedFile } from "../../../lib/files";

const mocks = vi.hoisted(() => ({
  readBinaryFile: vi.fn(),
}));

vi.mock("../../../lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/files")>()),
  readBinaryFile: mocks.readBinaryFile,
}));

const fixturePath = resolve(
  import.meta.dirname,
  "../../../../tests/fixtures/models/minimal-motion.bvh",
);
const fixtureBytes = readFileSync(fixturePath);
const fixtureText = fixtureBytes.toString("utf8");
const file: SelectedFile = {
  extension: "bvh",
  fileName: "minimal-motion.bvh",
  kind: "motion",
  parentDirectory: "C:\\motions",
  path: "C:\\motions\\minimal-motion.bvh",
};

describe("parseBvhPreview", () => {
  it("creates a playable bone-only motion preview", async () => {
    const { parseBvhPreview } = await import("../loader");

    const result = parseBvhPreview(fixtureText, file.fileName);

    expect(result.object).toBeInstanceOf(Group);
    expect(result.object.userData.motionPreviewRig).toBe(true);
    expect(result.object.getObjectByName("Hips")).toBeInstanceOf(Bone);
    expect(result.object.getObjectByName("Chest")).toBeInstanceOf(Bone);
    expect(result).toMatchObject({
      cleanupUrls: [],
      formatVersion: "BVH",
      assetKind: "motion",
    });
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0].name).toBe("minimal-motion");
    expect(result.clips[0].duration).toBeCloseTo(1 / 30, 6);
    expect(result.clips[0].tracks.map((track) => track.name)).toEqual([
      "Hips.position",
      "Hips.quaternion",
      "Chest.position",
      "Chest.quaternion",
    ]);

    const hips = result.object.getObjectByName("Hips") as Bone;
    const mixer = new AnimationMixer(result.object);
    mixer.clipAction(result.clips[0]).setLoop(LoopOnce, 1).play();
    mixer.update(result.clips[0].duration / 2);
    expect(hips.position.x).toBeCloseTo(0.5, 6);
  });

  it("rejects text without the required BVH sections", async () => {
    const { parseBvhPreview } = await import("../loader");

    expect(() => parseBvhPreview("not a BVH", "broken.bvh")).toThrow(
      "BVH must contain HIERARCHY and MOTION sections.",
    );
  });
});

describe("loadBvhPreviewObject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readBinaryFile.mockResolvedValue(
      fixtureBytes.buffer.slice(
        fixtureBytes.byteOffset,
        fixtureBytes.byteOffset + fixtureBytes.byteLength,
      ),
    );
  });

  it("reads the file and reports decode then scene stages", async () => {
    const onStage = vi.fn();
    const { loadBvhPreviewObject } = await import("../loader");

    const result = await loadBvhPreviewObject(file, { onStage });

    expect(mocks.readBinaryFile).toHaveBeenCalledWith(file.path);
    expect(onStage.mock.calls).toEqual([["decode"], ["scene"]]);
    expect(result.clips[0].duration).toBeCloseTo(1 / 30, 6);
  });

  it("honors an already-aborted load", async () => {
    const controller = new AbortController();
    controller.abort();
    const { loadBvhPreviewObject } = await import("../loader");

    await expect(
      loadBvhPreviewObject(file, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.readBinaryFile).not.toHaveBeenCalled();
  });
});
