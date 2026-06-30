import { describe, expect, it } from "vitest";
import catalog from "../../../tests/fixtures/catalog.json";
import { listRegisteredLoaders } from "../loaders";

type AssetKind = "mesh" | "pointCloud" | "gaussianSplat";
type RequiredLoader = "spark" | "mmd";

type CatalogCase = {
  id: string;
  format?: string;
  path: string;
  assetKind?: AssetKind;
  requiresLoader?: RequiredLoader;
};

type CoverageGap =
  | {
      type: "extension";
      extension: string;
      privateCoverage: "noAsset";
      reason: string;
    }
  | {
      type: "plyKind";
      assetKind: AssetKind;
      reason: string;
    };

type ExtensionCoverageGap = Extract<CoverageGap, { type: "extension" }>;
type PlyKindCoverageGap = Extract<CoverageGap, { type: "plyKind" }>;
type PrivateExtensionCoverage = {
  extension: string;
  publicCatalog: false;
  privateCoverage: "covered" | "planned";
  reason: string;
};

const catalogCases = catalog.cases as CatalogCase[];

const SPARK_EXTENSIONS = new Set(["splat", "spz", "ksplat", "sog"]);
const MMD_EXTENSIONS = new Set(["pmx", "pmd", "vmd"]);
const PLY_ASSET_KINDS = ["mesh", "pointCloud", "gaussianSplat"] as const;

const PRIVATE_ONLY_EXTENSIONS: PrivateExtensionCoverage[] = [
  {
    extension: "splat",
    publicCatalog: false,
    privateCoverage: "covered",
    reason: "samples/private/catalog.json has splat-nike",
  },
  {
    extension: "vrm",
    publicCatalog: false,
    privateCoverage: "covered",
    reason: "samples/private/catalog.json has vrm-constraint-twist",
  },
  {
    extension: "usdz",
    publicCatalog: false,
    privateCoverage: "covered",
    reason: "samples/private/catalog.json has usdz-toy-biplane",
  },
  {
    extension: "usd",
    publicCatalog: false,
    privateCoverage: "planned",
    reason: "private USD data exists but is not enrolled in Phase B-1",
  },
  {
    extension: "usdc",
    publicCatalog: false,
    privateCoverage: "planned",
    reason:
      "private USD composition has USDC layers; top-level case is later work",
  },
  {
    extension: "pmx",
    publicCatalog: false,
    privateCoverage: "planned",
    reason: "MMD enrollment is Phase B-2",
  },
  {
    extension: "pmd",
    publicCatalog: false,
    privateCoverage: "planned",
    reason: "MMD enrollment is Phase B-2",
  },
  {
    extension: "vmd",
    publicCatalog: false,
    privateCoverage: "planned",
    reason: "MMD motion enrollment is Phase B-2",
  },
];

const KNOWN_COVERAGE_GAPS: CoverageGap[] = [
  // Texture alias is effectively covered by JPG, but no .jpeg catalog case is enrolled yet.
  {
    type: "extension",
    extension: "jpeg",
    privateCoverage: "noAsset",
    reason: "needs texture fixture",
  },
  // Native Spark container fixtures are not enrolled yet; PLY gaussian splat covers Spark routing for now.
  {
    type: "extension",
    extension: "spz",
    privateCoverage: "noAsset",
    reason: "needs public Spark fixture",
  },
  {
    type: "extension",
    extension: "ksplat",
    privateCoverage: "noAsset",
    reason: "needs public Spark fixture",
  },
  {
    type: "extension",
    extension: "sog",
    privateCoverage: "noAsset",
    reason: "needs public Spark fixture",
  },
];

function getCaseFormat(testCase: CatalogCase) {
  return (
    testCase.format ??
    testCase.path.split(".").pop()?.toLowerCase() ??
    ""
  ).toLowerCase();
}

