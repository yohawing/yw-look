import { describe, expect, it } from "vitest";
import {
  buildDiagnosticCounts,
  buildDiagnosticWarnings,
} from "../assetDiagnostics";
import type { AssetIssue } from "../../lib/usd";
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
});
