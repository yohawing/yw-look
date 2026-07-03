import {
  AnimationClip,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
} from "three";
import { convertAlembicToPreview } from "../../lib/alembic";
import type { SelectedFile } from "../../lib/files";
import type { LoaderContext } from "../loaderRegistry";
import type { LoadedPreview } from "../types";

type AlembicPreviewFrame = {
  time: number;
  positions: Float32Array;
};

type AlembicPreviewMesh = {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  frames: AlembicPreviewFrame[];
};

type AlembicPreviewPayload = {
  meshes: AlembicPreviewMesh[];
};

function hasYwabMagic(source: ArrayBuffer): boolean {
  if (source.byteLength < 4) return false;
  const view = new DataView(source);
  return (
    view.getUint8(0) === 0x59 &&
    view.getUint8(1) === 0x57 &&
    view.getUint8(2) === 0x41 &&
    view.getUint8(3) === 0x42
  );
}

export function parseAlembicPreviewPayload(
  source: ArrayBuffer | string,
): AlembicPreviewPayload {
  if (typeof source === "string") {
    return parseAlembicJsonPayload(source);
  }
  if (hasYwabMagic(source)) {
    return parseAlembicBinaryPayload(source);
  }
  return parseAlembicJsonPayload(new TextDecoder().decode(source));
}

function parseAlembicBinaryPayload(source: ArrayBuffer): AlembicPreviewPayload {
  const view = new DataView(source);
  let offset = 0;

  const ensureAvailable = (byteLength: number, label: string) => {
    if (byteLength < 0 || offset + byteLength > source.byteLength) {
      throw new Error(`Alembic helper returned truncated ${label}.`);
    }
  };

  const readU32 = (label: string) => {
    ensureAvailable(4, label);
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  };

  const readF32 = (label: string) => {
    ensureAvailable(4, label);
    const value = view.getFloat32(offset, true);
    offset += 4;
    return value;
  };

  const readText = (byteLength: number, label: string) => {
    ensureAvailable(byteLength, label);
    const bytes = new Uint8Array(source, offset, byteLength);
    offset += byteLength;
    return new TextDecoder().decode(bytes);
  };

  const readFloat32Array = (elementCount: number, label: string) => {
    const byteLength = elementCount * Float32Array.BYTES_PER_ELEMENT;
    ensureAvailable(byteLength, label);
    const array =
      offset % Float32Array.BYTES_PER_ELEMENT === 0
        ? new Float32Array(source, offset, elementCount)
        : new Float32Array(source.slice(offset, offset + byteLength));
    offset += byteLength;
    return array;
  };

  const readUint32Array = (elementCount: number, label: string) => {
    const byteLength = elementCount * Uint32Array.BYTES_PER_ELEMENT;
    ensureAvailable(byteLength, label);
    const array =
      offset % Uint32Array.BYTES_PER_ELEMENT === 0
        ? new Uint32Array(source, offset, elementCount)
        : new Uint32Array(source.slice(offset, offset + byteLength));
    offset += byteLength;
    return array;
  };

  ensureAvailable(16, "header");
  if (
    view.getUint8(0) !== 0x59 ||
    view.getUint8(1) !== 0x57 ||
    view.getUint8(2) !== 0x41 ||
    view.getUint8(3) !== 0x42
  ) {
    throw new Error("Alembic helper returned an unsupported preview payload.");
  }
  offset = 4;
  const version = readU32("version");
  if (version !== 1) {
    throw new Error(`Alembic helper returned unsupported payload v${version}.`);
  }
  const meshCount = readU32("mesh count");
  const reserved = readU32("reserved header field");
  if (reserved !== 0) {
    throw new Error("Alembic helper returned an unsupported preview payload.");
  }

  const meshes: AlembicPreviewMesh[] = [];
  for (let meshIndex = 0; meshIndex < meshCount; meshIndex += 1) {
    const nameLength = readU32("mesh name length");
    const name = readText(nameLength, "mesh name");
    const vertexCount = readU32("vertex count");
    const indexCount = readU32("index count");
    const frameCount = readU32("frame count");
    const positionElementCount = vertexCount * 3;

    if (
      positionElementCount === 0 ||
      !Number.isSafeInteger(positionElementCount)
    ) {
      throw new Error("Alembic helper returned invalid mesh positions.");
    }
    if (indexCount === 0 || indexCount % 3 !== 0) {
      throw new Error("Alembic helper returned invalid mesh indices.");
    }

    const positions = readFloat32Array(positionElementCount, "base positions");
    const indices = readUint32Array(indexCount, "indices");
    const frames: AlembicPreviewFrame[] = [];

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const time = readF32("frame time");
      const framePositions = readFloat32Array(
        positionElementCount,
        "frame positions",
      );
      if (!Number.isFinite(time)) {
        continue;
      }
      frames.push({ time, positions: framePositions });
    }

    meshes.push({ name, positions, indices, frames });
  }

  if (offset !== source.byteLength) {
    throw new Error("Alembic helper returned trailing preview bytes.");
  }

  return { meshes };
}

