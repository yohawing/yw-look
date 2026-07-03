import { beforeEach, describe, expect, it, vi } from "vitest";
import { Group } from "three";
import type { SelectedFile } from "../../../lib/files";

const mocks = vi.hoisted(() => ({
  colladaParse: vi.fn(),
  parseModelInWorker: vi.fn(),
  readBinaryFile: vi.fn(),
}));

vi.mock("../../../lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/files")>()),
  readBinaryFile: mocks.readBinaryFile,
}));

vi.mock("../../modelParseWorker", () => ({
  isAbortOrTimeoutError: (error: unknown) =>
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError"),
  parseModelInWorker: mocks.parseModelInWorker,
}));

vi.mock("three/examples/jsm/loaders/ColladaLoader.js", () => ({
  ColladaLoader: vi.fn(function ColladaLoader() {
    return {
      parse: mocks.colladaParse,
    };
  }),
}));

const daeFile: SelectedFile = {
  extension: "dae",
  fileName: "asset.dae",
  kind: "model",
  parentDirectory: "C:\\assets",
  path: "C:\\assets\\asset.dae",
};

function encoded(text: string) {
  return new TextEncoder().encode(text).buffer;
}

function daeText() {
  return `<COLLADA>
  <library_images>
    <image id="present"><init_from>textures/present.png</init_from></image>
    <image id="missing"><source>textures/missing.png</source></image>
  </library_images>
</COLLADA>`;
}

function mockDaeReads() {
  mocks.readBinaryFile.mockImplementation((path: string) => {
    if (path === daeFile.path) {
      return Promise.resolve(encoded(daeText()));
    }
    if (path === "C:\\assets\\textures\\present.png") {
      return Promise.resolve(new ArrayBuffer(4));
    }
    return Promise.reject(new Error(`missing file: ${path}`));
  });
}

describe("Collada texture helpers", () => {
  it("collects image references from init_from and image source tags", async () => {
    const { collectColladaImageReferences } = await import("../loader");

    expect([...collectColladaImageReferences(daeText())]).toEqual([
      "textures/present.png",
      "textures/missing.png",
    ]);
  });

  it("only maps known missing Collada texture URLs to the fallback texture", async () => {
    const { resolveColladaTextureUrl } = await import("../loader");
    const blobCache = new Map([["textures/present.png", "blob:present"]]);
    const missingPaths = new Set(["textures/missing.png"]);

    expect(
      resolveColladaTextureUrl("textures/present.png", blobCache, missingPaths),
    ).toBe("blob:present");
    expect(
      resolveColladaTextureUrl("textures/missing.png", blobCache, missingPaths),
    ).toContain("data:image/png;base64,");
    expect(
      resolveColladaTextureUrl(
        "textures/untracked.png",
        blobCache,
        missingPaths,
      ),
    ).toBe("textures/untracked.png");
  });

  it("builds a serializable Collada worker texture payload from resolved references", async () => {
    const { buildColladaWorkerTexturePayload, resolveColladaTextureUrl } =
      await import("../loader");
    const blobCache = new Map([
      ["textures/present.png", "blob:present"],
      ["textures/second.png", "blob:second"],
    ]);
    const missingPaths = ["textures/missing.png"];
    const { textureUrls, missingTextureUrls } =
      buildColladaWorkerTexturePayload(blobCache, missingPaths);
    const missingPathSet = new Set(missingPaths);

    expect(textureUrls).toEqual({
      "textures/present.png": "blob:present",
      "textures/second.png": "blob:second",
    });
    expect(missingTextureUrls).toEqual(["textures/missing.png"]);
    expect(
      resolveColladaTextureUrl(
        "textures/present.png",
        blobCache,
        missingPathSet,
      ),
    ).toBe(textureUrls["textures/present.png"]);
    expect(
      resolveColladaTextureUrl(
        "textures/missing.png",
        blobCache,
        missingPathSet,
      ),
    ).toContain("data:image/png;base64,");
  });
});

describe("loadDaePreviewObject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockDaeReads();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:present");
  });

  it("loads DAE files through the model parse worker with resolved texture payloads", async () => {
    const object = new Group();
    const signal = new AbortController().signal;
    mocks.parseModelInWorker.mockResolvedValue(object);
    const { loadDaePreviewObject } = await import("../loader");

    const result = await loadDaePreviewObject(daeFile, {
      parseTimeoutMs: 123,
      signal,
    });

    expect(mocks.parseModelInWorker).toHaveBeenCalledWith(
      daeFile.path,
      {
        kind: "dae",
        text: daeText(),
        basePath: daeFile.parentDirectory,
        textureUrls: { "textures/present.png": "blob:present" },
        missingTextureUrls: ["textures/missing.png"],
      },
      { signal, timeoutMs: 123 },
    );
    expect(result).toMatchObject({
      object,
      cleanupUrls: ["blob:present"],
      clips: [],
      formatVersion: null,
      warnings: [
        "Missing texture reference: textures/missing.png. Fallback material was used.",
      ],
    });
  });

  it("falls back to the main thread Collada parser when the worker fails", async () => {
    const scene = new Group();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.parseModelInWorker.mockRejectedValue(new Error("worker failed"));
    mocks.colladaParse.mockReturnValue({ scene });
    const { loadDaePreviewObject } = await import("../loader");

    const result = await loadDaePreviewObject(daeFile, {});

    expect(result.object).toBeInstanceOf(Group);
    expect((result.object as Group).children).toContain(scene);
    expect(mocks.colladaParse).toHaveBeenCalledWith(
      daeText(),
      daeFile.parentDirectory,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[dae] worker parse failed, falling back to main thread:",
      expect.any(Error),
    );
  });

  it("does not fall back when the worker reports abort or timeout", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    mocks.parseModelInWorker.mockRejectedValue(abortError);
    const { loadDaePreviewObject } = await import("../loader");

    await expect(loadDaePreviewObject(daeFile, {})).rejects.toBe(abortError);
    expect(mocks.colladaParse).not.toHaveBeenCalled();
  });

  it("reports decode, resolve, and scene stages in order", async () => {
    const onStage = vi.fn();
    mocks.parseModelInWorker.mockResolvedValue(new Group());
    const { loadDaePreviewObject } = await import("../loader");

    await loadDaePreviewObject(daeFile, { onStage });

    expect(onStage).toHaveBeenNthCalledWith(1, "decode");
    expect(onStage).toHaveBeenNthCalledWith(2, "resolve");
    expect(onStage).toHaveBeenNthCalledWith(3, "scene");
  });

  it("throws a focused error when main-thread Collada parsing returns no result", async () => {
    mocks.parseModelInWorker.mockRejectedValue(new Error("worker failed"));
    mocks.colladaParse.mockReturnValue(null);
    const { loadDaePreviewObject } = await import("../loader");

    await expect(loadDaePreviewObject(daeFile, {})).rejects.toThrow(
      "Collada parse returned no result; the document may be malformed.",
    );
  });
});
