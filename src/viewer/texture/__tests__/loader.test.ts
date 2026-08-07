import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from "three";
import type { SelectedFile } from "../../../lib/files";
import type { LoaderContext } from "../../loaderRegistry";

const mocks = vi.hoisted(() => ({
  exrLoadAsync: vi.fn(),
  ktx2Instances: [] as Array<{
    setTranscoderPath: ReturnType<typeof vi.fn>;
    detectSupport: ReturnType<typeof vi.fn>;
    loadAsync: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    workerConfig?: Record<string, boolean>;
  }>,
  ktx2LoadAsync: vi.fn(),
  readBinaryFile: vi.fn(),
  rgbeLoadAsync: vi.fn(),
}));

vi.mock("../../../lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/files")>()),
  readBinaryFile: mocks.readBinaryFile,
}));

vi.mock("three/examples/jsm/loaders/EXRLoader.js", () => ({
  EXRLoader: vi.fn(function EXRLoader() {
    return {
      loadAsync: mocks.exrLoadAsync,
    };
  }),
}));

vi.mock("three/examples/jsm/loaders/KTX2Loader.js", () => ({
  KTX2Loader: vi.fn(function KTX2Loader() {
    const instance = {
      setTranscoderPath: vi.fn(() => instance),
      detectSupport: vi.fn(() => instance),
      loadAsync: mocks.ktx2LoadAsync,
      dispose: vi.fn(),
    };
    mocks.ktx2Instances.push(instance);
    return instance;
  }),
}));

vi.mock("three/examples/jsm/loaders/RGBELoader.js", () => ({
  RGBELoader: vi.fn(function RGBELoader() {
    return {
      loadAsync: mocks.rgbeLoadAsync,
    };
  }),
}));

const textureFile: SelectedFile = {
  extension: "png",
  fileName: "texture.png",
  kind: "texture",
  parentDirectory: "C:\\assets",
  path: "C:\\assets\\texture.png",
};

function fileWithExtension(extension: string): SelectedFile {
  return {
    ...textureFile,
    extension,
    fileName: `texture.${extension}`,
    path: `C:\\assets\\texture.${extension}`,
  };
}

function resultTexture(result: Awaited<ReturnType<typeof loadTexture>>) {
  const mesh = result.object as Mesh;
  expect(mesh).toBeInstanceOf(Mesh);
  expect(mesh.material).toBeInstanceOf(MeshBasicMaterial);
  return (mesh.material as MeshBasicMaterial).map as Texture;
}

async function loadTexture(file: SelectedFile, context: LoaderContext = {}) {
  const { loadTexturePreviewObject } = await import("../loader");
  return loadTexturePreviewObject(file, context);
}

