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
      reason: string;
    }
  | {
      type: "plyKind";
      assetKind: AssetKind;
      reason: string;
    };

const catalogCases = catalog.cases as CatalogCase[];

const SPARK_EXTENSIONS = new Set(["splat", "spz", "ksplat", "sog"]);
const MMD_EXTENSIONS = new Set(["pmx", "pmd"]);
const PLY_ASSET_KINDS = ["mesh", "pointCloud", "gaussianSplat"] as const;

const KNOWN_COVERAGE_GAPS: CoverageGap[] = [
  // No small public FBX fixture is enrolled yet.
  { type: "extension", extension: "fbx", reason: "needs tiny public fixture" },
  // USD binary/archive fixtures are planned separately from the existing USDA text case.
  { type: "extension", extension: "usd", reason: "needs tiny public fixture" },
  { type: "extension", extension: "usdc", reason: "needs tiny public fixture" },
  { type: "extension", extension: "usdz", reason: "needs tiny public fixture" },
  // Alembic coverage exists as unit registration only; no public catalog asset yet.
  { type: "extension", extension: "abc", reason: "needs tiny public fixture" },
  // Texture formats below are loader-supported but not yet represented in the public catalog.
  { type: "extension", extension: "jpeg", reason: "needs texture fixture" },
  { type: "extension", extension: "hdr", reason: "needs texture fixture" },
  { type: "extension", extension: "exr", reason: "needs texture fixture" },
  // VRM is optional but bundled differently from MMD/Spark; no public fixture is enrolled yet.
  { type: "extension", extension: "vrm", reason: "needs tiny public fixture" },
  // MMD model fixtures require a license-safe PMX/PMD sample before catalog enrollment.
  { type: "extension", extension: "pmx", reason: "needs public MMD fixture" },
  { type: "extension", extension: "pmd", reason: "needs public MMD fixture" },
  // Native Spark container fixtures are not enrolled yet; PLY gaussian splat covers Spark routing for now.
  {
    type: "extension",
    extension: "splat",
    reason: "needs public Spark fixture",
  },
  { type: "extension", extension: "spz", reason: "needs public Spark fixture" },
  {
    type: "extension",
    extension: "ksplat",
    reason: "needs public Spark fixture",
  },
  { type: "extension", extension: "sog", reason: "needs public Spark fixture" },
  // PLY point-cloud routing is unit-covered only; a real fixture still needs to be added.
  {
    type: "plyKind",
    assetKind: "pointCloud",
    reason: "needs real point-cloud PLY fixture",
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
    const knownExtensionGaps = new Set(
      KNOWN_COVERAGE_GAPS.filter((gap) => gap.type === "extension").map(
        (gap) => gap.extension,
      ),
    );
    const missingExtensions = listRegisteredLoaders()
      .map((loader) => loader.extension)
      .filter(
        (extension) =>
          casesForExtension(extension).length === 0 &&
          !knownExtensionGaps.has(extension),
      );

    expect(missingExtensions).toEqual([]);
  });

  it("tracks known extension gaps until their catalog cases are added", () => {
    const staleGaps = KNOWN_COVERAGE_GAPS.filter(
      (gap): gap is Extract<CoverageGap, { type: "extension" }> =>
        gap.type === "extension",
    )
      .filter((gap) => casesForExtension(gap.extension).length > 0)
      .map((gap) => `${gap.extension}: ${gap.reason}`);

    expect(staleGaps).toEqual([]);
  });

  it("keeps PLY mesh, point-cloud, and gaussian-splat routes represented", () => {
    const knownPlyKindGaps = new Set(
      KNOWN_COVERAGE_GAPS.filter((gap) => gap.type === "plyKind").map(
        (gap) => gap.assetKind,
      ),
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
      (gap): gap is Extract<CoverageGap, { type: "plyKind" }> =>
        gap.type === "plyKind",
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
