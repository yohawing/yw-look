import { describe, expect, it } from "vitest";
import {
  inspectAsset,
  listSupportedSiblings,
  readBinaryFile,
  registerBrowserFile,
  resolveSelectedFile,
} from "../files";

describe("browser local files", () => {
  it("registers a browser-selected asset and reads it through readBinaryFile", async () => {
    const source = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);
    const file = new File([source], "sample.glb", {
      type: "model/gltf-binary",
      lastModified: 1_700_000_000_000,
    });

    const selected = registerBrowserFile(file);

    expect(selected).toMatchObject({
      fileName: "sample.glb",
      extension: "glb",
      kind: "model",
      parentDirectory: "browser-local://",
    });
    expect(selected.path.startsWith("browser-local://")).toBe(true);
    expect(new Uint8Array(await readBinaryFile(selected.path))).toEqual(source);
  });

  it("resolves browser-local inspection and sibling listing without Tauri IPC", async () => {
    const file = new File(["motion"], "walk.vmd", {
      lastModified: 1_700_000_000_000,
    });
    const selected = registerBrowserFile(file);

    await expect(resolveSelectedFile(selected.path)).resolves.toMatchObject({
      fileName: "walk.vmd",
      extension: "vmd",
      kind: "motion",
    });
    await expect(listSupportedSiblings(selected.path)).resolves.toMatchObject({
      currentIndex: 0,
      files: [selected],
    });
    await expect(inspectAsset(selected.path)).resolves.toMatchObject({
      fileName: "walk.vmd",
      extension: "vmd",
      kind: "motion",
      fileSizeBytes: 6,
      previewImplemented: true,
    });
  });

  it("rejects unsupported browser-local assets", () => {
    expect(() => registerBrowserFile(new File(["x"], "notes.txt"))).toThrow(
      "unsupported file extension: txt",
    );
  });
});
