import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { WarningsSidebarPanel } from "../WarningsSidebarPanel";
import { useViewerStore } from "../../stores/viewerStore";
import { requestViewportScaleNormalizationCancel } from "../../viewport/viewportCommands";

const diagnosticsMocks = vi.hoisted(() => ({
  loadDiagnosticsSnapshot: vi.fn(),
  openAppLogDir: vi.fn(),
}));

vi.mock("../../lib/diagnostics", () => ({
  loadDiagnosticsSnapshot: diagnosticsMocks.loadDiagnosticsSnapshot,
  openAppLogDir: diagnosticsMocks.openAppLogDir,
}));

vi.mock("../../viewport/viewportCommands", () => ({
  requestViewportScaleNormalizationCancel: vi.fn(() => true),
}));

beforeEach(() => {
  vi.clearAllMocks();
  diagnosticsMocks.loadDiagnosticsSnapshot.mockResolvedValue({
    appLogDir: "C:/logs/yw-look",
    appVersion: "0.2.2-test",
    arch: "x64",
    diagnosticsLogPath: "C:/logs/yw-look/diagnostics.log",
    diagnosticsSnapshot: ["[viewer.loadFailed] Failed to load preview."],
    platform: "windows",
  });
  diagnosticsMocks.openAppLogDir.mockResolvedValue(undefined);
  useViewerStore.setState({
    resourceDiagnostics: null,
    scaleNormalization: { applied: true, factor: 2 },
  });
});

afterEach(() => {
  cleanup();
});

describe("WarningsSidebarPanel", () => {
  it("requests scale-normalization cancellation", () => {
    const { getByRole } = render(<WarningsSidebarPanel warnings={[]} />);

    fireEvent.click(getByRole("button", { name: /cancel scale normalize/i }));

    expect(requestViewportScaleNormalizationCancel).toHaveBeenCalledTimes(1);
  });

  it("hides the scale-normalization action when normalization is inactive", () => {
    useViewerStore.setState({
      scaleNormalization: null,
    });

    const { queryByRole } = render(<WarningsSidebarPanel warnings={[]} />);

    expect(
      queryByRole("button", { name: /cancel scale normalize/i }),
    ).toBeNull();
  });

  it("keeps log details inside the warnings panel", async () => {
    const { findByText, getByText } = render(
      <WarningsSidebarPanel warnings={["Missing texture"]} />,
    );

    expect(getByText("Warnings")).toBeTruthy();
    expect(getByText("Missing texture")).toBeTruthy();
    expect(await findByText("Log Details")).toBeTruthy();
  });
});
