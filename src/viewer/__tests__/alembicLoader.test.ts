import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnimationMixer, Mesh } from "three";
import type { SelectedFile } from "../../lib/files";

const mocks = vi.hoisted(() => ({
  convertAlembicToPreview: vi.fn(),
}));

vi.mock("../../lib/alembic", () => ({
  convertAlembicToPreview: mocks.convertAlembicToPreview,
}));

import { loadPreviewObject } from "../loaders";

const abcFile: SelectedFile = {
  path: "C:\\cache\\monkey.abc",
  fileName: "monkey.abc",
  extension: "abc",
  kind: "model",
  parentDirectory: "C:\\cache",
};

describe("Alembic preview loader", () => {
  beforeEach(() => {
    mocks.convertAlembicToPreview.mockReset();
  });

  it("converts Alembic preview JSON and returns a static mesh preview", async () => {
    const stages: string[] = [];
    mocks.convertAlembicToPreview.mockResolvedValue(
      JSON.stringify({
        format: "yw-look-alembic-preview-v1",
        meshes: [
          {
            name: "triangle",
            positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
            indices: [0, 1, 2],
            frames: [],
          },
        ],
      }),
    );

    const result = await loadPreviewObject(abcFile, undefined, {
      onStage: (stage) => stages.push(stage),
    });

    expect(mocks.convertAlembicToPreview).toHaveBeenCalledWith(
      "C:\\cache\\monkey.abc",
    );
    expect(result.object.children.some((child) => child instanceof Mesh)).toBe(
      true,
    );
    expect(result.cleanupUrls).toEqual([]);
    expect(result.clips).toEqual([]);
    expect(result.formatVersion).toBe("Alembic static sample 0");
    expect(stages).toEqual(["scan", "decode", "scene", "gpu"]);
  });

  it("maps Alembic geometry cache samples to morph target animation", async () => {
    mocks.convertAlembicToPreview.mockResolvedValue(
      JSON.stringify({
        format: "yw-look-alembic-preview-v1",
        meshes: [
          {
            name: "bad.name/[triangle]",
            positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
            indices: [0, 1, 2],
            frames: [
              {
                time: 0.5,
                positions: [0, 0, 0, 1, 0, 0, 0, 2, 0],
              },
              {
                time: 1,
                positions: [0, 0, 0, 1, 0, 0, 0, 3, 0],
              },
            ],
          },
        ],
      }),
    );

    const result = await loadPreviewObject(abcFile);
    const mesh = result.object.children.find(
      (child): child is Mesh => child instanceof Mesh,
    );

    expect(mesh?.geometry.morphAttributes.position).toHaveLength(2);
    expect(mesh?.morphTargetInfluences).toEqual([0, 0]);
    expect(mesh?.name).toBe("AlembicMesh_1");
    expect(mesh?.userData.sourceName).toBe("bad.name/[triangle]");
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0].name).toBe("Alembic Geometry Cache");
    expect(result.clips[0].duration).toBe(1);
    expect(result.formatVersion).toBe("Alembic geometry cache");

    const mixer = new AnimationMixer(result.object);
    mixer.clipAction(result.clips[0]).play();
    mixer.setTime(0.75);

    expect(mesh?.morphTargetInfluences?.[0]).toBeCloseTo(0.5);
    expect(mesh?.morphTargetInfluences?.[1]).toBeCloseTo(0.5);
  });

  it("fails clearly when the converter returns no renderable mesh", async () => {
    mocks.convertAlembicToPreview.mockResolvedValue(
      JSON.stringify({
        format: "yw-look-alembic-preview-v1",
        meshes: [],
      }),
    );

    await expect(loadPreviewObject(abcFile)).rejects.toThrow(
      "Alembic conversion returned no renderable mesh data.",
    );
  });

  it("fails clearly when the helper returns malformed preview JSON", async () => {
    mocks.convertAlembicToPreview.mockResolvedValue("# empty\n");

    await expect(loadPreviewObject(abcFile)).rejects.toThrow(
      "Alembic helper returned malformed preview JSON.",
    );
  });
});
