import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelFbxImport, convertFbxToPreview } from "../fbx";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

describe("native FBX IPC", () => {
  beforeEach(() => invokeMock.mockReset());

  it("requests raw GLB bytes with a request id", async () => {
    const bytes = new ArrayBuffer(8);
    invokeMock.mockResolvedValue(bytes);
    await expect(convertFbxToPreview("C:\\asset.fbx", "fbx-1")).resolves.toBe(
      bytes,
    );
    expect(invokeMock).toHaveBeenCalledWith("convert_fbx_to_preview", {
      path: "C:\\asset.fbx",
      requestId: "fbx-1",
    });
  });

  it("cancels by request id", async () => {
    invokeMock.mockResolvedValue(true);
    await expect(cancelFbxImport("fbx-1")).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("cancel_fbx_import", {
      requestId: "fbx-1",
    });
  });
});
