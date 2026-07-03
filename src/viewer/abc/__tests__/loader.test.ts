import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnimationMixer, DoubleSide, Mesh, MeshStandardMaterial } from "three";
import type { SelectedFile } from "../../../lib/files";

const mocks = vi.hoisted(() => ({
  convertAlembicToPreview: vi.fn(),
}));

vi.mock("../../../lib/alembic", () => ({
  convertAlembicToPreview: mocks.convertAlembicToPreview,
}));

import { loadAbcPreviewObject, parseAlembicPreviewPayload } from "../loader";

const abcFile: SelectedFile = {
  path: "C:\\cache\\monkey.abc",
  fileName: "monkey.abc",
  extension: "abc",
  kind: "model",
  parentDirectory: "C:\\cache",
};

function buildJsonPayload(
  meshes: Array<{
    name: string;
    positions: number[];
    indices: number[];
    frames: Array<{ time: number; positions: number[] }>;
  }>,
): string {
  return JSON.stringify({
    format: "yw-look-alembic-preview-v1",
    meshes,
  });
}

function encodeJsonPayload(source: string) {
  return new TextEncoder().encode(source).buffer;
}

function buildYwabPayload() {
  const name = new TextEncoder().encode("triangle");
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const indices = [0, 1, 2];
  const frames = [{ time: 1, positions: [0, 0, 0, 1, 0, 0, 0, 2, 0] }];
  const byteLength =
    16 +
    4 +
    name.byteLength +
    12 +
    positions.length * Float32Array.BYTES_PER_ELEMENT +
    indices.length * Uint32Array.BYTES_PER_ELEMENT +
    frames.length * (4 + positions.length * Float32Array.BYTES_PER_ELEMENT);
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  let offset = 0;

  const writeU8 = (value: number) => {
    view.setUint8(offset, value);
    offset += 1;
  };
  const writeU32 = (value: number) => {
    view.setUint32(offset, value, true);
    offset += 4;
  };
  const writeF32 = (value: number) => {
    view.setFloat32(offset, value, true);
    offset += 4;
  };
  const writeBytes = (bytes: Uint8Array) => {
    new Uint8Array(buffer, offset, bytes.byteLength).set(bytes);
    offset += bytes.byteLength;
  };

  for (const value of [0x59, 0x57, 0x41, 0x42]) {
    writeU8(value);
  }
  writeU32(1);
  writeU32(1);
  writeU32(0);
  writeU32(name.byteLength);
  writeBytes(name);
  writeU32(3);
  writeU32(indices.length);
  writeU32(frames.length);
  for (const value of positions) writeF32(value);
  for (const value of indices) writeU32(value);
  for (const frame of frames) {
    writeF32(frame.time);
    for (const value of frame.positions) writeF32(value);
  }

  return buffer;
}

