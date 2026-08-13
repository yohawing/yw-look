import { invoke, isTauri } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import formatSupport from "../../formatSupport.json";
import {
  inspectAsset,
  listSupportedSiblings,
  loadFormatSupport,
  openFileDialog,
  readBinaryFile,
  readBinaryFilePrefix,
  registerBrowserFile,
  registerBrowserFiles,
  resolveSelectedFile,
  selectPrimaryFile,
} from "../files";

import type { SelectedFile } from "../files";

function selected(path: string): SelectedFile {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return {
    path,
    fileName,
    extension,
    kind: extension === "png" ? "texture" : "model",
    parentDirectory: path.slice(
      0,
      Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")),
    ),
  };
}

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
    });
    expect(selected.path.startsWith("browser-local://")).toBe(true);
    expect(selected.parentDirectory).toMatch(/^browser-local:\/\/[^/]+$/);
    expect(new Uint8Array(await readBinaryFile(selected.path))).toEqual(source);
    expect(
      new Uint8Array(await readBinaryFilePrefix(selected.path, 2)),
    ).toEqual(source.slice(0, 2));
  });

  it("reads Tauri file prefixes through raw IPC", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValueOnce(new Uint8Array([1, 2, 3]).buffer);

    await expect(
      readBinaryFilePrefix("C:\\assets\\huge.usda", 65536),
    ).resolves.toBeInstanceOf(ArrayBuffer);
    expect(invokeMock).toHaveBeenCalledWith("read_binary_file_prefix", {
      path: "C:\\assets\\huge.usda",
      maxBytes: 65536,
    });
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

  it("uses manifest preview support for browser-local inspection", async () => {
    const file = new File(["#usda 1.0"], "scene.usda");
    const selected = registerBrowserFile(file);

    expect(formatSupport.model).toContain("usda");
    expect(formatSupport.previewImplemented).not.toContain("usda");
    await expect(inspectAsset(selected.path)).resolves.toMatchObject({
      extension: "usda",
      kind: "model",
      previewImplemented: false,
    });
  });

  it("rejects unsupported browser-local assets", () => {
    expect(() => registerBrowserFile(new File(["x"], "notes.txt"))).toThrow(
      "unsupported file extension: txt",
    );
  });

  it("classifies model, texture, and motion browser-local assets from the manifest", () => {
    const model = registerBrowserFile(new File(["m"], "scene.glb"));
    const texture = registerBrowserFile(new File(["t"], "albedo.png"));
    const motion = registerBrowserFile(new File(["v"], "walk.vmd"));

    expect(model.kind).toBe("model");
    expect(texture.kind).toBe("texture");
    expect(motion.kind).toBe("motion");
  });

  it("keeps relative paths for files registered in one browser selection", () => {
    const root = new File(["#usda 1.0"], "scene.usda");
    const layer = new File(["#usda 1.0"], "geometry.usda");
    const files = registerBrowserFiles([
      { file: layer, relativePath: "scene/layers/geometry.usda" },
      { file: root, relativePath: "scene/scene.usda" },
    ]);

    expect(files[0].path).toMatch(/\/scene\/layers\/geometry\.usda$/);
    expect(files[1].path).toMatch(/\/scene\/scene\.usda$/);
    expect(files[0].path.split("/").slice(0, 3)).toEqual(
      files[1].path.split("/").slice(0, 3),
    );
  });

  it("selects a shallow USD root independently of input order", () => {
    const root = selected("C:\\assets\\scene\\scene.usda");
    const layer = selected("C:\\assets\\scene\\layers\\geometry.usda");
    const payload = selected("C:\\assets\\scene\\payloads\\hero.usdc");
    const texture = selected("C:\\assets\\scene\\textures\\albedo.png");

    expect(selectPrimaryFile([layer, texture, payload, root])).toEqual(root);
    expect(selectPrimaryFile([root, payload, layer, texture])).toEqual(root);
  });

  it("uses parent-name and extension tie-breakers for USD roots", () => {
    const namedForParent = selected("C:\\assets\\shot\\shot.usdc");
    const genericUsda = selected("C:\\assets\\shot\\root.usda");
    expect(selectPrimaryFile([genericUsda, namedForParent])).toEqual(
      namedForParent,
    );

    const genericUsd = selected("C:\\assets\\shot\\root.usd");
    expect(selectPrimaryFile([genericUsda, genericUsd])).toEqual(genericUsd);
  });

  it("preserves the first file for non-USD and empty selections", () => {
    const first = selected("C:\\assets\\first.glb");
    const second = selected("C:\\assets\\second.png");
    expect(selectPrimaryFile([first, second])).toEqual(first);
    expect(selectPrimaryFile([])).toBeNull();
  });

  it("returns browser fallback format support from the manifest", async () => {
    await expect(loadFormatSupport()).resolves.toEqual({
      modelExtensions: formatSupport.model,
      textureExtensions: formatSupport.texture,
      motionExtensions: formatSupport.motion,
      previewImplemented: formatSupport.previewImplemented,
    });
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
