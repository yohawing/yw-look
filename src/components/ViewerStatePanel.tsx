import { LoadingScreen } from "./LoadingScreen";
import {
  formatDisabledOptionalLoaderMessage,
  formatIncompatibleOptionalLoaderMessage,
  formatMissingOptionalLoaderMessage,
  formatUnsupportedFormatMessage,
  listRegisteredLoaders,
  type DeferredTextureSnapshot,
  type LoadingStageSnapshot,
} from "../viewer";

import type { ViewerMode } from "../types/viewer";
import "../styles/viewer-state.css";

export type { ViewerMode } from "../types/viewer";

type ViewerStatePanelProps = {
  mode: ViewerMode;
  fileName?: string | null;
  fileExtension?: string | null;
  loadingStage?: LoadingStageSnapshot | null;
  deferredTexture?: DeferredTextureSnapshot | null;
  onOpenFile?: () => void;
};

const registeredLoaders = listRegisteredLoaders();
const supportedPreviewExtensions = registeredLoaders.map(
  (loader) => loader.extension,
);
const coreFormats = registeredLoaders
  .filter((loader) => !loader.optional)
  .map((loader) => loader.extension);
const optionalFormats = registeredLoaders
  .filter((loader) => loader.optional)
  .map((loader) => loader.extension);

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
    label: "Loading",
    title: "Preparing preview",
    body: "The file is being opened and prepared for display.",
    tone: "neutral",
    details: [
      "Large files can take a moment.",
      "Linked textures or payloads may continue loading after the preview appears.",
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
    body: "This build cannot preview the selected file type.",
    tone: "warning",
    details: [
      "Core loader support is built into this app.",
      "Optional formats are listed separately when they require a loader pack.",
    ],
  },
  missingOptionalLoader: {
    label: "Optional Loader Missing",
    title: "A loader pack is required for this file.",
    body: "The file extension is recognized, but this installation does not include the optional loader needed to preview it.",
    tone: "warning",
    details: [
      "Install the matching loader pack when it becomes available.",
      "Reopen the file after the loader pack is installed.",
    ],
  },
  disabledOptionalLoader: {
    label: "Optional Loader Disabled",
    title: "A loader pack is disabled for this file.",
    body: "The file extension is recognized, but its optional loader pack is currently disabled.",
    tone: "warning",
    details: [
      "Enable the matching loader pack in Settings.",
      "Reopen the file after changing the loader pack setting.",
    ],
  },
  incompatibleOptionalLoader: {
    label: "Optional Loader Incompatible",
    title: "A loader pack is not compatible with this app version.",
    body: "The file extension is recognized, but its optional loader pack cannot run with the current app version.",
    tone: "warning",
    details: [
      "Update yw-look or reinstall the matching loader pack.",
      "Reopen the file after the app and loader pack versions match.",
    ],
  },
  loadFailed: {
    label: "Load Error",
    title: "This file could not be previewed.",
    body: "The file may be damaged or use data this build cannot read.",
    tone: "danger",
    details: [
      "Try another file or check that linked resources are available.",
      "If this keeps happening, share the file and error details with support.",
    ],
  },
  missingReference: {
    label: "Missing Reference",
    title:
      "The main file was found, but one or more linked resources are missing.",
    body: "Some linked textures, buffers, or sidecar files could not be found.",
    tone: "warning",
    details: [
      "Move the missing files next to the asset, then reopen it.",
      "File names may appear in the warning panel when available.",
    ],
  },
};

export function ViewerStatePanel({
  deferredTexture,
  fileExtension,
  fileName,
  loadingStage,
  mode,
  onOpenFile,
}: ViewerStatePanelProps) {
  const baseContent = stateContent[mode];
  const unsupportedMessage =
    mode === "unsupported" && fileExtension
      ? formatUnsupportedFormatMessage(
          fileExtension,
          supportedPreviewExtensions,
        )
      : null;
  const optionalLoaderMessage =
    mode === "missingOptionalLoader" && fileExtension
      ? formatMissingOptionalLoaderMessage(fileExtension)
      : null;
  const disabledOptionalLoaderMessage =
    mode === "disabledOptionalLoader" && fileExtension
      ? formatDisabledOptionalLoaderMessage(fileExtension)
      : null;
  const incompatibleOptionalLoaderMessage =
    mode === "incompatibleOptionalLoader" && fileExtension
      ? formatIncompatibleOptionalLoaderMessage(fileExtension)
      : null;
  const content = {
    ...baseContent,
    ...(unsupportedMessage ??
      optionalLoaderMessage ??
      disabledOptionalLoaderMessage ??
      incompatibleOptionalLoaderMessage ??
      {}),
  };

  if (mode === "loading") {
    return (
      <LoadingScreen
        deferredTexture={deferredTexture}
        fileName={fileName}
        stage={loadingStage}
      />
    );
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
          <h2>Inspect a model or texture</h2>
          <p>Open a file or drop one here to preview the asset.</p>
        </div>
        <div className="viewer-empty-actions">
          <button onClick={onOpenFile} type="button">
            Open File
          </button>
          <span>Drag & Drop</span>
        </div>
        <div className="viewer-empty-format-groups">
          <div>
            <p>Core</p>
            <div
              className="viewer-empty-formats"
              aria-label="Supported formats"
            >
              {coreFormats.map((format) => (
                <span key={format}>{format}</span>
              ))}
            </div>
          </div>
          <div>
            <p>Optional packs</p>
            <div
              className="viewer-empty-formats viewer-empty-formats-optional"
              aria-label="Optional formats"
            >
              {optionalFormats.map((format) => (
                <span key={format}>{format}</span>
              ))}
            </div>
          </div>
        </div>
        <p className="viewer-empty-hint">
          Use Left / Right after opening a file to browse nearby assets.
        </p>
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
