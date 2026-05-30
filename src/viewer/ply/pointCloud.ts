/**
 * Point-cloud renderer for PLY files whose header contains only vertex data
 * (no face elements, no Gaussian-splat attributes).
 *
 * The resulting `THREE.Points` is wrapped in a `THREE.Group` so that the
 * return type stays `Group | Mesh` as required by `LoadedPreview.object`.
 */

import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";

import type { LoadedPreview } from "../../types/viewer";

// ── Public types ─────────────────────────────────────────────────────────────

export type PointCloudBounds = {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
};

export type PointCloudDetail = {
  pointCount: number;
  hasColor: boolean;
  hasNormals: boolean;
  bounds: PointCloudBounds | null;
};

// ── buildPointCloudPreview ────────────────────────────────────────────────────

/**
 * Parse a PLY `ArrayBuffer` and build a Three.js `Points` object suitable for
 * the yw-look viewer.
 *
 * @returns `preview`  – a `LoadedPreview` whose `object` is a `Group` wrapping
 *                       the `Points` (kept for type compatibility).
 *          `detail`   – point-cloud statistics for the Detail panel.
 */
export function buildPointCloudPreview(buffer: ArrayBuffer): {
  preview: LoadedPreview;
  detail: PointCloudDetail;
} {
  // ── Parse geometry ───────────────────────────────────────────────────────
  const geometry = new PLYLoader().parse(buffer);

  const positionAttr = geometry.attributes.position;
  const colorAttr = geometry.attributes.color;
  const normalAttr = geometry.attributes.normal;

  const pointCount = positionAttr?.count ?? 0;
  const hasColor = !!colorAttr;
  const hasNormals = !!normalAttr;

  // ── Bounding box ─────────────────────────────────────────────────────────
  let bounds: PointCloudBounds | null = null;
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (bb && !bb.isEmpty()) {
    const sizeVec = new THREE.Vector3();
    bb.getSize(sizeVec);
    bounds = {
      min: [bb.min.x, bb.min.y, bb.min.z],
      max: [bb.max.x, bb.max.y, bb.max.z],
      size: [sizeVec.x, sizeVec.y, sizeVec.z],
    };
  }

  // ── Point size (world-space) ─────────────────────────────────────────────
  // Default to a reasonable fraction of the longest bounding dimension.
  // Clamped so tiny or huge models still look sensible.
  let pointSize = 0.015; // fallback when bounds are unknown
  if (bounds) {
    const maxDim = Math.max(...bounds.size);
    if (maxDim > 0) {
      pointSize = Math.max(0.001, Math.min(0.05, maxDim * 0.002));
    }
  }

  // ── Material ─────────────────────────────────────────────────────────────
  const material = new THREE.PointsMaterial({
    size: pointSize,
    sizeAttenuation: true,
    vertexColors: hasColor,
    ...(hasColor ? {} : { color: new THREE.Color("#c7d2e3") }),
  });

  // ── Points + Group wrapper ───────────────────────────────────────────────
  const points = new THREE.Points(geometry, material);
  const group = new THREE.Group();
  group.add(points);

  // ── Assemble preview ─────────────────────────────────────────────────────
  const preview: LoadedPreview = {
    object: group,
    cleanupUrls: [],
    // `disposeObject` only frees `Mesh` children, so a point cloud's
    // `Points` geometry/material would otherwise leak on file switch.
    cleanupCallbacks: [
      () => {
        geometry.dispose();
        material.dispose();
      },
    ],
    clips: [],
    formatVersion: null,
    assetKind: "pointCloud",
    skipScaleNormalization: false,
  };

  const detail: PointCloudDetail = {
    pointCount,
    hasColor,
    hasNormals,
    bounds,
  };

  return { preview, detail };
}