describe("Alembic preview loader", () => {
  beforeEach(() => {
    mocks.convertAlembicToPreview.mockReset();
  });

  it("converts Alembic preview JSON and returns a static mesh preview", async () => {
    const stages: string[] = [];
    mocks.convertAlembicToPreview.mockResolvedValue(
      buildJsonPayload([
        {
          name: "triangle",
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          indices: [0, 1, 2],
          frames: [],
        },
      ]),
    );

    const result = await loadAbcPreviewObject(abcFile, {
      onStage: (stage) => stages.push(stage),
    });

    expect(mocks.convertAlembicToPreview).toHaveBeenCalledWith(
      "C:\\cache\\monkey.abc",
    );
    expect(result.object.children.some((child) => child instanceof Mesh)).toBe(
      true,
    );
    const mesh = result.object.children.find(
      (child): child is Mesh => child instanceof Mesh,
    );
    expect(mesh?.material).toBeInstanceOf(MeshStandardMaterial);
    expect((mesh?.material as MeshStandardMaterial | undefined)?.side).toBe(
      DoubleSide,
    );
    expect(result.cleanupUrls).toEqual([]);
    expect(result.clips).toEqual([]);
    expect(result.formatVersion).toBe("Alembic static sample 0");
    expect(stages).toEqual(["decode", "scene", "gpu"]);
  });

  it("parses Alembic preview JSON from an ArrayBuffer", async () => {
    mocks.convertAlembicToPreview.mockResolvedValue(
      encodeJsonPayload(
        buildJsonPayload([
          {
            name: "triangle",
            positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
            indices: [0, 1, 2],
            frames: [],
          },
        ]),
      ),
    );

    const result = await loadAbcPreviewObject(abcFile, {});

    expect(result.object.children.some((child) => child instanceof Mesh)).toBe(
      true,
    );
  });

  it("parses YWAB binary payloads", () => {
    const payload = parseAlembicPreviewPayload(buildYwabPayload());

    expect(payload.meshes).toHaveLength(1);
    expect(payload.meshes[0].name).toBe("triangle");
    expect([...payload.meshes[0].indices]).toEqual([0, 1, 2]);
    expect(payload.meshes[0].frames).toHaveLength(1);
  });

  it("maps Alembic geometry cache samples to morph target animation", async () => {
    mocks.convertAlembicToPreview.mockResolvedValue(
      buildJsonPayload([
        {
          name: "bad.name/[triangle]",
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          indices: [0, 1, 2],
          frames: [
            {
              time: 0.5,
              positions: [0, 0, 0, 1, 0, 0, 0, 2, 0],
            },
            {
              time: 1,
              positions: [0, 0, 0, 1, 0, 0, 0, 3, 0],
            },
          ],
        },
      ]),
    );

    const result = await loadAbcPreviewObject(abcFile, {});
    const mesh = result.object.children.find(
      (child): child is Mesh => child instanceof Mesh,
    );

    expect(mesh?.geometry.morphAttributes.position).toHaveLength(2);
    expect(mesh?.morphTargetInfluences).toEqual([0, 0]);
    expect(mesh?.name).toBe("AlembicMesh_1");
    expect(mesh?.userData.sourceName).toBe("bad.name/[triangle]");
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0].name).toBe("Alembic Geometry Cache");
    expect(result.clips[0].duration).toBe(1);
    expect(result.formatVersion).toBe("Alembic geometry cache");

    const mixer = new AnimationMixer(result.object);
    mixer.clipAction(result.clips[0]).play();
    mixer.setTime(0.75);

    expect(mesh?.morphTargetInfluences?.[0]).toBeCloseTo(0.5);
    expect(mesh?.morphTargetInfluences?.[1]).toBeCloseTo(0.5);
  });

  it("throws AbortError after conversion when the signal is aborted", async () => {
    const controller = new AbortController();
    mocks.convertAlembicToPreview.mockImplementation(async () => {
      controller.abort();
      return buildJsonPayload([
        {
          name: "triangle",
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          indices: [0, 1, 2],
          frames: [],
        },
      ]);
    });

    await expect(
      loadAbcPreviewObject(abcFile, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fails clearly when the converter returns no renderable mesh", async () => {
    mocks.convertAlembicToPreview.mockResolvedValue(buildJsonPayload([]));

    await expect(loadAbcPreviewObject(abcFile, {})).rejects.toThrow(
      "Alembic conversion returned no renderable mesh data.",
    );
  });

  it("fails clearly when the helper returns malformed JSON", async () => {
    mocks.convertAlembicToPreview.mockResolvedValue("# empty\n");

    await expect(loadAbcPreviewObject(abcFile, {})).rejects.toThrow(
      "Alembic helper returned malformed preview JSON.",
    );
  });

  it("fails clearly when YWAB payloads are truncated", () => {
    expect(() =>
      parseAlembicPreviewPayload(buildYwabPayload().slice(0, 12)),
    ).toThrow("Alembic helper returned truncated header.");
  });
});
