import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { ViewerStatePanel } from "../ViewerStatePanel";

const mocks = vi.hoisted(() => ({
  backendCapabilities: vi.fn(),
  loadDiagnosticsSnapshot: vi.fn(),
  openAppLogDir: vi.fn(),
}));

vi.mock("../../lib/diagnostics", () => ({
  loadDiagnosticsSnapshot: mocks.loadDiagnosticsSnapshot,
  openAppLogDir: mocks.openAppLogDir,
}));

vi.mock("../../lib/usd", () => ({
  backendCapabilities: mocks.backendCapabilities,
}));

describe("ViewerStatePanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("exposes the primary open-file action in the empty state", () => {
    const onOpenFile = vi.fn();
    const { getByRole, getByLabelText, getByText } = render(
      <ViewerStatePanel mode="empty" onOpenFile={onOpenFile} />,
    );

    fireEvent.click(getByRole("button", { name: "Open File" }));

    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(getByText("Core")).toBeTruthy();
    expect(
      within(getByLabelText("Optional formats")).getByText("vrm"),
    ).toBeTruthy();
  });

  it("shows an action-oriented message for missing optional loaders", () => {
    const { getByText } = render(
      <ViewerStatePanel mode="missingOptionalLoader" fileExtension="vrm" />,
    );

    expect(getByText("VRM Loader Pack is not installed.")).toBeTruthy();
    expect(
      getByText("Install VRM Loader Pack to preview VRM files."),
    ).toBeTruthy();
  });

  it("does not expose a cancel action while loading", () => {
    const { getByText, queryByRole } = render(
      <ViewerStatePanel mode="loading" fileName="heavy.fbx" />,
    );

    expect(getByText("heavy.fbx")).toBeTruthy();
    expect(queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("shows a settings-oriented message for disabled optional loaders", () => {
    const { getByText } = render(
      <ViewerStatePanel mode="disabledOptionalLoader" fileExtension="vrm" />,
    );

    expect(getByText("VRM Loader Pack is disabled.")).toBeTruthy();
    expect(
      getByText("Enable VRM Loader Pack in Settings to preview VRM files."),
    ).toBeTruthy();
  });

  it("shows a version-oriented message for incompatible optional loaders", () => {
    const { getByText, queryByText } = render(
      <ViewerStatePanel
        mode="incompatibleOptionalLoader"
        fileExtension="vrm"
      />,
    );

    expect(
      getByText("VRM Loader Pack is not compatible with this app version."),
    ).toBeTruthy();
    expect(
      getByText(
        "Update yw-look or reinstall VRM Loader Pack to preview VRM files.",
      ),
    ).toBeTruthy();
    expect(
      queryByText("Enable VRM Loader Pack in Settings to preview VRM files."),
    ).toBeNull();
  });

  it("keeps unknown extensions in the generic unsupported format message", () => {
    const { getByText } = render(
      <ViewerStatePanel mode="unsupported" fileExtension="assetbundle" />,
    );

    expect(getByText("This file format is not supported yet.")).toBeTruthy();
    expect(
      getByText(/No preview loader is available for \.assetbundle/),
    ).toBeTruthy();
  });

  it("shows load failure details when available", () => {
    const { getByRole, getByText } = render(
      <ViewerStatePanel
        detailMessage="USD task join error: task panicked"
        mode="loadFailed"
      />,
    );

    expect(getByText("Error details")).toBeTruthy();
    expect(getByText("USD task join error: task panicked")).toBeTruthy();
    expect(getByRole("button", { name: "Copy Details" })).toBeTruthy();
    expect(getByRole("button", { name: "Open Logs" })).toBeTruthy();
    expect(getByRole("button", { name: "Report Issue" })).toBeTruthy();
  });

  it.each([
    ["unsupported", "Unsupported Format"],
    ["missingOptionalLoader", "Optional Loader Missing"],
    ["disabledOptionalLoader", "Optional Loader Disabled"],
    ["incompatibleOptionalLoader", "Optional Loader Incompatible"],
    ["loadFailed", "Load Error"],
    ["missingReference", "Missing Reference"],
  ] as const)(
    "keeps classification and report actions visible for %s",
    (mode, label) => {
      const { getByRole, getByText } = render(
        <ViewerStatePanel mode={mode} fileExtension="vrm" />,
      );

      expect(getByText(label)).toBeTruthy();
      expect(getByRole("button", { name: "Copy Details" })).toBeTruthy();
      expect(getByRole("button", { name: "Open Logs" })).toBeTruthy();
      expect(getByRole("button", { name: "Report Issue" })).toBeTruthy();
    },
  );

  it("shows missing reference details beside the report actions", () => {
    const { getByRole, getByText } = render(
      <ViewerStatePanel
        detailMessage="Missing reference: missing-buffer.bin"
        mode="missingReference"
      />,
    );

    expect(getByText("Missing Reference")).toBeTruthy();
    expect(getByText("Error details")).toBeTruthy();
    expect(getByText("Missing reference: missing-buffer.bin")).toBeTruthy();
    expect(getByRole("button", { name: "Copy Details" })).toBeTruthy();
    expect(getByRole("button", { name: "Open Logs" })).toBeTruthy();
    expect(getByRole("button", { name: "Report Issue" })).toBeTruthy();
  });

  it("copies a diagnostic report with viewer state and error detail", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    mocks.backendCapabilities.mockResolvedValue({
      geometry: true,
      inspect: true,
      light: true,
      session: true,
    });
    mocks.loadDiagnosticsSnapshot.mockResolvedValue({
      appLogDir: "C:/logs/yw-look",
      appVersion: "0.2.2-test",
      arch: "x64",
      diagnosticsLogPath: "C:/logs/yw-look/diagnostics.log",
      diagnosticsSnapshot: ["[viewer.loadFailed] Failed to load preview."],
      platform: "windows",
    });

    const { findByText, getByRole } = render(
      <ViewerStatePanel
        detailMessage="USD task join error: task panicked"
        fileExtension="usda"
        fileName="broken.usda"
        mode="loadFailed"
      />,
    );

    fireEvent.click(getByRole("button", { name: "Copy Details" }));

    expect(await findByText("Details Copied")).toBeTruthy();
    expect(writeText).toHaveBeenCalledTimes(1);
    const report = String(writeText.mock.calls[0]?.[0] ?? "");
    expect(report).toContain("Mode: loadFailed");
    expect(report).toContain("File: broken.usda");
    expect(report).toContain("Extension: .usda");
    expect(report).toContain("Reason: This file could not be previewed.");
    expect(report).toContain("USD task join error: task panicked");
    expect(report).toContain(
      "Diagnostics log: C:/logs/yw-look/diagnostics.log",
    );
  });
});
