import { LoadingScreen } from "./LoadingScreen";

export type ViewerMode =
  | "empty"
  | "loading"
  | "ready"
  | "unsupported"
  | "loadFailed"
  | "missingReference";

type ViewerStatePanelProps = {
  mode: ViewerMode;
  fileName?: string | null;
};

const supportedFormats = [
  "glb",
  "gltf",
  "fbx",
  "obj",
  "usd",
  "usdz",
  "vrm",
  "png",
  "jpg",
  "exr",
  "hdr",
  "ktx2",
];

const stateContent: Record<
  ViewerMode,
  {
    label: string;
    title: string;
    body: string;
    tone: "neutral" | "warning" | "danger";
    details?: string[];
  }
> = {
  empty: {
    label: "yw-look",
    title: "Drop a file here to preview",
    body: "Drag & drop a 3D model or texture onto this window, or use File to open.",
    tone: "neutral",
  },
  loading: {
    label: "Loading State",
    title: "Preparing asset preview and metadata panels.",
    body: "Use this state while a file is being resolved, decoded, and fitted to the viewer camera.",
    tone: "neutral",
    details: [
      "Lock navigation during critical scene replacement.",
      "Keep the last stable status visible in the footer.",
    ],
  },
  ready: {
    label: "Preview Ready",
    title: "The scene is active and camera controls are enabled.",
    body: "This state is handled by the live viewport and should not remain overlaid.",
    tone: "neutral",
  },
  unsupported: {
    label: "Unsupported Format",
    title: "This file type is not mapped to a loader yet.",
    body: "The app should clearly show that the file was opened, but the current build does not have a compatible reader for this extension.",
    tone: "warning",
    details: [
      "Show the file extension and path in the final implementation.",
      "Offer retry after future loader support lands.",
    ],
  },
  loadFailed: {
    label: "Load Error",
    title: "The asset could not be parsed into a preview scene.",
    body: "Use this screen for broken files, parser exceptions, or renderer setup failures that block preview generation.",
    tone: "danger",
    details: [
      "Expose a concise user-facing reason first.",
      "Keep technical details for logs and diagnostics.",
    ],
  },
  missingReference: {
    label: "Missing Reference",
    title:
      "The main file was found, but one or more linked resources are missing.",
    body: "Use this state when external textures, buffers, or sidecar files cannot be resolved from the opened asset.",
    tone: "warning",
    details: [
      "Preserve enough context for reloading after the files are restored.",
      "Surface unresolved file names in a dedicated details area later.",
    ],
  },
};

export function ViewerStatePanel({ fileName, mode }: ViewerStatePanelProps) {
  const content = stateContent[mode];

  if (mode === "loading") {
    return <LoadingScreen fileName={fileName} />;
  }

  if (mode === "empty") {
    return (
      <div className="viewer-empty-state" aria-label="Drop file">
        <div className="viewer-empty-iso" aria-hidden="true">
          <svg width="160" height="160" viewBox="-80 -80 160 160" fill="none">
            <g opacity="0.35">
              <path
                d="M0 -52 L52 -26 L0 0 L-52 -26 Z"
                stroke="currentColor"
                strokeWidth="0.8"
              />
              <path
                d="M-52 -26 L0 0 L0 52 L-52 26 Z"
                stroke="currentColor"
                strokeWidth="0.8"
              />
              <path
                d="M52 -26 L0 0 L0 52 L52 26 Z"
                stroke="currentColor"
                strokeWidth="0.8"
              />
            </g>
            <g className="viewer-empty-target" transform="translate(0,-14)">
              <path d="M0 -34 L30 -19 L0 -4 L-30 -19 Z" />
              <path d="M-30 -19 L0 -4 L0 26 L-30 11 Z" opacity="0.72" />
              <path d="M30 -19 L0 -4 L0 26 L30 11 Z" opacity="0.52" />
              <path
                className="viewer-empty-arrow"
                d="M0 -22 L0 -10 M-4 -14 L0 -10 L4 -14"
              />
            </g>
          </svg>
        </div>
        <div className="viewer-empty-copy">
          <h2>Drop a file to inspect</h2>
          <p>
            Drag & drop here, or use <span>File / Open</span>.
          </p>
        </div>
        <div className="viewer-empty-formats" aria-label="Supported formats">
          {supportedFormats.map((format) => (
            <span key={format}>{format}</span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`viewer-state viewer-state-${content.tone}`}>
      <p className="viewer-label">{content.label}</p>
      <h2>{content.title}</h2>
      <p>{content.body}</p>
      {content.details ? (
        <ul className="viewer-details">
          {content.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
