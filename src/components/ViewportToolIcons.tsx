export type ViewportToolIcon =
  | "axis"
  | "backface"
  | "bbox"
  | "camera"
  | "channel"
  | "checker"
  | "colorspace"
  | "environment"
  | "grid"
  | "inspect"
  | "light"
  | "look"
  | "matcap"
  | "normals"
  | "overlay"
  | "palette"
  | "sceneLight"
  | "shadow"
  | "skeleton"
  | "texture"
  | "tiling"
  | "uv"
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
    case "channel":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="2" width="5" height="5" rx="1" />
          <rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" />
          <rect x="9" y="9" width="5" height="5" rx="1" />
        </svg>
      );
    case "checker":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1" y="1" width="6" height="6" rx="0.5" />
          <rect x="9" y="1" width="6" height="6" rx="0.5" />
          <rect x="1" y="9" width="6" height="6" rx="0.5" />
          <rect x="9" y="9" width="6" height="6" rx="0.5" />
        </svg>
      );
    case "colorspace":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 2.5A5.5 5.5 0 0 0 2.5 8M13.5 8A5.5 5.5 0 0 0 8 2.5" />
          <circle cx="4.5" cy="5" r="1" />
          <circle cx="11.5" cy="11" r="1" />
        </svg>
      );
    case "inspect":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="6.5" cy="6.5" r="4" />
          <path d="M9.5 9.5 14 14" />
        </svg>
      );
    case "look":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="3" />
          <path d="M2 8s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z" />
          <circle cx="8" cy="8" r="1" />
        </svg>
      );
    case "matcap":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6" />
          <circle cx="5" cy="5" r="1.5" />
          <path d="M4 8.5a4 4 0 0 1 8 0" />
        </svg>
      );
    case "overlay":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="3" y="3" width="10" height="10" rx="0.5" />
          <rect x="5" y="5" width="6" height="6" rx="0.5" />
        </svg>
      );
    case "sceneLight":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="7" r="3.5" />
          <path d="M8 2.5V1.5M8 12.5v1M3 7H2m12 0h-1M4.5 4.5l-.7-.7m8.4 8.4-.7-.7M4.5 9.5l-.7.7m8.4-8.4-.7.7" />
        </svg>
      );
    case "shadow":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <ellipse cx="8" cy="12" rx="5" ry="2" />
          <circle cx="8" cy="6" r="4" />
        </svg>
      );
    case "tiling":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1" y="1" width="6" height="6" rx="0.5" />
          <rect x="1" y="9" width="6" height="6" rx="0.5" />
          <rect x="9" y="1" width="6" height="6" rx="0.5" />
          <rect x="9" y="9" width="6" height="6" rx="0.5" />
          <path d="M4 4v4M7 7H4" />
        </svg>
      );
    case "uv":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="2" width="12" height="12" rx="0.5" />
          <path d="M2 8h12M8 2v12" />
          <path d="M2 2l12 12" />
        </svg>
      );
  }
}
