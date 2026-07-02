function clampUnit(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

/** Convert a linear [0, 1] float to a 2-digit lowercase hex string. */
export function linearToHex(value: number): string {
  return Math.round(clampUnit(value) * 255)
    .toString(16)
    .padStart(2, "0");
}

/** Format a linearized RGB triple as a lowercase CSS hex color string. */
export function rgbToHex(r: number, g: number, b: number): string {
  return `#${linearToHex(r)}${linearToHex(g)}${linearToHex(b)}`;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** Format a byte count using binary units. Absent values render as an em dash. */
export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (!Number.isFinite(value) || value < 0) {
    return "0 B";
  }
  if (value < 1024) {
    return `${Math.round(value)} B`;
  }

  let size = value / 1024;
  let unitIndex = 1;
  while (size >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(1)} ${BYTE_UNITS[unitIndex]}`;
}
