import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
} from "three";
import type { SelectedFile } from "../../../lib/files";

const mocks = vi.hoisted(() => ({
  convert: vi.fn(),
  enabled: vi.fn(),
  parse: vi.fn(),
  readBinaryFile: vi.fn(),
}));

vi.mock("../../../lib/rhino3dm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/rhino3dm")>()),
  convertRhino3dmPreview: mocks.convert,
  isRhino3dmNativePreviewEnabled: mocks.enabled,
}));

vi.mock("../../../viewer/modelParseWorker", () => ({
  parseModelInWorker: mocks.parse,
}));

vi.mock("../../../lib/files", () => ({
  readBinaryFile: mocks.readBinaryFile,
}));

vi.mock("three/examples/jsm/loaders/3DMLoader.js", () => ({
  Rhino3dmLoader: class {
    setLibraryPath() {
      return this;
    }

    setWorkerLimit() {
      return this;
    }

    parse(
      buffer: ArrayBuffer,
      onLoad: (object: Object3D) => void,
      onError: (error: unknown) => void,
    ) {
      return mocks.parse(buffer, onLoad, onError);
    }

    dispose() {
      return this;
    }
  },
}));

import { loadRhino3dmPreviewObject } from "../loader";

const rhinoFile: SelectedFile = {
  path: "C:\\models\\sample.3dm",
  fileName: "sample.3dm",
  extension: "3dm",
  kind: "model",
  parentDirectory: "C:\\models",
};

describe("native Rhino 3DM route", () => {
  beforeEach(() => {
    mocks.convert.mockReset();
    mocks.enabled.mockReset().mockReturnValue(true);
    mocks.parse.mockReset();
    mocks.readBinaryFile.mockReset();
    mocks.parse.mockResolvedValue(new Group());
  });

  it("selects the native command on desktop and transfers one GLB buffer", async () => {
    const bytes = new ArrayBuffer(16);
    const root = new Group();
    root.name = "Native root";
    mocks.convert.mockResolvedValue({
      bytes,
      warnings: [
        {
          message: "Extrusion preview skipped.",
          reason: "saved mesh is unavailable",
          count: 204,
        },
      ],
      stats: { outputBytes: 16 },
    });
    mocks.parse.mockResolvedValue(root);

    const result = await loadRhino3dmPreviewObject(rhinoFile, {
      parseTimeoutMs: 5000,
    });

    expect(mocks.convert).toHaveBeenCalledWith(rhinoFile.path, {
      signal: undefined,
      timeoutMs: 5000,
    });
    expect(mocks.readBinaryFile).not.toHaveBeenCalled();
    expect(mocks.parse).toHaveBeenCalledWith(
      rhinoFile.path,
      { kind: "glb", buffer: bytes },
      {
        signal: undefined,
        timeoutMs: 5000,
        staticSceneBudget: {
          maxNodes: 500_000,
          maxGeometryCount: 250_000,
          maxVertexBytes: 1_073_741_824,
          maxIndexBytes: 1_073_741_824,
          maxTextureDecodedBytes: 1_073_741_824,
        },
        transferBuffer: true,
      },
    );
    expect(result.object).toBeInstanceOf(Group);
    expect(result.object.name).toBe("Native root");
    expect(result.warnings).toEqual([
      {
        message: "Extrusion preview skipped.",
        reason: "saved mesh is unavailable",
        count: 204,
      },
    ]);
    expect(result.stats).toEqual({ outputBytes: 16 });
  });

  it("does not retry through WASM when native conversion fails", async () => {
    mocks.convert.mockRejectedValue(new Error("memory budget exceeded"));

    await expect(loadRhino3dmPreviewObject(rhinoFile, {})).rejects.toThrow(
      "memory budget exceeded",
    );
    expect(mocks.readBinaryFile).not.toHaveBeenCalled();
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it("disposes a reconstructed scene when cancellation wins after worker parsing", async () => {
    const controller = new AbortController();
    const geometry = new BufferGeometry();
    const material = new MeshBasicMaterial();
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const root = new Group();
    root.add(new Mesh(geometry, material));
    mocks.convert.mockResolvedValue({
      bytes: new ArrayBuffer(16),
      warnings: [],
      stats: null,
    });
    mocks.parse.mockImplementation(async () => {
      controller.abort();
      return root;
    });

    await expect(
      loadRhino3dmPreviewObject(rhinoFile, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(mocks.readBinaryFile).not.toHaveBeenCalled();
  });

  it("reports static scene expansion limits as structured output-limit errors", async () => {
    mocks.convert.mockResolvedValue({
      bytes: new ArrayBuffer(16),
      warnings: [],
    });
    mocks.parse.mockRejectedValue(
      Object.assign(new Error("Static scene vertexBytes budget exceeded."), {
        name: "StaticScenePayloadBudgetError",
        reason: "vertexBytes",
        usage: { vertexBytes: 2048 },
        limit: 1024,
      }),
    );

    const failure = await loadRhino3dmPreviewObject(rhinoFile, {}).catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({
      name: "Rhino3dmPreviewError",
      kind: "outputLimit",
      details: {
        reason: "preview data exceeds the display budget",
        stage: "scene reconstruction",
        limit: 1024,
        observed: 2048,
        budgetReason: "vertexBytes",
      },
    });
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "Rhino 3DM preview exceeds the display budget. (Reason: preview data exceeds the display budget, Stage: scene reconstruction, Limit: 1024, Observed: 2048)",
    );
    expect(mocks.readBinaryFile).not.toHaveBeenCalled();
  });

  it("permits the next native load after a scene-limit failure", async () => {
    mocks.convert
      .mockResolvedValueOnce({ bytes: new ArrayBuffer(16), warnings: [] })
      .mockResolvedValueOnce({ bytes: new ArrayBuffer(16), warnings: [] });
    mocks.parse
      .mockRejectedValueOnce(
        Object.assign(new Error("scene budget exceeded"), {
          name: "StaticScenePayloadBudgetError",
          reason: "nodeCount",
          usage: { nodeCount: 500_001 },
          limit: 500_000,
        }),
      )
      .mockResolvedValueOnce(new Group());

    await expect(
      loadRhino3dmPreviewObject(rhinoFile, {}),
    ).rejects.toMatchObject({ kind: "outputLimit" });
    await expect(
      loadRhino3dmPreviewObject(rhinoFile, {}),
    ).resolves.toMatchObject({ object: expect.any(Group) });
    expect(mocks.convert).toHaveBeenCalledTimes(2);
    expect(mocks.parse).toHaveBeenCalledTimes(2);
  });

  it("keeps browser selection on the existing WASM parser", async () => {
    mocks.enabled.mockReturnValue(false);
    mocks.readBinaryFile.mockResolvedValue(new ArrayBuffer(8));
    const root = new Object3D();
    mocks.parse.mockImplementationOnce(
      (_buffer: ArrayBuffer, onLoad: (object: Object3D) => void) =>
        onLoad(root),
    );

    await expect(
      loadRhino3dmPreviewObject(rhinoFile, {}),
    ).resolves.toMatchObject({ object: expect.any(Group) });
    expect(mocks.convert).not.toHaveBeenCalled();
    expect(mocks.readBinaryFile).toHaveBeenCalledWith(rhinoFile.path);
  });
});
