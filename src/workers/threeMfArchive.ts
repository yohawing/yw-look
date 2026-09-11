import { Unzip, UnzipInflate } from "three/examples/jsm/libs/fflate.module.js";

export const THREE_MF_LIMITS = {
  archiveBytes: 64 * 1024 * 1024,
  expandedBytes: 128 * 1024 * 1024,
  entryBytes: 32 * 1024 * 1024,
  xmlBytes: 16 * 1024 * 1024,
  entries: 1024,
  vertices: 500_000,
  triangles: 1_000_000,
  instances: 4096,
  depth: 64,
  texturePixels: 16_777_216,
} as const;

export function packagePath(value: string): string {
  const name = value.startsWith("/") ? value.slice(1) : value;
  if (
    !name ||
    /[\\:%?#]/.test(name) ||
    [...name].some((character) => character.charCodeAt(0) < 32) ||
    name === "__proto__" ||
    name.startsWith("/") ||
    name.split("/").some((part) => part === "." || part === ".." || part === "")
  ) {
    throw new Error(`3MF: unsafe package path: ${value}`);
  }
  return name;
}

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  crcTable[index] = value >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

/** Validate central-directory sizes before any inflation, then enforce actual output limits. */
export function unpackThreeMf(buffer: ArrayBuffer): Record<string, Uint8Array> {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 22 || bytes.length > THREE_MF_LIMITS.archiveBytes)
    throw new Error("3MF: archive size is invalid or exceeds 64 MiB");
  const view = new DataView(buffer);
  let end = -1;
  for (
    let offset = bytes.length - 22;
    offset >= Math.max(0, bytes.length - 65557);
    offset--
  ) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === bytes.length
    ) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error("3MF: missing ZIP directory");
  const count = view.getUint16(end + 10, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    view.getUint16(end + 8, true) !== count ||
    !count ||
    count > THREE_MF_LIMITS.entries ||
    directoryOffset + view.getUint32(end + 12, true) !== end
  )
    throw new Error("3MF: unsupported or oversized ZIP directory");
  const expected = new Map<string, { size: number; crc: number }>();
  const folded = new Set<string>();
  let offset = directoryOffset,
    total = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error("3MF: corrupt ZIP directory");
    const flags = view.getUint16(offset + 8, true),
      method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true),
      size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const next =
      offset +
      46 +
      nameLength +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (
      next > end ||
      local + 30 > directoryOffset ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      view.getUint16(offset + 34, true) ||
      compressed > bytes.length ||
      size > THREE_MF_LIMITS.entryBytes
    )
      throw new Error("3MF: unsupported or oversized ZIP entry");
    const rawName = decoder.decode(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    );
    const directory = rawName.endsWith("/");
    const name = packagePath(directory ? rawName.slice(0, -1) : rawName);
    if (rawName.startsWith("/") || folded.has(name.toLowerCase()))
      throw new Error(`3MF: duplicate or absolute ZIP entry: ${rawName}`);
    folded.add(name.toLowerCase());
    if (
      view.getUint32(local, true) !== 0x04034b50 ||
      view.getUint16(local + 6, true) !== flags ||
      view.getUint16(local + 8, true) !== method
    )
      throw new Error("3MF: ZIP header mismatch");
    const localNameLength = view.getUint16(local + 26, true);
    const start =
      local + 30 + localNameLength + view.getUint16(local + 28, true);
    if (
      start + compressed > directoryOffset ||
      decoder.decode(
        bytes.subarray(local + 30, local + 30 + localNameLength),
      ) !== rawName
    )
      throw new Error(
        "3MF: ZIP entry extends outside data or has a different name",
      );
    total += size;
    if (total > THREE_MF_LIMITS.expandedBytes || (directory && size !== 0))
      throw new Error("3MF: expanded package exceeds limit");
    expected.set(rawName, { size, crc: view.getUint32(offset + 16, true) });
    offset = next;
  }
  if (offset !== end) throw new Error("3MF: trailing ZIP directory data");
  const files: Record<string, Uint8Array> = Object.create(null);
  const seen = new Set<string>();
  const completed = new Set<string>();
  let expanded = 0;
  const unzip = new Unzip((file) => {
    const entry = expected.get(file.name);
    if (!entry || seen.has(file.name))
      throw new Error("3MF: unexpected or duplicate local ZIP entry");
    seen.add(file.name);
    const output = new Uint8Array(entry.size);
    let written = 0;
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      expanded += chunk.length;
      if (
        written + chunk.length > entry.size ||
        expanded > THREE_MF_LIMITS.expandedBytes
      )
        throw new Error("3MF: inflated ZIP data exceeds declared limits");
      output.set(chunk, written);
      written += chunk.length;
      if (final) {
        if (written !== entry.size || crc32(output) !== entry.crc)
          throw new Error("3MF: corrupt ZIP entry size or checksum");
        if (!file.name.endsWith("/")) files[file.name] = output;
        completed.add(file.name);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // Small input chunks bound temporary inflater output even when a ZIP lies about its size.
  for (let start = 0; start < bytes.length; start += 4096)
    unzip.push(
      bytes.subarray(start, start + 4096),
      start + 4096 >= bytes.length,
    );
  if (seen.size !== expected.size || completed.size !== expected.size)
    throw new Error("3MF: ZIP entries are missing");
  return files;
}
