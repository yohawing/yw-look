import { describe, expect, it } from "vitest";
import {
  buildDiagnosticCounts,
  buildDiagnosticWarnings,
  formatUsdCapabilityWarnings,
  selectUsdCapabilities,
  type UsdCapabilityInfo,
} from "../assetDiagnostics";
import type { AssetIssue, StageInspection, StageSummary } from "../../lib/usd";
import type { AssetMetadata, ViewerFeedback } from "../../types/viewer";

function makeMetadata(overrides: Partial<AssetMetadata> = {}): AssetMetadata {
  return {
    formatLabel: "glTF",
    formatVersion: "2.0",
    nodeCount: 1,
    meshCount: 1,
    materialCount: 1,
    textureCount: 1,
    hasAnimation: false,
    hierarchy: [],
    textures: [],
    materials: [],
    lights: [],
    cameras: [],
    objectInfo: {},
    ...overrides,
  };
}

function makeFeedback(overrides: Partial<ViewerFeedback> = {}): ViewerFeedback {
  return {
    mode: "ready",
    message: "Preview ready.",
    warning: null,
    canResetCamera: true,
    ...overrides,
  };
}

function makeCapability(
  overrides: Partial<UsdCapabilityInfo> = {},
): UsdCapabilityInfo {
  return {
    kind: "pointInstancer",
    detected: true,
    support: "unsupported",
    reason: "Point instancers are not rendered by the preview backend.",
    ...overrides,
  };
}

describe("assetDiagnostics", () => {
  it("builds warning lines from viewer, texture, USD, and MMD diagnostics", () => {
    const usdIssues: AssetIssue[] = [
      {
        code: "suspicious-meters-per-unit",
        level: "warning",
        message: "Stage scale is unusual.",
        detail: null,
        contextPath: "/Root",
      },
      {
        code: "broken-reference",
        level: "error",
        message: "Missing referenced layer.",
        detail: null,
        contextPath: "/Root/Mesh",
      },
    ];
    const assetMetadata = makeMetadata({
      textures: [
        {
          id: "missing",
          label: "albedo.png",
          channel: "baseColor",
          dimensions: "unknown",
          thumbnailUrl: null,
          sourceKind: "unresolved",
        },
      ],
      mmd: {
        format: "pmx",
        version: 2.1,
        encoding: "utf-8",
        name: "モデル",
        englishName: "Model",
        comment: "",
        englishComment: "",
        counts: {},
        additionalUvCount: null,
        indexSizes: null,
        trailingBytes: 0,
        sections: [],
        diagnostics: [
          {
            level: "warning",
            code: "MMD_TEST",
            message: "MMD metadata warning.",
          },
        ],
      },
    });

    expect(
      buildDiagnosticWarnings({
        assetMetadata,
        usdIssues,
        viewerFeedback: makeFeedback({ warning: "line one\n\nline two" }),
      }),
    ).toEqual([
      "line one",
      "line two",
      "Texture reference is unresolved: albedo.png",
      "USD error: Missing referenced layer. (/Root/Mesh)",
      "USD warning: Stage scale is unusual. (/Root)",
      "MMD warning: MMD metadata warning. (MMD_TEST)",
    ]);
  });

  it("counts load errors separately from warning line output", () => {
    const counts = buildDiagnosticCounts({
      assetMetadata: makeMetadata(),
      usdIssues: [],
      viewerFeedback: makeFeedback({
        mode: "loadFailed",
        warning: null,
      }),
    });

    expect(counts).toEqual({
      errorCount: 1,
      warningCount: 0,
      total: 1,
    });
  });

  it("uses debug panel warnings as the diagnostic count override", () => {
    const counts = buildDiagnosticCounts({
      assetMetadata: makeMetadata(),
      debugPanelWarnings: ["debug one", "debug two"],
      usdIssues: [
        {
          code: "broken-reference",
          level: "error",
          message: "Missing referenced layer.",
          detail: null,
          contextPath: null,
        },
      ],
      viewerFeedback: makeFeedback({
        mode: "loadFailed",
        warning: "runtime warning",
      }),
    });

    expect(counts).toEqual({
      errorCount: 0,
      warningCount: 2,
      total: 2,
    });
  });

  it("reports detected degraded and unsupported capabilities as warnings", () => {
    const capabilities = [
      makeCapability({
        kind: "materialX",
        support: "degraded",
        reason: "MaterialX resources use a fallback material.",
      }),
      makeCapability(),
      makeCapability({
        kind: "skel",
        support: "supported",
        reason: "Fully supported.",
      }),
      makeCapability({ detected: false }),
    ];

    const warnings = buildDiagnosticWarnings({
      assetMetadata: makeMetadata(),
      usdCapabilities: capabilities,
      usdIssues: [],
      viewerFeedback: makeFeedback(),
    });

    expect(warnings).toEqual([
      "USD capability warning: MaterialX (materialX) degraded: MaterialX resources use a fallback material.",
      "USD capability warning: Point Instancer (pointInstancer) unsupported: Point instancers are not rendered by the preview backend.",
    ]);
    expect(
      buildDiagnosticCounts({
        assetMetadata: makeMetadata(),
        usdCapabilities: capabilities,
        usdIssues: [],
        viewerFeedback: makeFeedback(),
      }),
    ).toEqual({ errorCount: 0, warningCount: 2, total: 2 });
  });

  it("prefers summary capabilities and falls back to inspection capabilities", () => {
    const summaryCapability = makeCapability({ kind: "payload" });
    const inspectionCapability = makeCapability({ kind: "variantOverride" });
    const summary = {
      capabilities: [summaryCapability],
    } as unknown as StageSummary;
    const inspection = {
      capabilities: [inspectionCapability],
    } as unknown as StageInspection;

    expect(selectUsdCapabilities(summary, inspection)).toEqual([
      summaryCapability,
    ]);
    expect(selectUsdCapabilities(null, inspection)).toEqual([
      inspectionCapability,
    ]);
    expect(selectUsdCapabilities({} as StageSummary, inspection)).toEqual([
      inspectionCapability,
    ]);
  });

  it("deduplicates exact capability warning lines", () => {
    const capability = makeCapability();

    expect(formatUsdCapabilityWarnings([capability, capability])).toEqual([
      "USD capability warning: Point Instancer (pointInstancer) unsupported: Point instancers are not rendered by the preview backend.",
    ]);
  });
});
