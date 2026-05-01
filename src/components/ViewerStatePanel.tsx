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
};

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

export function ViewerStatePanel({ mode }: ViewerStatePanelProps) {
  const content = stateContent[mode];

  if (mode === "loading") {
    return <LoadingScreen />;
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
