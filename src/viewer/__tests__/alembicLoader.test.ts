import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnimationMixer, DoubleSide, Mesh, MeshStandardMaterial } from "three";
import type { SelectedFile } from "../../lib/files";

const mocks = vi.hoisted(() => ({
  convertAlembicToPreview: vi.fn(),
}));

vi.mock("../../lib/alembic", () => ({
  convertAlembicToPreview: mocks.convertAlembicToPreview,
}));

import { loadPreviewObject } from "../loaders";

const abcFile: SelectedFile = {
  path: "C:\\cache\\monkey.abc",
  fileName: "monkey.abc",
  extension: "abc",
  kind: "model",
  parentDirectory: "C:\\cache",
};

function buildYwabPayload(
  meshes: Array<{
    name: string;
    positions: number[];
    indices: number[];
    frames: Array<{ time: number; positions: number[] }>;
  }>,
): ArrayBuffer {
  const encoder = new TextEncoder();
  let totalBytes = 16;
  const encodedNames: Uint8Array[] = [];
  for (const mesh of meshes) {
    const nameBytes = encoder.encode(mesh.name);
    encodedNames.push(nameBytes);
    totalBytes += 4 + nameBytes.byteLength;
    totalBytes += 4 + 4 + 4;
    totalBytes += mesh.positions.length * 4;
    totalBytes += mesh.indices.length * 4;
    for (const frame of mesh.frames) {
      totalBytes += 4;
      totalBytes += frame.positions.length * 4;
    }
  }

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  let offset = 0;

  const writeU32 = (v: number) => {
    view.setUint32(offset, v, true);
    offset += 4;
  };
  const writeF32 = (v: number) => {
    view.setFloat32(offset, v, true);
    offset += 4;
  };

  view.setUint8(0, 0x59);
  view.setUint8(1, 0x57);
  view.setUint8(2, 0x41);
  view.setUint8(3, 0x42);
  offset = 4;
  writeU32(1);
  writeU32(meshes.length);
  writeU32(0);

  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    const nameBytes = encodedNames[i];
    writeU32(nameBytes.byteLength);
    new Uint8Array(buffer, offset, nameBytes.byteLength).set(nameBytes);
    offset += nameBytes.byteLength;

    const vertexCount = mesh.positions.length / 3;
    writeU32(vertexCount);
    writeU32(mesh.indices.length);
    writeU32(mesh.frames.length);

    for (const p of mesh.positions) writeF32(p);
    for (const idx of mesh.indices) writeU32(idx);

    for (const frame of mesh.frames) {
      writeF32(frame.time);
      for (const p of frame.positions) writeF32(p);
    }
  }

  return buffer;
}

describe("Alembic preview loader", () => {
  beforeEach(() => {
    mocks.convertAlembicToPreview.mockReset();
  });

  it("converts Alembic binary preview and returns a static mesh preview", async () => {
    const stages: string[] = [];
    mocks.convertAlembicToPreview.mockResolvedValue(
      buildYwabPayload([
        {
          name: "triangle",
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          indices: [0, 1, 2],
          frames: [],
        },
      ]),
    );

    const result = await loadPreviewObject(abcFile, undefined, {
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
    expect(stages).toEqual(["scan", "decode", "scene", "gpu"]);
  });

  it("maps Alembic geometry cache samples to morph target animation", async () => {
    mocks.convertAlembicToPreview.mockResolvedValue(
      buildYwabPayload([
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

    const result = await loadPreviewObject(abcFile);
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

  it("fails clearly when the converter returns no renderable mesh", async () => {
    mocks.convertAlembicToPreview.mockResolvedValue(buildYwabPayload([]));

    await expect(loadPreviewObject(abcFile)).rejects.toThrow(
      "Alembic conversion returned no renderable mesh data.",
    );
  });

  it("fails clearly when the helper returns malformed binary", async () => {
    const bad = new ArrayBuffer(16);
    const badView = new DataView(bad);
    badView.setUint8(0, 0x42);
    badView.setUint8(1, 0x41);
    badView.setUint8(2, 0x44);
    badView.setUint8(3, 0x21);
    mocks.convertAlembicToPreview.mockResolvedValue(bad);

    await expect(loadPreviewObject(abcFile)).rejects.toThrow(
      "Alembic helper returned an unsupported preview payload.",
    );
  });
});