describe("loadTexturePreviewObject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mocks.ktx2Instances.length = 0;
    mocks.readBinaryFile.mockResolvedValue(new ArrayBuffer(4));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:texture");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  it("loads PNG textures as standalone previews with sRGB color space", async () => {
    const sourceTexture = new Texture<HTMLImageElement>();
    vi.spyOn(TextureLoader.prototype, "loadAsync").mockResolvedValue(
      sourceTexture,
    );

    const result = await loadTexture(textureFile);
    const texture = resultTexture(result);

    expect(mocks.readBinaryFile).toHaveBeenCalledWith(textureFile.path);
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(TextureLoader.prototype.loadAsync).toHaveBeenCalledWith(
      "blob:texture",
    );
    expect(result.cleanupUrls).toEqual(["blob:texture"]);
    expect(texture).toBe(sourceTexture);
    expect(texture.colorSpace).toBe(SRGBColorSpace);
    expect(texture.name).toBe("texture.png");
    expect(texture.userData.textureSourceKind).toBe("standalone");
  });

  it("reports decode and gpu stages in order", async () => {
    const onStage = vi.fn();
    vi.spyOn(TextureLoader.prototype, "loadAsync").mockResolvedValue(
      new Texture(),
    );

    await loadTexture(textureFile, { onStage });

    expect(onStage).toHaveBeenNthCalledWith(1, "decode");
    expect(onStage).toHaveBeenNthCalledWith(2, "gpu");
  });

  it("keeps HDR and EXR textures in their loader-provided color space", async () => {
    const hdrTexture = new Texture();
    const exrTexture = new Texture();
    mocks.rgbeLoadAsync.mockResolvedValue(hdrTexture);
    mocks.exrLoadAsync.mockResolvedValue(exrTexture);

    const hdrResult = await loadTexture(fileWithExtension("hdr"));
    const exrResult = await loadTexture(fileWithExtension("exr"));

    expect(resultTexture(hdrResult)).toBe(hdrTexture);
    expect(resultTexture(exrResult)).toBe(exrTexture);
    expect(hdrTexture.colorSpace).not.toBe(SRGBColorSpace);
    expect(exrTexture.colorSpace).not.toBe(SRGBColorSpace);
  });

  it("detects KTX2 support with the renderer and always disposes the loader", async () => {
    const texture = new Texture();
    const renderer = {} as LoaderContext["renderer"];
    mocks.ktx2LoadAsync.mockResolvedValue(texture);

    const result = await loadTexture(fileWithExtension("ktx2"), { renderer });
    const loader = mocks.ktx2Instances[0];

    expect(loader.setTranscoderPath).toHaveBeenCalledWith("/basis/");
    expect(loader.detectSupport).toHaveBeenCalledWith(renderer);
    expect(loader.dispose).toHaveBeenCalledTimes(1);
    expect(result.cleanupUrls).toEqual(["blob:texture"]);
    expect(resultTexture(result)).toBe(texture);
    expect(texture.userData.textureSourceKind).toBe("standalone");
  });

  it("uses a desktop KTX2 workerConfig fallback without a renderer", async () => {
    mocks.ktx2LoadAsync.mockResolvedValue(new Texture());

    await loadTexture(fileWithExtension("ktx2"));
    const loader = mocks.ktx2Instances[0];

    expect(loader.detectSupport).not.toHaveBeenCalled();
    expect(loader.workerConfig).toMatchObject({
      dxtSupported: true,
      bptcSupported: true,
      astcSupported: false,
      pvrtcSupported: false,
    });
  });

  it("revokes the blob URL and disposes KTX2 loader when loading fails", async () => {
    const error = new Error("bad ktx2");
    mocks.ktx2LoadAsync.mockRejectedValue(error);

    await expect(loadTexture(fileWithExtension("ktx2"))).rejects.toBe(error);
    const loader = mocks.ktx2Instances[0];

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:texture");
    expect(loader.dispose).toHaveBeenCalledTimes(1);
  });

  it("rejects with AbortError before file read when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      loadTexture(textureFile, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.readBinaryFile).not.toHaveBeenCalled();
  });

  it("revokes the blob URL and skips TextureLoader when aborted after object URL creation", async () => {
    const controller = new AbortController();
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      controller.abort();
      return "blob:texture";
    });
    const loadAsyncSpy = vi.spyOn(TextureLoader.prototype, "loadAsync");

    await expect(
      loadTexture(textureFile, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:texture");
    expect(loadAsyncSpy).not.toHaveBeenCalled();
  });

  it("revokes the blob URL and disposes KTX2 loader when aborted after object URL creation", async () => {
    const controller = new AbortController();
    const { KTX2Loader } =
      await import("three/examples/jsm/loaders/KTX2Loader.js");
    vi.mocked(KTX2Loader).mockImplementationOnce(function KTX2Loader() {
      const instance = {
        setTranscoderPath: vi.fn(() => {
          controller.abort();
          return instance;
        }),
        detectSupport: vi.fn(() => instance),
        loadAsync: mocks.ktx2LoadAsync,
        dispose: vi.fn(),
      };
      mocks.ktx2Instances.push(instance);
      return instance;
    });

    await expect(
      loadTexture(fileWithExtension("ktx2"), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const loader = mocks.ktx2Instances[0];

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:texture");
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(mocks.ktx2LoadAsync).not.toHaveBeenCalled();
    expect(loader.dispose).toHaveBeenCalledTimes(1);
  });
});
