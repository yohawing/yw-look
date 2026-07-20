import { describe, expect, it } from "vitest";
import type { SelectedFile } from "../../../lib/files";
import { mmdLoaderPack } from "../pack";

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

describe("mmdLoaderPack", () => {
  it("creates a pack file request for VMD dropped onto an MMD model", () => {
    expect(
      mmdLoaderPack.createFileRequest?.(vmdFile, {
        currentFile: pmxFile,
        version: 3,
      }),
    ).toEqual({
      packId: "mmd-loader-pack",
      action: "apply-motion",
      file: vmdFile,
      version: 3,
    });
  });

  it("does not claim VMD files without a loaded MMD model", () => {
    expect(
      mmdLoaderPack.createFileRequest?.(vmdFile, {
        currentFile: objFile,
        version: 1,
      }),
    ).toBeNull();
    expect(
      mmdLoaderPack.createFileRequest?.(objFile, {
        currentFile: pmxFile,
        version: 1,
      }),
    ).toBeNull();
  });
});
