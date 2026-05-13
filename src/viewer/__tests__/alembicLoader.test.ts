import { beforeEach, describe, expect, it, vi } from "vitest";
import { Mesh } from "three";
import type { SelectedFile } from "../../lib/files";

const mocks = vi.hoisted(() => ({
  convertAlembicToObj: vi.fn(),
}));

vi.mock("../../lib/alembic", () => ({
  convertAlembicToObj: mocks.convertAlembicToObj,
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
    mocks.convertAlembicToObj.mockReset();
  });

  it("converts Alembic to OBJ and returns a static mesh preview", async () => {
    const stages: string[] = [];
    mocks.convertAlembicToObj.mockResolvedValue(
      [
        "# yw-look Alembic static preview OBJ",
        "o triangle",
        "v 0 0 0",
        "v 1 0 0",
        "v 0 1 0",
        "f 1 2 3",
      ].join("\n"),
    );

    const result = await loadPreviewObject(abcFile, undefined, {
      onStage: (stage) => stages.push(stage),
    });

    expect(mocks.convertAlembicToObj).toHaveBeenCalledWith(
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

  it("fails clearly when the converter returns no renderable mesh", async () => {
    mocks.convertAlembicToObj.mockResolvedValue("# empty\n");

    await expect(loadPreviewObject(abcFile)).rejects.toThrow(
      "Alembic conversion returned no renderable mesh data.",
    );
  });
});
