import { useEffect, useRef, useState } from "react";
import { flattenStage, loadUsdSource, type UsdSourcePayload } from "../lib/usd";
import type { SelectedFile } from "../lib/files";
import {
  SidebarEmpty,
  SidebarError,
  SidebarSection,
} from "./sidebarPrimitives";

type UsdSourceCardProps = {
  /** The currently open USD asset. The card is hidden when `null`
   * because there is no source to load. */
  currentFile: SelectedFile | null;
};

/** Hard cap on rendered text size. USD source files are usually
 * compact, but a heavily authored stage can run to multiple MB; we
 * truncate at this threshold so the inspector never tries to layout
 * a million-line `<pre>` and lock the renderer. The user can still
 * view the truncated head and an explanatory footer. */
const MAX_RENDER_CHARS = 256_000;

/** Threshold above which we show a confirmation dialog before loading
 * the flattened stage text. Flatten output can be several MB for
 * complex stages (references, payloads composed in). */
const FLATTEN_WARN_BYTES = 1_000_000;

const USDA_KEYWORDS = [
  "def",
  "over",
  "class",
  "uniform",
  "varying",
  "custom",
  "rel",
  "add",
  "delete",
  "prepend",
  "append",
  "reorder",
];

/** Light-touch USDA syntax highlighter. We deliberately avoid pulling
 * in shiki / prism — the inspector value here is "is this prim
 * authored?" not "pretty syntax tree". The implementation is a
 * single-pass tokenizer (one global regex with a named alternation)
 * so the keyword / type passes can never re-tokenize the
 * `<span class="usd-string">` markup the string pass already
 * inserted. The earlier multi-pass version corrupted any line
 * containing a quoted token (e.g. `string foo = "bar"`) because the
 * keyword pass would see its own `class` attribute as a keyword
 * match — issue #39 P2 from Codex review. */
const HIGHLIGHT_TOKEN_REGEX = new RegExp(
  // Order matters: longest / most specific patterns first so the
  // alternation never has to backtrack into a shorter class.
  [
    "(?<comment>#[^\\n]*)",
    "(?<string>\"[^\"\\n]*\"|'[^'\\n]*')",
    `(?<keyword>\\b(?:${USDA_KEYWORDS.join("|")})\\b)`,
    "(?<type>\\b(?:float|double|half|int|uint|bool|string|token|asset|color|point|normal|vector|matrix|quat)\\d?[hf]?(?:\\[\\])?\\b)",
    "(?<number>-?\\d+\\.?\\d*(?:[eE][+-]?\\d+)?)",
  ].join("|"),
  "g",
);

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightUsda(source: string): string {
  let out = "";
  let cursor = 0;
  HIGHLIGHT_TOKEN_REGEX.lastIndex = 0;
  for (const match of source.matchAll(HIGHLIGHT_TOKEN_REGEX)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      out += escapeHtml(source.slice(cursor, start));
    }
    const groups = match.groups ?? {};
    const text = match[0];
    if (groups.comment !== undefined) {
      out += `<span class="usd-comment">${escapeHtml(text)}</span>`;
    } else if (groups.string !== undefined) {
      out += `<span class="usd-string">${escapeHtml(text)}</span>`;
    } else if (groups.keyword !== undefined) {
      out += `<span class="usd-keyword">${escapeHtml(text)}</span>`;
    } else if (groups.type !== undefined) {
      out += `<span class="usd-type">${escapeHtml(text)}</span>`;
    } else if (groups.number !== undefined) {
      out += `<span class="usd-number">${escapeHtml(text)}</span>`;
    } else {
      out += escapeHtml(text);
    }
    cursor = start + text.length;
  }
  if (cursor < source.length) {
    out += escapeHtml(source.slice(cursor));
  }
  return out;
}

