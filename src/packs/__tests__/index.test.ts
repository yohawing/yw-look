import { describe, expect, it } from "vitest";
import type { SelectedFile } from "../../lib/files";
import { createPackFileRequest } from "../index";

const pmxFile: SelectedFile = {
  path: "C:\\mmd\\model.pmx",
  fileName: "model.pmx",
  extension: "pmx",
  kind: "model",
  parentDirectory: "C:\\mmd",
};

const objFile: SelectedFile = {
  path: "C:\\models\\mesh.obj",
  fileName: "mesh.obj",
  extension: "obj",
  kind: "model",
  parentDirectory: "C:\\models",
};

const vmdFile: SelectedFile = {
  path: "C:\\mmd\\motion.vmd",
  fileName: "motion.vmd",
  extension: "vmd",
  kind: "motion",
  parentDirectory: "C:\\mmd",
};

describe("createPackFileRequest", () => {
  it("dispatches VMD files dropped onto an MMD model to the MMD pack", () => {
    expect(
      createPackFileRequest(vmdFile, {
        currentFile: pmxFile,
        version: 4,
      }),
    ).toEqual({
      packId: "mmd-loader-pack",
      action: "apply-motion",
      file: vmdFile,
      version: 4,
    });
  });

  it("returns null when no pack claims the dropped file", () => {
    expect(
      createPackFileRequest(vmdFile, {
        currentFile: objFile,
        version: 1,
      }),
    ).toBeNull();
    expect(
      createPackFileRequest(objFile, {
        currentFile: pmxFile,
        version: 1,
      }),
    ).toBeNull();
  });
});
