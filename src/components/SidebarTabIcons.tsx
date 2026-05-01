export type SidebarTabId =
  | "properties"
  | "file"
  | "hierarchy"
  | "materials"
  | "textures"
  | "settings"
  | "warnings";

export function SidebarTabIcon({ kind }: { kind: SidebarTabId }) {
  switch (kind) {
    case "properties":
      return (
        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle
            cx="8"
            cy="8"
            r="5.8"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M8 7.2v4.2"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.2"
          />
          <circle cx="8" cy="4.9" r="0.7" fill="currentColor" />
        </svg>
      );
    case "file":
      return (
        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M1.8 4.5h4.4l1.2 1.4h6.8v7.2a1.4 1.4 0 0 1-1.4 1.4H3.2a1.4 1.4 0 0 1-1.4-1.4V4.5Z"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M1.8 6h12.4M2.8 3h3.5l1.1 1.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.2"
          />
        </svg>
      );
    case "hierarchy":
      return (
        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="4" cy="4" r="2" stroke="currentColor" strokeWidth="1.2" />
          <circle
            cx="12"
            cy="4"
            r="2"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <circle
            cx="8"
            cy="12"
            r="2"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M5 5.5L7 10.5M11 5.5L9 10.5"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
      );
    case "materials":
      return (
        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle
            cx="8"
            cy="8"
            r="5.5"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <circle cx="8" cy="8" r="2" fill="currentColor" opacity="0.5" />
        </svg>
      );
    case "textures":
      return (
        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect
            x="2"
            y="2"
            width="12"
            height="12"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M2 11l3-3 2 2 3-4 4 5"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle
            cx="8"
            cy="8"
            r="2.5"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.2"
          />
        </svg>
      );
    case "warnings":
      return (
        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M8 1.5L1.5 13.5h13L8 1.5Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.2"
          />
          <path
            d="M8 6v4"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.2"
          />
          <circle cx="8" cy="11.5" r="0.6" fill="currentColor" />
        </svg>
      );
  }
}
