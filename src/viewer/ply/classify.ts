/**
 * PLY header parsing and asset-kind classification.
 *
 * Parses only the ASCII header section (up to "end_header") without reading
 * the binary body so it stays fast even for large files.
 */

import type { ViewerAssetKind } from "../../types/viewer";

// ── Public types ─────────────────────────────────────────────────────────────

export type PlyPropertyDef = {
  name: string;
  type: string;
  isList?: boolean;
};

export type PlyElementDef = {
  name: string;
  count: number;
  properties: PlyPropertyDef[];
};

export type PlyHeader = {
  format: "ascii" | "binary_little_endian" | "binary_big_endian";
  elements: PlyElementDef[];
  /**
   * Byte offset of the first data byte immediately after "end_header\n".
   * For ASCII PLY, `end_header` may be followed by `\r\n` on Windows;
   * we normalise to `\n` when scanning.
   */
  headerLength: number;
  comments: string[];
};

// ── Gaussian splat property signature ────────────────────────────────────────

/**
 * Minimum property names that indicate a Gaussian-splat vertex element.
 * Two alternate conventions are checked:
 *   1. SphericalHarmonics DC coefficient: `f_dc_0`
 *   2. Scale + rotation + opacity triple: `scale_0`, `rot_0`, `opacity`
 */
const SPLAT_SIGNATURE_SH = new Set(["f_dc_0"]);
const SPLAT_SIGNATURE_SCALE_ROT: ReadonlyArray<string> = [
  "scale_0",
  "rot_0",
  "opacity",
];

// ── parsePlyHeader ────────────────────────────────────────────────────────────

/**
 * Parse the ASCII header of a PLY file from an `ArrayBuffer`.
 *
 * Throws if the buffer does not start with the "ply" magic token or if the
 * "end_header" sentinel cannot be found within a reasonable prefix.
 */
export function parsePlyHeader(buffer: ArrayBuffer): PlyHeader {
  // We only need to decode the ASCII header, but TextDecoder on the whole
  // buffer is cheap for the prefix we'll actually use.
  const MAX_HEADER_SCAN = Math.min(buffer.byteLength, 1_048_576); // 1 MiB cap
  const rawText = new TextDecoder("utf-8", { fatal: false }).decode(
    buffer.slice(0, MAX_HEADER_SCAN),
  );

  // Normalise line endings so we can split on "\n" uniformly.
  const normalised = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const endHeaderToken = "end_header\n";
  const endHeaderIndex = normalised.indexOf(endHeaderToken);
  if (endHeaderIndex === -1) {
    throw new Error("PLY parse error: 'end_header' not found in buffer");
  }

  const headerText = normalised.slice(
    0,
    endHeaderIndex + endHeaderToken.length,
  );
  const lines = headerText.split("\n").map((l) => l.trim());

  // Validate magic.
  if (lines[0] !== "ply") {
    throw new Error(`PLY parse error: expected 'ply' magic, got '${lines[0]}'`);
  }

  // The byte offset is the length of the original (non-normalised) text up to
  // and including "end_header\n".  Because we replaced \r\n → \n, we need to
  // measure the original bytes.  We do this by re-scanning the original rawText.
  const endHeaderTokenOrig = "end_header";
  const origEndIdx = rawText.indexOf(endHeaderTokenOrig);
  // Find end-of-line after "end_header" (could be \r\n or \n).
  let headerByteLength = origEndIdx + endHeaderTokenOrig.length;
  if (rawText[headerByteLength] === "\r") headerByteLength++;
  if (rawText[headerByteLength] === "\n") headerByteLength++;
  // Convert character offset to byte offset via re-encoding (handles multi-byte
  // chars in comments even though that is very rare).
  const headerLength = new TextEncoder().encode(
    rawText.slice(0, headerByteLength),
  ).byteLength;

  // Parse remaining header lines.
  let format: PlyHeader["format"] | null = null;
  const comments: string[] = [];
  const elements: PlyElementDef[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line === "end_header") continue;

    if (line.startsWith("format ")) {
      const parts = line.split(/\s+/);
      const fmt = parts[1] as PlyHeader["format"];
      if (
        fmt !== "ascii" &&
        fmt !== "binary_little_endian" &&
        fmt !== "binary_big_endian"
      ) {
        throw new Error(`PLY parse error: unknown format '${fmt}'`);
      }
      format = fmt;
    } else if (line.startsWith("comment ")) {
      comments.push(line.slice("comment ".length));
    } else if (line.startsWith("element ")) {
      const parts = line.split(/\s+/);
      elements.push({
        name: parts[1],
        count: parseInt(parts[2], 10),
        properties: [],
      });
    } else if (line.startsWith("property ")) {
      if (elements.length === 0) continue; // malformed but tolerate
      const currentElement = elements[elements.length - 1];
      const parts = line.split(/\s+/);
      if (parts[1] === "list") {
        // e.g. "property list uchar int vertex_indices"
        currentElement.properties.push({
          name: parts[4],
          type: `list ${parts[2]} ${parts[3]}`,
          isList: true,
        });
      } else {
        // e.g. "property float x"
        currentElement.properties.push({
          name: parts[2],
          type: parts[1],
        });
      }
    }
    // obj_info and unknown keywords are silently skipped.
  }

  if (format === null) {
    throw new Error("PLY parse error: 'format' line not found");
  }

  return { format, elements, headerLength, comments };
}

// ── detectPlyKind ─────────────────────────────────────────────────────────────

/**
 * Classify a parsed PLY header into one of the three viewer asset kinds.
 *
 * Decision order (first match wins):
 *  1. `element face` with count > 0  →  `"mesh"`
 *  2. vertex properties contain Gaussian splat signature  →  `"gaussianSplat"`
 *  3. otherwise  →  `"pointCloud"`
 */
export function detectPlyKind(header: PlyHeader): ViewerAssetKind {
  const hasFace = header.elements.some(
    (el) => el.name === "face" && el.count > 0,
  );
  if (hasFace) return "mesh";

  const vertexEl = header.elements.find((el) => el.name === "vertex");
  if (vertexEl) {
    const propNames = new Set(vertexEl.properties.map((p) => p.name));

    // Check SH convention first (f_dc_0 alone is sufficient).
    if (propNames.has([...SPLAT_SIGNATURE_SH][0])) return "gaussianSplat";

    // Check scale/rot/opacity triple.
    if (SPLAT_SIGNATURE_SCALE_ROT.every((p) => propNames.has(p))) {
      return "gaussianSplat";
    }
  }

  return "pointCloud";
}
