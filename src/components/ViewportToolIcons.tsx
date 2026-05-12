export type ViewportToolIcon =
  | "axis"
  | "backface"
  | "bbox"
  | "camera"
  | "environment"
  | "grid"
  | "light"
  | "normals"
  | "ortho"
  | "palette"
  | "skeleton"
  | "texture"
  | "vertex"
  | "wireframe";

export function ViewportToolSvg({ icon }: { icon: ViewportToolIcon }) {
  switch (icon) {
    case "axis":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 13V3M3 13h10M8 3l3 3M8 3 5 6" />
        </svg>
      );
    case "backface":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 3h8v10H4z" />
          <path d="M7 6h5M7 10h5" />
        </svg>
      );
    case "bbox":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 5.5 8 3l5 2.5v5L8 13l-5-2.5z" />
          <path d="M3 5.5 8 8l5-2.5M8 8v5" />
        </svg>
      );
    case "camera":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 5h6.5a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H3z" />
          <path d="m11.5 7 2.5-1.5v5L11.5 9" />
        </svg>
      );
    case "environment":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 10.5 6 7l2 2 2.5-3 3 4.5" />
          <path d="M3 3h10v10H3z" />
        </svg>
      );
    case "grid":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 3h10v10H3zM3 8h10M8 3v10" />
        </svg>
      );
    case "light":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2M4.1 4.1l1.4 1.4M10.5 10.5l1.4 1.4M4.1 11.9l1.4-1.4M10.5 5.5l1.4-1.4" />
          <circle cx="8" cy="8" r="2" />
        </svg>
      );
    case "normals":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 12h10L8 4zM8 8V2M8 2l2 2M8 2 6 4" />
        </svg>
      );
    case "ortho":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="3" y="3" width="10" height="10" />
          <path d="M3 3h10M3 13h10M3 3v10M13 3v10" />
        </svg>
      );
    case "palette":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 11.5h10M4 8h8M5 4.5h6" />
        </svg>
      );
    case "skeleton":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="3.5" r="1.5" />
          <path d="M8 5v4M5 7h6M6 13l2-4 2 4" />
        </svg>
      );
    case "texture":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 3h10v10H3z" />
          <path d="m3 11 3-3 2 2 2.5-3 2.5 4" />
        </svg>
      );
    case "vertex":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="4" cy="4" r="1.5" />
          <circle cx="12" cy="4" r="1.5" />
          <circle cx="8" cy="12" r="1.5" />
          <path d="m5 5 2.2 5M11 5 8.8 10M5.5 4h5" />
        </svg>
      );
    case "wireframe":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 11.5 8 3l5 8.5zM5.4 8h5.2M8 3v8.5" />
        </svg>
      );
  }
}