export function UsdSourceCard({ currentFile }: UsdSourceCardProps) {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<UsdSourcePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Path the cached `payload` was loaded for. We use this to detect
  // file changes and to drop stale in-flight completions when the
  // user navigates between USD assets while the panel is open.
  const cachedPath = useRef<string | null>(null);
  // Monotonic load id so a stale `await loadUsdSource` from a
  // previous file cannot overwrite the latest result.
  const requestSeq = useRef(0);

  // --- flatten state ---
  /** Flattened USDA text returned by `flatten_stage`. */
  const [flattenedSource, setFlattenedSource] = useState<string | null>(null);
  const [flattenLoading, setFlattenLoading] = useState(false);
  const [flattenError, setFlattenError] = useState<string | null>(null);
  /** Path the cached `flattenedSource` was loaded for. */
  const flattenCachedPath = useRef<string | null>(null);

  const isUsd =
    currentFile !== null &&
    ["usda", "usd", "usdc", "usdz"].includes(currentFile.extension);

  // Bumps `requestSeq` and races the latest in-flight read; older
  // promises bail out at the resolution check so a stale read from a
  // previous file cannot overwrite a newer payload. Declared before
  // the navigation effect so the closure captured by `useEffect` is
  // initialized at render time (otherwise the early-return for
  // non-USD files would leave it in TDZ for the effect callback).
  const loadFor = async (file: SelectedFile) => {
    requestSeq.current += 1;
    const ticket = requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const next = await loadUsdSource(file.path, file.extension);
      if (ticket !== requestSeq.current) return;
      setPayload(next);
    } catch (err) {
      if (ticket !== requestSeq.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (ticket === requestSeq.current) setLoading(false);
    }
  };

  // Reset cached payload whenever the open file changes — the card
  // would otherwise display stale source for the previous asset.
  // When the panel is already expanded we eagerly re-fetch so the
  // user does not have to click `Hide` / `Show` to refresh.
  useEffect(() => {
    if (!currentFile) {
      setOpen(false);
      setPayload(null);
      setError(null);
      cachedPath.current = null;
      requestSeq.current += 1;
      // Reset flatten state too.
      setFlattenedSource(null);
      setFlattenError(null);
      flattenCachedPath.current = null;
      return;
    }
    if (cachedPath.current === currentFile.path) {
      return;
    }
    cachedPath.current = currentFile.path;
    setPayload(null);
    setError(null);
    // Drop any cached flatten result for the previous file.
    if (flattenCachedPath.current !== currentFile.path) {
      setFlattenedSource(null);
      setFlattenError(null);
      flattenCachedPath.current = null;
    }
    if (open && isUsd) {
      void loadFor(currentFile);
    } else {
      // Cancel any in-flight load from the previous file.
      requestSeq.current += 1;
      setLoading(false);
    }
  }, [currentFile, open, isUsd]);

  if (!isUsd) {
    return null;
  }

  const onToggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (payload || loading) return;
    if (currentFile) await loadFor(currentFile);
  };

  /** Triggers a flatten_stage call. Warns the user if the result might
   * be large (estimated by file size when available, otherwise proceeds
   * directly). */
  const onFlatten = async () => {
    if (!currentFile) return;
    // Already loaded for this file — just show it (toggle off if shown).
    if (flattenCachedPath.current === currentFile.path && flattenedSource) {
      // Clicking again while showing: hide the flattened view.
      setFlattenedSource(null);
      setFlattenError(null);
      flattenCachedPath.current = null;
      return;
    }
    setFlattenLoading(true);
    setFlattenError(null);
    try {
      const text = await flattenStage(currentFile.path);
      // Confirm load for very large results.
      if (text.length > FLATTEN_WARN_BYTES) {
        const ok = window.confirm(
          `Large flatten — the stage exports to ${(text.length / 1_000_000).toFixed(1)} MB of USDA text. Load anyway?`,
        );
        if (!ok) {
          setFlattenLoading(false);
          return;
        }
      }
      flattenCachedPath.current = currentFile.path;
      setFlattenedSource(text);
    } catch (err) {
      setFlattenError(err instanceof Error ? err.message : String(err));
    } finally {
      setFlattenLoading(false);
    }
  };

  const truncated =
    payload?.kind === "text" && payload.source.length > MAX_RENDER_CHARS;
  const renderText =
    payload?.kind === "text"
      ? truncated
        ? payload.source.slice(0, MAX_RENDER_CHARS)
        : payload.source
      : "";

  const flattenTruncated =
    flattenedSource !== null && flattenedSource.length > MAX_RENDER_CHARS;
  const flattenRenderText =
    flattenedSource !== null
      ? flattenTruncated
        ? flattenedSource.slice(0, MAX_RENDER_CHARS)
        : flattenedSource
      : "";

  // Show the "Show flattened" button only for binary stages so the
  // extra button doesn't clutter the UI for USDA files (where the raw
  // root-layer view is already correct and has no composition to expand).
  const isBinaryStage = payload?.kind === "binary";
  const showingFlattened =
    flattenCachedPath.current === currentFile?.path && flattenedSource !== null;

  return (
    <SidebarSection title="USD Source" collapsible defaultOpen={false}>
      <div className="sidebar-action-row">
        {open && isBinaryStage && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void onFlatten()}
            disabled={flattenLoading}
            title="Flatten stage via usdcat --flatten and show the composed USDA text"
          >
            {flattenLoading
              ? "Flattening…"
              : showingFlattened
                ? "Hide flattened"
                : "Show flattened"}
          </button>
        )}
        <button
          type="button"
          className="btn-ghost"
          onClick={() => void onToggle()}
        >
          {open ? "Hide" : loading ? "Loading…" : "Show"}
        </button>
      </div>
      {open && (
        <>
          {error ? (
            <SidebarError>{error}</SidebarError>
          ) : loading ? (
            <SidebarEmpty>Reading layer…</SidebarEmpty>
          ) : payload?.kind === "binary" ? (
            <>
              {flattenError && <SidebarError>{flattenError}</SidebarError>}
              {showingFlattened ? (
                <>
                  <pre
                    className="usd-source"
                    dangerouslySetInnerHTML={{
                      __html: highlightUsda(flattenRenderText),
                    }}
                  />
                  {flattenTruncated && (
                    <SidebarEmpty>
                      Truncated at {MAX_RENDER_CHARS.toLocaleString()} chars (
                      {flattenedSource!.length.toLocaleString()} total). Open
                      the asset in an external editor for the full source.
                    </SidebarEmpty>
                  )}
                </>
              ) : !flattenError ? (
                <SidebarEmpty>
                  Binary stage — click <strong>Show flattened</strong> above to
                  view the composed USDA text (requires the C++ backend).
                </SidebarEmpty>
              ) : null}
            </>
          ) : payload?.kind === "text" ? (
            <>
              <pre
                className="usd-source"
                // The highlighter only emits whitelisted tags
                // (<span class="usd-…">) over text we already
                // HTML-escaped; no user input bypasses
                // `replace(/</g, "&lt;")`.
                dangerouslySetInnerHTML={{
                  __html: highlightUsda(renderText),
                }}
              />
              {truncated && (
                <SidebarEmpty>
                  Truncated at {MAX_RENDER_CHARS.toLocaleString()} chars (
                  {payload.source.length.toLocaleString()} total). Open the
                  asset in an external editor for the full source.
                </SidebarEmpty>
              )}
            </>
          ) : null}
        </>
      )}
    </SidebarSection>
  );
}