function parseAlembicJsonPayload(source: string): AlembicPreviewPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Alembic helper returned malformed preview JSON.");
  }

  const data = parsed as {
    format?: string;
    meshes?: Array<{
      name?: string;
      positions?: number[];
      indices?: number[];
      frames?: Array<{ time?: number; positions?: number[] }>;
    }>;
  };

  if (
    data.format !== "yw-look-alembic-preview-v1" ||
    !Array.isArray(data.meshes)
  ) {
    throw new Error("Alembic helper returned malformed preview JSON.");
  }

  return {
    meshes: data.meshes.map((m) => ({
      name: m.name ?? "",
      positions: new Float32Array(m.positions ?? []),
      indices: new Uint32Array(m.indices ?? []),
      frames: (m.frames ?? []).map((f) => ({
        time: f.time ?? 0,
        positions: new Float32Array(f.positions ?? []),
      })),
    })),
  };
}

function createAlembicPreview(
  payload: AlembicPreviewPayload,
): Pick<LoadedPreview, "object" | "clips" | "formatVersion"> {
  const object = new Group();
  object.name = "Alembic Preview";
  const tracks: NumberKeyframeTrack[] = [];
  let animatedMeshCount = 0;

  for (const [meshIndex, meshPayload] of payload.meshes.entries()) {
    if (
      meshPayload.positions.length === 0 ||
      meshPayload.positions.length % 3 !== 0 ||
      meshPayload.indices.length === 0 ||
      meshPayload.indices.length % 3 !== 0
    ) {
      continue;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(meshPayload.positions, 3),
    );
    geometry.setIndex(new BufferAttribute(meshPayload.indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const mesh = new Mesh(
      geometry,
      new MeshStandardMaterial({
        color: "#cfd6e3",
        metalness: 0.04,
        roughness: 0.76,
        side: DoubleSide,
      }),
    );
    mesh.name = `AlembicMesh_${meshIndex + 1}`;
    if (meshPayload.name) {
      mesh.userData.sourceName = meshPayload.name;
    }

    const frames = meshPayload.frames
      .filter(
        (frame) =>
          Number.isFinite(frame.time) &&
          frame.positions.length === meshPayload.positions.length,
      )
      .sort((a, b) => a.time - b.time);

    if (frames.length > 0) {
      geometry.morphTargetsRelative = true;
      geometry.morphAttributes.position = frames.map((frame) => {
        const offsets = new Float32Array(frame.positions.length);
        for (let index = 0; index < frame.positions.length; index += 1) {
          offsets[index] =
            frame.positions[index] - meshPayload.positions[index];
        }
        return new BufferAttribute(offsets, 3);
      });
      mesh.morphTargetInfluences = frames.map(() => 0);
      mesh.morphTargetDictionary = Object.fromEntries(
        frames.map((_, index) => [`sample_${index + 1}`, index]),
      );

      const startTime = Math.min(0, frames[0].time);
      const times = [startTime, ...frames.map((frame) => frame.time)];
      for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
        tracks.push(
          new NumberKeyframeTrack(
            `${mesh.name}.morphTargetInfluences[${frameIndex}]`,
            times,
            times.map((_, timeIndex) => (timeIndex === frameIndex + 1 ? 1 : 0)),
          ),
        );
      }
      animatedMeshCount += 1;
    }

    object.add(mesh);
  }

  if (object.children.length === 0) {
    throw new Error("Alembic conversion returned no renderable mesh data.");
  }

  const clips =
    tracks.length > 0
      ? [
          new AnimationClip(
            "Alembic Geometry Cache",
            Math.max(
              ...tracks.map(
                (track) => track.times[track.times.length - 1] ?? 0,
              ),
            ),
            tracks,
          ),
        ]
      : [];

  return {
    object,
    clips,
    formatVersion:
      animatedMeshCount > 0
        ? "Alembic geometry cache"
        : "Alembic static sample 0",
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("Model load was canceled.");
    error.name = "AbortError";
    throw error;
  }
}

export async function loadAbcPreviewObject(
  file: SelectedFile,
  context: LoaderContext,
): Promise<LoadedPreview> {
  const reportStage = context.onStage ?? (() => undefined);
  reportStage("decode");
  const rawPreview = await convertAlembicToPreview(file.path);
  const previewPayload = parseAlembicPreviewPayload(rawPreview);
  throwIfAborted(context.signal);
  reportStage("scene");
  const preview = createAlembicPreview(previewPayload);
  reportStage("gpu");
  return {
    object: preview.object,
    cleanupUrls: [],
    clips: preview.clips,
    formatVersion: preview.formatVersion,
  };
}