function casesForExtension(extension: string) {
  return catalogCases.filter(
    (testCase) => getCaseFormat(testCase) === extension,
  );
}

function casesForPlyKind(assetKind: AssetKind) {
  return catalogCases.filter(
    (testCase) =>
      getCaseFormat(testCase) === "ply" && testCase.assetKind === assetKind,
  );
}

function expectedRequiredLoader(testCase: CatalogCase): RequiredLoader | null {
  const extension = getCaseFormat(testCase);
  if (MMD_EXTENSIONS.has(extension)) return "mmd";
  if (SPARK_EXTENSIONS.has(extension)) return "spark";
  if (extension === "ply" && testCase.assetKind === "gaussianSplat") {
    return "spark";
  }
  return null;
}

describe("fixture catalog coverage", () => {
  it("keeps at least one catalog case per registered loader extension", () => {
    const privateOnlyExtensions = new Set(
      PRIVATE_ONLY_EXTENSIONS.map((gap) => gap.extension),
    );
    const knownExtensionGaps = new Set(
      KNOWN_COVERAGE_GAPS.filter(
        (gap): gap is ExtensionCoverageGap => gap.type === "extension",
      ).map((gap) => gap.extension),
    );
    const missingExtensions = listRegisteredLoaders()
      .map((loader) => loader.extension)
      .filter(
        (extension) =>
          casesForExtension(extension).length === 0 &&
          !privateOnlyExtensions.has(extension) &&
          !knownExtensionGaps.has(extension),
      );

    expect(missingExtensions).toEqual([]);
  });

  it("tracks private-only extensions until public catalog cases are added", () => {
    const stalePrivateOnlyEntries = PRIVATE_ONLY_EXTENSIONS.filter(
      (gap) => casesForExtension(gap.extension).length > 0,
    ).map((gap) => `${gap.extension}: ${gap.reason}`);

    expect(stalePrivateOnlyEntries).toEqual([]);
  });

  it("tracks known extension gaps until their catalog cases are added", () => {
    const staleGaps = KNOWN_COVERAGE_GAPS.filter(
      (gap): gap is ExtensionCoverageGap => gap.type === "extension",
    )
      .filter((gap) => casesForExtension(gap.extension).length > 0)
      .map((gap) => `${gap.extension}: ${gap.reason}`);

    expect(staleGaps).toEqual([]);
  });

  it("keeps PLY mesh, point-cloud, and gaussian-splat routes represented", () => {
    const knownPlyKindGaps = new Set(
      KNOWN_COVERAGE_GAPS.filter(
        (gap): gap is PlyKindCoverageGap => gap.type === "plyKind",
      ).map((gap) => gap.assetKind),
    );
    const missingPlyKinds = PLY_ASSET_KINDS.filter(
      (assetKind) =>
        casesForPlyKind(assetKind).length === 0 &&
        !knownPlyKindGaps.has(assetKind),
    );

    expect(missingPlyKinds).toEqual([]);
  });

  it("tracks known PLY-kind gaps until their catalog cases are added", () => {
    const staleGaps = KNOWN_COVERAGE_GAPS.filter(
      (gap): gap is PlyKindCoverageGap => gap.type === "plyKind",
    )
      .filter((gap) => casesForPlyKind(gap.assetKind).length > 0)
      .map((gap) => `${gap.assetKind}: ${gap.reason}`);

    expect(staleGaps).toEqual([]);
  });

  it("requires optional-loader catalog cases to declare their loader pack", () => {
    const mismatches = catalogCases
      .map((testCase) => ({
        id: testCase.id,
        expected: expectedRequiredLoader(testCase),
        actual: testCase.requiresLoader ?? null,
      }))
      .filter(
        ({ expected, actual }) => expected !== null && actual !== expected,
      )
      .map(
        ({ id, expected, actual }) =>
          `${id}: expected ${expected}, got ${actual}`,
      );

    expect(mismatches).toEqual([]);
  });
});
