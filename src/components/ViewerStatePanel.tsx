import { t, useLocale } from "../lib/i18n";
import { LoadingScreen } from "./LoadingScreen";
import { useState } from "react";
import { loadDiagnosticsSnapshot, openAppLogDir } from "../lib/diagnostics";
import { buildDiagnosticsReport, ISSUE_REPORT_URL } from "../lib/reporting";
import { backendCapabilities } from "../lib/usd";
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
  detailMessage?: string | null;
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

export function ViewerStatePanel({
  deferredTexture,
  detailMessage,
  fileExtension,
  fileName,
  loadingStage,
  mode,
  onOpenFile,
}: ViewerStatePanelProps) {
  useLocale();
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
      title: t("drop_a_file_here_to_preview"),
      body: t(
        "drag_drop_a_3d_model_or_texture_onto_this_window_or_use_file_to_open",
      ),
      tone: "neutral",
    },
    loading: {
      label: t("loading"),
      title: t("preparing_preview"),
      body: t("the_file_is_being_opened_and_prepared_for_display"),
      tone: "neutral",
      details: [
        t("large_files_can_take_a_moment"),
        t(
          "linked_textures_or_payloads_may_continue_loading_after_the_preview_appears",
        ),
      ],
    },
    ready: {
      label: t("preview_ready"),
      title: t("the_scene_is_active_and_camera_controls_are_enabled"),
      body: t(
        "this_state_is_handled_by_the_live_viewport_and_should_not_remain_overlaid",
      ),
      tone: "neutral",
    },
    unsupported: {
      label: t("unsupported_format"),
      title: t("this_file_type_is_not_mapped_to_a_loader_yet"),
      body: t("this_build_cannot_preview_the_selected_file_type"),
      tone: "warning",
      details: [
        t("core_loader_support_is_built_into_this_app"),
        t(
          "optional_formats_are_listed_separately_when_they_require_a_loader_pack",
        ),
      ],
    },
    missingOptionalLoader: {
      label: t("optional_loader_missing"),
      title: t("a_loader_pack_is_required_for_this_file"),
      body: t(
        "the_file_extension_is_recognized_but_this_installation_does_not_include_the_optional_",
      ),
      tone: "warning",
      details: [
        t("install_the_matching_loader_pack_when_it_becomes_available"),
        t("reopen_the_file_after_the_loader_pack_is_installed"),
      ],
    },
    disabledOptionalLoader: {
      label: t("optional_loader_disabled"),
      title: t("a_loader_pack_is_disabled_for_this_file"),
      body: t(
        "the_file_extension_is_recognized_but_its_optional_loader_pack_is_currently_disabled",
      ),
      tone: "warning",
      details: [
        t("enable_the_matching_loader_pack_in_settings"),
        t("reopen_the_file_after_changing_the_loader_pack_setting"),
      ],
    },
    incompatibleOptionalLoader: {
      label: t("optional_loader_incompatible"),
      title: t("a_loader_pack_is_not_compatible_with_this_app_version"),
      body: t(
        "the_file_extension_is_recognized_but_its_optional_loader_pack_cannot_run_with_the_cur",
      ),
      tone: "warning",
      details: [
        t("update_yw_look_or_reinstall_the_matching_loader_pack"),
        t("reopen_the_file_after_the_app_and_loader_pack_versions_match"),
      ],
    },
    loadFailed: {
      label: t("load_error"),
      title: t("this_file_could_not_be_previewed"),
      body: t("the_file_may_be_damaged_or_use_data_this_build_cannot_read"),
      tone: "danger",
      details: [
        t("try_another_file_or_check_that_linked_resources_are_available"),
        t(
          "if_this_keeps_happening_share_the_file_and_error_details_with_support",
        ),
      ],
    },
    missingReference: {
      label: t("missing_reference"),
      title: t(
        "the_main_file_was_found_but_one_or_more_linked_resources_are_missing",
      ),
      body: t(
        "some_linked_textures_buffers_or_sidecar_files_could_not_be_found",
      ),
      tone: "warning",
      details: [
        t("move_the_missing_files_next_to_the_asset_then_reopen_it"),
        t("file_names_may_appear_in_the_warning_panel_when_available"),
      ],
    },
  };

  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
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
  const reportable =
    mode === "unsupported" ||
    mode === "missingOptionalLoader" ||
    mode === "disabledOptionalLoader" ||
    mode === "incompatibleOptionalLoader" ||
    mode === "loadFailed" ||
    mode === "missingReference";

  const handleCopyDetails = async () => {
    const diagnostics = await loadDiagnosticsSnapshot();
    const capabilities = await backendCapabilities().catch(() => null);
    const report = buildDiagnosticsReport({
      capabilities,
      diagnostics,
      errorDetail: detailMessage,
      viewerState: [
        `Mode: ${mode}`,
        fileName ? `File: ${fileName}` : null,
        fileExtension ? `Extension: .${fileExtension}` : null,
        `Reason: ${content.title}`,
        content.body,
      ]
        .filter(Boolean)
        .join("\n"),
    });

    try {
      await navigator.clipboard.writeText(report);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
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
      <div className="viewer-empty-state" aria-label={t("drop_file")}>
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
          <h2>{t("inspect_a_model_or_texture")}</h2>
          <p>{t("open_a_file_or_drop_one_here_to_preview_the_asset")}</p>
        </div>
        <div className="viewer-empty-actions">
          <button onClick={onOpenFile} type="button">
            {t("open_file")}
          </button>
          <span>{t("drag_drop")}</span>
        </div>
        <div className="viewer-empty-format-groups">
          <div>
            <p>{t("core")}</p>
            <div
              className="viewer-empty-formats"
              aria-label={t("supported_formats")}
            >
              {coreFormats.map((format) => (
                <span key={format}>{format}</span>
              ))}
            </div>
          </div>
          <div>
            <p>{t("optional_packs")}</p>
            <div
              className="viewer-empty-formats viewer-empty-formats-optional"
              aria-label={t("optional_formats")}
            >
              {optionalFormats.map((format) => (
                <span key={format}>{format}</span>
              ))}
            </div>
          </div>
        </div>
        <p className="viewer-empty-hint">
          {t("use_left_right_after_opening_a_file_to_browse_nearby_assets")}
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
      {detailMessage ? (
        <div className="viewer-error-detail" role="status">
          <p>{t("error_details")}</p>
          <pre>{detailMessage}</pre>
        </div>
      ) : null}
      {reportable ? (
        <div className="viewer-error-actions">
          <button onClick={() => void handleCopyDetails()} type="button">
            {copyState === "copied"
              ? t("details_copied")
              : copyState === "failed"
                ? t("copy.failure")
                : t("copy_details")}
          </button>
          <button onClick={() => void openAppLogDir()} type="button">
            {t("open_logs")}
          </button>
          <button
            onClick={() => window.open(ISSUE_REPORT_URL, "_blank", "noopener")}
            type="button"
          >
            {t("report_issue")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
