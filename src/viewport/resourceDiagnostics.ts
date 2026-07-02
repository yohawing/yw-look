import type { WebGLRenderer } from "three";
import type {
  AssetResourceMetrics,
  ResourceDiagnosticsSnapshot,
} from "../lib/diagnostics";
import type { AssetMetadata } from "../types/viewer";

export const RESOURCE_DIAGNOSTICS_SAMPLE_MS = 2000;
const MEMORY_SAMPLE_GRANULARITY_BYTES = 1024 * 1024;

type PerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize?: number;
    totalJSHeapSize?: number;
    jsHeapSizeLimit?: number;
  };
};

export function readMemoryMetrics(): ResourceDiagnosticsSnapshot["memory"] {
  const memory = (performance as PerformanceWithMemory).memory;
  const stableBytes = (value: number | undefined) =>
    typeof value === "number"
      ? Math.round(value / MEMORY_SAMPLE_GRANULARITY_BYTES) *
        MEMORY_SAMPLE_GRANULARITY_BYTES
      : null;

  return {
    jsHeapUsedBytes: stableBytes(memory?.usedJSHeapSize),
    jsHeapTotalBytes: stableBytes(memory?.totalJSHeapSize),
    jsHeapLimitBytes: stableBytes(memory?.jsHeapSizeLimit),
  };
}

export function collectAssetResourceMetrics(
  metadata: AssetMetadata,
): AssetResourceMetrics {
  let vertices = 0;
  let triangles = 0;

  for (const objectInfo of Object.values(metadata.objectInfo)) {
    vertices += objectInfo.vertexCount ?? 0;
    triangles += objectInfo.triangleCount ?? 0;
  }

  return {
    vertices,
    triangles,
    materials: metadata.materialCount,
    textures: metadata.textureCount,
  };
}

export function collectResourceDiagnosticsSnapshot(
  renderer: WebGLRenderer,
  asset: AssetResourceMetrics | null,
): ResourceDiagnosticsSnapshot {
  const info = renderer.info;
  const programs = info.programs;
  return {
    sampledAt: performance.now(),
    webgl: {
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: Array.isArray(programs) ? programs.length : null,
      calls: info.render.calls,
      triangles: info.render.triangles,
      points: info.render.points,
      lines: info.render.lines,
    },
    memory: readMemoryMetrics(),
    asset,
  };
}

export function resourceDiagnosticsSignature(
  snapshot: ResourceDiagnosticsSnapshot,
) {
  return JSON.stringify({
    webgl: snapshot.webgl,
    memory: snapshot.memory,
    asset: snapshot.asset,
  });
}
