import { beforeEach, describe, expect, it, vi } from "vitest";
import { Group } from "three";
import type { SelectedFile } from "../../../lib/files";

const mocks = vi.hoisted(() => {
  const state = {
    readBinaryFile: vi.fn(),
    importerProcess: vi.fn(),
    managerLoad: vi.fn(),
    managerUpdate: vi.fn(),
    managerAbort: vi.fn(),
    managerDispose: vi.fn(),
    managerConstructor: vi.fn(),
    importerInstances: [] as Array<{ wasm: unknown }>,
  };

  class MockIfcImporter {
    wasm: unknown = undefined;
    classes = { abstract: new Set<number>() };
    relations = new Map();

    constructor() {
      state.importerInstances.push(this);
    }

    process(...args: unknown[]) {
      return state.importerProcess(...args);
    }
  }

  class MockFragmentsModels {
    constructor(...args: unknown[]) {
      state.managerConstructor(...args);
    }

    load(...args: unknown[]) {
      return state.managerLoad(...args);
    }

    update(...args: unknown[]) {
      return state.managerUpdate(...args);
    }

    abort(...args: unknown[]) {
      return state.managerAbort(...args);
    }

    dispose(...args: unknown[]) {
      return state.managerDispose(...args);
    }
  }

  return { ...state, MockIfcImporter, MockFragmentsModels };
});

vi.mock("../materialSource", () => ({
  readIfcMaterials: vi.fn().mockResolvedValue({ building: [], display: [] }),
}));

vi.mock("@thatopen/fragments", () => ({
  FragmentsModels: mocks.MockFragmentsModels,
  IfcImporter: mocks.MockIfcImporter,
}));
vi.mock("@thatopen/fragments/worker?url", () => ({
  default: "/assets/fragments-worker.mjs",
}));
vi.mock("web-ifc/web-ifc.wasm?url", () => ({
  default: "/assets/web-ifc.wasm",
}));
vi.mock("../../../lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/files")>()),
  readBinaryFile: mocks.readBinaryFile,
}));

import { loadIfcPreviewObject } from "../loaderInstalled";

const ifcFile: SelectedFile = {
  path: "C:\\bim\\sample.ifc",
  fileName: "sample.ifc",
  extension: "ifc",
  kind: "model",
  parentDirectory: "C:\\bim",
};

describe("installed IFC loader", () => {
  beforeEach(() => {
    mocks.readBinaryFile.mockReset();
    mocks.importerProcess.mockReset();
    mocks.managerLoad.mockReset();
    mocks.managerUpdate.mockReset();
    mocks.managerAbort.mockReset();
    mocks.managerDispose.mockReset();
    mocks.managerConstructor.mockReset();
    mocks.importerInstances.length = 0;
    mocks.readBinaryFile.mockResolvedValue(
      new Uint8Array([0x49, 0x46, 0x43]).buffer,
    );
    mocks.importerProcess.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.managerLoad.mockResolvedValue({
      object: new Group(),
      useCamera: vi.fn(),
      getSpatialStructure: vi
        .fn()
        .mockResolvedValue({ category: "IFCPROJECT", localId: null }),
      getItemsIdsWithGeometry: vi.fn().mockResolvedValue([]),
      getItemsMaterialDefinition: vi.fn().mockResolvedValue([]),
      getItemsData: vi.fn().mockResolvedValue([]),
      resetHighlight: vi.fn().mockResolvedValue(undefined),
      setColor: vi.fn().mockResolvedValue(undefined),
    });
    mocks.managerUpdate.mockResolvedValue(undefined);
    mocks.managerDispose.mockResolvedValue(undefined);
  });

  it("loads a local IFC payload and exposes a pack runtime", async () => {
    const stages: string[] = [];
    const result = await loadIfcPreviewObject(ifcFile, {
      onStage: (stage) => stages.push(stage),
    });

    expect(stages).toEqual(["scan", "decode", "scene"]);
    expect(mocks.readBinaryFile).toHaveBeenCalledWith(ifcFile.path);
    expect(mocks.importerProcess).toHaveBeenCalledWith({
      bytes: new Uint8Array([0x49, 0x46, 0x43]),
      raw: false,
    });
    expect(mocks.importerInstances[0]?.wasm).toEqual({
      path: "/assets/",
      absolute: true,
    });
    expect(mocks.managerConstructor).toHaveBeenCalledWith(
      "/assets/fragments-worker.mjs",
      { maxWorkers: 2 },
    );
    expect(mocks.managerLoad).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      expect.objectContaining({
        modelId: "ifc-preview-sample-ifc",
        raw: false,
        camera: expect.anything(),
      }),
    );
    expect(mocks.managerUpdate).toHaveBeenCalledWith(true);
    expect(result.object.name).toBe("sample.ifc IFC Preview");
    expect(result.formatVersion).toBe("IFC");
    expect(result.createPackRuntime).toBeTypeOf("function");
    const runtime = result.createPackRuntime?.({} as never);
    runtime?.dispose();
    runtime?.dispose();
    await vi.waitFor(() => expect(mocks.managerDispose).toHaveBeenCalledOnce());
  });

  it("aborts an in-flight Fragments model load when the signal aborts", async () => {
    const controller = new AbortController();
    mocks.managerLoad.mockImplementation(
      () =>
        new Promise((resolve) => {
          controller.signal.addEventListener("abort", () =>
            resolve({ object: new Group(), useCamera: vi.fn() }),
          );
          controller.abort();
        }),
    );

    await expect(
      loadIfcPreviewObject(ifcFile, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.managerAbort).toHaveBeenCalledWith("ifc-preview-sample-ifc");
    expect(mocks.managerDispose).toHaveBeenCalledOnce();
  });

  it("disposes a partially loaded manager when loading is aborted", async () => {
    const controller = new AbortController();
    mocks.managerLoad.mockImplementation(async () => {
      controller.abort();
      return { object: new Group(), useCamera: vi.fn() };
    });

    await expect(
      loadIfcPreviewObject(ifcFile, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.managerDispose).toHaveBeenCalledOnce();
  });

  it("wraps parser failures with IFC context", async () => {
    mocks.importerProcess.mockRejectedValue(new Error("malformed IFC"));

    await expect(loadIfcPreviewObject(ifcFile, {})).rejects.toThrow(
      "Unable to load IFC preview: malformed IFC",
    );
    expect(mocks.managerConstructor).not.toHaveBeenCalled();
  });
});
