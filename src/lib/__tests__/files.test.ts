import { invoke, isTauri } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  inspectAsset,
  listSupportedSiblings,
  openFileDialog,
  readBinaryFile,
  registerBrowserFile,
  resolveSelectedFile,
} from "../files";

const invokeMock = vi.mocked(invoke);
const isTauriMock = vi.mocked(isTauri);

describe("browser local files", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(null);
    isTauriMock.mockReturnValue(false);
  });

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

  it("rejects Tauri IPC errors as normalized AppError objects", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockRejectedValue({
      kind: "io",
      message: "Failed to open file dialog.",
    });

    await expect(openFileDialog()).rejects.toEqual({
      kind: "io",
      message: "Failed to open file dialog.",
    });
    expect(invokeMock).toHaveBeenCalledWith("open_file_dialog");
  });
});
