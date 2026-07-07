import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { ISSUE_REPORT_URL } from "../../lib/reporting";
import { DiagnosticsCard } from "../DiagnosticsCard";
import type { ResourceDiagnosticsSnapshot } from "../../lib/diagnostics";

const diagnosticsMocks = vi.hoisted(() => ({
  loadDiagnosticsSnapshot: vi.fn(),
  openAppLogDir: vi.fn(),
}));

vi.mock("../../lib/diagnostics", () => ({
  loadDiagnosticsSnapshot: diagnosticsMocks.loadDiagnosticsSnapshot,
  openAppLogDir: diagnosticsMocks.openAppLogDir,
}));

vi.mock("../../lib/usd", () => ({
  backendCapabilities: vi.fn().mockResolvedValue(null),
}));

const resourceDiagnostics: ResourceDiagnosticsSnapshot = {
  sampledAt: 100,
  webgl: {
    geometries: 4,
    textures: 3,
    programs: 2,
    calls: 7,
    triangles: 1280,
    points: 12,
    lines: 34,
  },
  memory: {
    jsHeapUsedBytes: 32 * 1024 * 1024,
    jsHeapTotalBytes: null,
    jsHeapLimitBytes: null,
  },
  asset: {
    vertices: 512,
    triangles: 170,
    materials: 5,
    textures: 3,
  },
};

describe("DiagnosticsCard", () => {
  beforeEach(() => {
    diagnosticsMocks.loadDiagnosticsSnapshot.mockResolvedValue({
      appLogDir: "C:/logs/yw-look",
      appVersion: "0.2.2-test",
      arch: "x64",
      diagnosticsLogPath: "C:/logs/yw-look/diagnostics.log",
      diagnosticsSnapshot: ["[viewer.loadFailed] Failed to load preview."],
      platform: "windows",
    });
    diagnosticsMocks.openAppLogDir.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("renders runtime resource metrics when available", () => {
    const { getByText } = render(
      <DiagnosticsCard
        processMemoryMetrics={null}
        resourceDiagnostics={resourceDiagnostics}
      />,
    );

    expect(getByText("Resources")).toBeTruthy();
    expect(getByText("WebGL geometry")).toBeTruthy();
    expect(getByText("4")).toBeTruthy();
    expect(getByText("Asset triangles")).toBeTruthy();
    expect(getByText("170")).toBeTruthy();
    expect(getByText("JS heap used")).toBeTruthy();
    expect(getByText("32.0 MB")).toBeTruthy();
  });

  it("hides unavailable JS heap metrics", () => {
    const { queryByText } = render(
      <DiagnosticsCard
        processMemoryMetrics={null}
        resourceDiagnostics={{
          ...resourceDiagnostics,
          memory: {
            jsHeapUsedBytes: null,
            jsHeapTotalBytes: null,
            jsHeapLimitBytes: null,
          },
        }}
      />,
    );

    expect(queryByText("JS heap used")).toBeNull();
  });

  it("exposes log actions and recent diagnostics when a snapshot is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const { findByRole, getByLabelText, getByRole } = render(
      <DiagnosticsCard
        processMemoryMetrics={null}
        resourceDiagnostics={null}
      />,
    );

    expect(await findByRole("button", { name: "Open Logs" })).toBeTruthy();
    expect(getByRole("button", { name: "Copy Diagnostics" })).toBeTruthy();
    await waitFor(() => {
      expect(getByLabelText("Recent diagnostics").textContent).toContain(
        "[viewer.loadFailed] Failed to load preview.",
      );
    });

    fireEvent.click(getByRole("button", { name: "Open Logs" }));
    expect(diagnosticsMocks.openAppLogDir).toHaveBeenCalledTimes(1);

    fireEvent.click(getByRole("button", { name: "Copy Diagnostics" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    const report = String(writeText.mock.calls[0]?.[0] ?? "");
    expect(report).toContain(
      "Diagnostics log: C:/logs/yw-look/diagnostics.log",
    );
  });

  it("keeps Copy Diagnostics adjacent to Report Issue", async () => {
    const { container } = render(
      <DiagnosticsCard
        processMemoryMetrics={null}
        resourceDiagnostics={null}
      />,
    );

    const actions = container.querySelector(".card-actions");
    expect(actions).toBeTruthy();
    const actionBar = within(actions as HTMLElement);
    expect(
      await actionBar.findByRole("button", { name: "Copy Diagnostics" }),
    ).toBeTruthy();
    expect(
      actionBar.getByRole("button", { name: "Report Issue" }),
    ).toBeTruthy();
  });

  it("opens the bug-report template when Report Issue is clicked", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { findByRole, getByRole } = render(
      <DiagnosticsCard
        processMemoryMetrics={null}
        resourceDiagnostics={null}
      />,
    );

    await findByRole("button", { name: "Copy Diagnostics" });
    fireEvent.click(getByRole("button", { name: "Report Issue" }));

    expect(openSpy).toHaveBeenCalledWith(
      ISSUE_REPORT_URL,
      "_blank",
      "noopener",
    );
    expect(ISSUE_REPORT_URL).toContain("template=bug_report.yml");
  });

  it("renders process memory metrics when available", () => {
    const { getByText } = render(
      <DiagnosticsCard
        processMemoryMetrics={{
          residentSetBytes: 96 * 1024 * 1024,
          virtualMemoryBytes: 512 * 1024 * 1024,
        }}
        resourceDiagnostics={null}
      />,
    );

    expect(getByText("Process memory")).toBeTruthy();
    expect(getByText("96.0 MB")).toBeTruthy();
    expect(getByText("Virtual memory")).toBeTruthy();
    expect(getByText("512.0 MB")).toBeTruthy();
  });
});
