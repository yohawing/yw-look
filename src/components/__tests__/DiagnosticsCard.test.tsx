import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DiagnosticsCard } from "../DiagnosticsCard";
import type { ResourceDiagnosticsSnapshot } from "../../lib/diagnostics";

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
  afterEach(() => {
    cleanup();
  });

  it("renders runtime resource metrics when available", () => {
    const { getByText } = render(
      <DiagnosticsCard
        diagnosticsError={null}
        diagnosticsPayload={{
          diagnosticsLogPath: "diagnostics.log",
          diagnosticsSnapshot: [],
        }}
        resourceDiagnostics={resourceDiagnostics}
      />,
    );

    expect(getByText("Resources")).toBeTruthy();
    expect(getByText("WebGL geometry")).toBeTruthy();
    expect(getByText("4")).toBeTruthy();
    expect(getByText("Asset triangles")).toBeTruthy();
    expect(getByText("170")).toBeTruthy();
    expect(getByText("JS heap used")).toBeTruthy();
    expect(getByText("32 MB")).toBeTruthy();
  });

  it("hides unavailable JS heap metrics", () => {
    const { queryByText } = render(
      <DiagnosticsCard
        diagnosticsError={null}
        diagnosticsPayload={{
          diagnosticsLogPath: "diagnostics.log",
          diagnosticsSnapshot: [],
        }}
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
});
