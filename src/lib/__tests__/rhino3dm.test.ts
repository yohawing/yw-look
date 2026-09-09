import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  isWindows: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("../platform", () => ({
  isTauriEnvironment: mocks.isTauri,
  isWindowsEnvironment: mocks.isWindows,
}));

import {
  convertRhino3dmPreview,
  isRhino3dmNativePreviewEnabled,
} from "../rhino3dm";

const PACKET_MAGIC = new Uint8Array([
  0x59, 0x57, 0x33, 0x44, 0x4d, 0x47, 0x4c, 0x42,
]);
const VALID_GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);

function makePacket(
  headerOverrides: Record<string, unknown> = {},
  glb = VALID_GLB,
): ArrayBuffer {
  const header = {
    packetVersion: 1,
    schemaVersion: 1,
    protocolVersion: 1,
    helperRevision: "fixture-revision",
    warnings: [],
    stats: {},
    glbBytes: glb.byteLength,
    ...headerOverrides,
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const packet = new Uint8Array(12 + headerBytes.byteLength + glb.byteLength);
  packet.set(PACKET_MAGIC);
  new DataView(packet.buffer).setUint32(8, headerBytes.byteLength, true);
  packet.set(headerBytes, 12);
  packet.set(glb, 12 + headerBytes.byteLength);
  return packet.buffer;
}

function makeRawPacket(headerBytes: Uint8Array, glb = VALID_GLB): ArrayBuffer {
  const packet = new Uint8Array(12 + headerBytes.byteLength + glb.byteLength);
  packet.set(PACKET_MAGIC);
  new DataView(packet.buffer).setUint32(8, headerBytes.byteLength, true);
  packet.set(headerBytes, 12);
  packet.set(glb, 12 + headerBytes.byteLength);
  return packet.buffer;
}

describe("convertRhino3dmPreview", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.isTauri.mockReset().mockReturnValue(true);
    mocks.isWindows.mockReset().mockReturnValue(true);
  });

  it("enables the supervised native route only on Windows desktop", () => {
    expect(isRhino3dmNativePreviewEnabled()).toBe(true);

    mocks.isWindows.mockReturnValue(false);
    expect(isRhino3dmNativePreviewEnabled()).toBe(false);

    mocks.isWindows.mockReturnValue(true);
    mocks.isTauri.mockReturnValue(false);
    expect(isRhino3dmNativePreviewEnabled()).toBe(false);
  });

  it("keeps native warnings and stats structured while normalizing the GLB bytes", async () => {
    const packet = makePacket({
      warnings: [
        {
          kind: "missing_saved_mesh_extrusion",
          count: 204,
        },
      ],
      stats: { outputBytes: 4096, helperPeakBytes: 8192 },
    });
    mocks.invoke.mockResolvedValueOnce(packet);

    const result = await convertRhino3dmPreview("C:\\models\\sample.3dm", {
      requestId: "request-1",
    });

    expect(result.bytes).not.toBe(packet);
    expect(new Uint8Array(result.bytes)).toEqual(VALID_GLB);
    expect(result.warnings).toEqual([
      {
        message:
          "Extrusion objects without saved meshes were omitted from the preview.",
        count: 204,
        category: "missing_saved_mesh_extrusion",
      },
    ]);
    expect(result.stats).toEqual({ outputBytes: 4096, helperPeakBytes: 8192 });
    expect(mocks.invoke).toHaveBeenCalledWith("convert_rhino3dm_preview", {
      path: "C:\\models\\sample.3dm",
      requestId: "request-1",
    });
  });

  it("accepts only a raw ArrayBuffer packet, not JSON byte arrays", async () => {
    mocks.invoke.mockResolvedValueOnce([0x59, 0x57, 0x33, 0x44]);

    await expect(convertRhino3dmPreview("sample.3dm")).rejects.toThrow(
      "non-binary packet",
    );
  });

  it.each([
    [
      "magic",
      () => {
        const packet = new Uint8Array(makePacket());
        packet[0] = 0;
        return packet.buffer;
      },
      "invalid magic",
    ],
    [
      "header length",
      () => {
        const packet = new Uint8Array(makePacket());
        new DataView(packet.buffer).setUint32(8, 0xffff_ffff, true);
        return packet.buffer;
      },
      "invalid header length",
    ],
    ["UTF-8", () => makeRawPacket(new Uint8Array([0xff])), "not valid UTF-8"],
    [
      "JSON",
      () => makeRawPacket(new TextEncoder().encode("{")),
      "not valid JSON",
    ],
    [
      "GLB offset",
      () => makePacket({ glbBytes: 99 }),
      "GLB length does not match",
    ],
    [
      "GLB magic",
      () => makePacket({}, new Uint8Array([1, 2, 3, 4])),
      "does not contain a GLB",
    ],
  ] as const)(
    "rejects an invalid %s packet envelope",
    async (_name, makePacketValue, message) => {
      mocks.invoke.mockResolvedValueOnce(makePacketValue());

      await expect(
        convertRhino3dmPreview("sample.3dm", { requestId: "invalid" }),
      ).rejects.toThrow(message);
    },
  );

  it("cancels the native request and rejects promptly without a fallback", async () => {
    let resolveConversion!: (value: unknown) => void;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "cancel_rhino3dm_preview") return Promise.resolve(true);
      return new Promise((resolve) => {
        resolveConversion = resolve;
      });
    });
    const controller = new AbortController();
    const pending = convertRhino3dmPreview("sample.3dm", {
      signal: controller.signal,
      requestId: "request-2",
    });

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_rhino3dm_preview", {
      requestId: "request-2",
    });

    // A late conversion result cannot revive the canceled request.
    resolveConversion({ bytes: new ArrayBuffer(8) });
    await Promise.resolve();
  });

  it("preserves structured AppError details on native failures", async () => {
    mocks.invoke.mockRejectedValueOnce({
      kind: "memoryLimit",
      message: "Rhino preview stopped.",
      details: {
        reason: "memory budget exceeded",
        stage: "tessellation",
        limit: 100,
      },
    });

    const failure = await convertRhino3dmPreview("sample.3dm").catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({
      name: "Rhino3dmPreviewError",
      kind: "memoryLimit",
      details: {
        reason: "memory budget exceeded",
        stage: "tessellation",
        limit: 100,
      },
    });
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "Rhino preview stopped. (Reason: memory budget exceeded, Stage: tessellation, Limit: 100)",
    );
  });
});
