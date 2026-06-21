import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const defaultCatalogPath = path.join(
  repoRoot,
  "tests",
  "fixtures",
  "catalog.json",
);
const outputDir = path.join(repoRoot, "artifacts", "logs");
const optionalLoaderPackages = {
  spark: {
    env: "YW_LOOK_HAS_SPARK_LOADER",
    packagePath: path.join(repoRoot, "node_modules", "@sparkjsdev", "spark"),
  },
  mmd: {
    env: "YW_LOOK_HAS_THREE_MMD_LOADER",
    packagePath: path.join(
      repoRoot,
      "node_modules",
      "@yohawing",
      "three-mmd-loader",
    ),
  },
};

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const privateMode = args.includes("--private");
const catalogOption = readOption("--catalog");
const catalogPath =
  catalogOption === null
    ? defaultCatalogPath
    : path.resolve(repoRoot, catalogOption);
const selectedCaseId = readOption("--case");
const timeoutOption = readOption("--timeout-ms");
const timeoutMs = timeoutOption === null ? null : Number(timeoutOption);
const reportStem =
  path.resolve(catalogPath) === path.resolve(defaultCatalogPath)
    ? "fixture-regression-report"
    : `fixture-regression-report.${getCatalogReportName(catalogPath)}`;
const jsonReportPath = path.join(outputDir, `${reportStem}.json`);
const markdownReportPath = path.join(outputDir, `${reportStem}.md`);
const privateScreenshotDir = path.join(
  repoRoot,
  "artifacts",
  "screenshots",
  "private-fixtures",
);

const usage = `usage:
  npm run test:fixtures
  npm run test:fixtures -- --catalog <path>
  npm run test:fixtures -- --catalog samples/private/catalog.json --private
  npm run test:fixtures -- --case <id>
  npm run test:fixtures -- --list
  npm run test:fixtures -- --timeout-ms <ms>

Runs fixture catalog cases through the real shot/check loader path and writes
artifacts/logs/fixture-regression-report[.<catalog>].{json,md}.`;

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function normalizeRepoPath(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

function getCatalogReportName(filePath) {
  const parsed = path.parse(filePath);
  const name =
    parsed.name === "catalog" ? path.basename(parsed.dir) : parsed.name;
  return name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
}

function sanitizeFileStem(value) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function readEnvBoolean(name) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return null;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`${name} must be one of 1/0, true/false, yes/no, or on/off`);
}

async function getOptionalLoaderAvailability() {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(optionalLoaderPackages).map(async ([loader, config]) => {
        const envOverride = readEnvBoolean(config.env);
        return [
          loader,
          envOverride ?? (await pathExists(config.packagePath)),
        ];
      }),
    ),
  );
}

function inferAssetState(category) {
  if (category === "malformed") return "malformed";
  if (category === "missing-reference") return "missing-reference";
  return "valid";
}

function normalizeNullableEnum(value, allowedValues, fieldName, caseId) {
  if (value === undefined || value === null) return null;
  if (allowedValues.includes(value)) return value;
  throw new Error(
    `${caseId} has invalid ${fieldName}: ${JSON.stringify(value)}`,
  );
}

async function readCatalog() {
  const raw = await readFile(catalogPath, "utf8");
  const catalog = JSON.parse(raw);
  if (!Array.isArray(catalog.cases)) {
    throw new Error(`${normalizeRepoPath(catalogPath)} must contain cases[]`);
  }

  return catalog.cases.map((testCase) => {
    const absolutePath = path.resolve(repoRoot, testCase.path);
    const category = testCase.category ?? "uncategorized";
    return {
      id: testCase.id,
      category,
      format: testCase.format ?? path.extname(testCase.path).slice(1),
      assetKind: normalizeNullableEnum(
        testCase.assetKind,
        ["mesh", "pointCloud", "gaussianSplat"],
        "assetKind",
        testCase.id,
      ),
      requiresLoader: normalizeNullableEnum(
        testCase.requiresLoader,
        ["spark", "mmd"],
        "requiresLoader",
        testCase.id,
      ),
      assetState:
        normalizeNullableEnum(
          testCase.assetState,
          ["valid", "malformed", "missing-reference"],
          "assetState",
          testCase.id,
        ) ?? inferAssetState(category),
      private: testCase.private === true,
      path: normalizeRepoPath(absolutePath),
      absolutePath,
      expect: {
        shouldLoad: testCase.expect?.shouldLoad !== false,
        nonBlankCanvas: testCase.expect?.nonBlankCanvas === true,
      },
      knownFailure:
        typeof testCase.knownFailure === "string" && testCase.knownFailure
          ? testCase.knownFailure
          : null,
    };
  });
}

function tail(text, maxLines = 24) {
  return text.split(/\r?\n/).slice(-maxLines).join("\n").trim();
}

function runCase(testCase) {
  const startedAt = performance.now();
  const useShot = testCase.expect.nonBlankCanvas;
  const screenshotPath = useShot
    ? path.join(privateScreenshotDir, `${sanitizeFileStem(testCase.id)}.png`)
    : null;
  const runArgs = [
    path.join(repoRoot, "scripts", "run-shot.mjs"),
    useShot ? "shot" : "check",
    "--in",
    testCase.absolutePath,
  ];
  if (screenshotPath) {
    runArgs.push("--out", screenshotPath);
  }

  return new Promise((resolve) => {
    const child = spawn(process.execPath, runArgs, {
      cwd: repoRoot,
      env: {
        ...process.env,
        YW_LOOK_CARGO_NO_DEFAULT_FEATURES:
          process.env.YW_LOOK_CARGO_NO_DEFAULT_FEATURES ?? "1",
        YW_LOOK_CARGO_FEATURES:
          process.env.YW_LOOK_CARGO_FEATURES ?? "backend-openusd-rs",
      },
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout =
      timeoutMs === null
        ? null
        : setTimeout(() => {
            settled = true;
            child.kill("SIGKILL");
            resolve({
              exitCode: null,
              durationMs: Math.round(performance.now() - startedAt),
              stdout,
              stderr,
              screenshotPath,
              error: `timed out after ${timeoutMs}ms`,
            });
          }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({
        exitCode: null,
        durationMs: Math.round(performance.now() - startedAt),
        stdout,
        stderr,
        screenshotPath,
        error: error.message,
      });
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({
        exitCode: code,
        durationMs: Math.round(performance.now() - startedAt),
        stdout,
        stderr,
        screenshotPath,
        error: null,
      });
    });
  });
}

function toMarkdown(report) {
  const lines = [
    "# Fixture Regression Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Summary: ${report.summary.passed}/${report.summary.total} passed, ${report.summary.knownFailures} known failure(s), ${report.summary.skipped} skipped, ${report.summary.xpass} xpass, ${report.summary.failed} failed`,
    "",
    "| Case | Category | State | Format | Asset Kind | Loader | Expected | Actual | Duration | Result |",
    "| ---- | -------- | ----- | ------ | ---------- | ------ | -------- | ------ | -------- | ------ |",
  ];

  for (const result of report.results) {
    lines.push(
      [
        result.id,
        result.category,
        result.assetState,
        result.format,
        result.assetKind ?? "",
        result.requiresLoader ?? "",
        result.expectedShouldLoad ? "load" : "fail",
        result.skipped ? "skipped" : result.actualLoaded ? "loaded" : "failed",
        `${result.durationMs}ms`,
        result.status,
      ]
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }

  const failures = report.results.filter((result) => result.status === "FAIL");
  if (failures.length > 0) {
    lines.push("", "## Failures", "");
    for (const failure of failures) {
      lines.push(`### ${failure.id}`, "");
      if (failure.error) lines.push(`Error: ${failure.error}`, "");
      if (failure.stderrTail) {
        lines.push("```text", failure.stderrTail, "```", "");
      }
      if (failure.stdoutTail) {
        lines.push("```text", failure.stdoutTail, "```", "");
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(usage);
  process.exit(0);
}

if (timeoutMs !== null && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
  console.error("--timeout-ms must be a positive number");
  console.error(usage);
  process.exit(2);
}

let cases;
let optionalLoaderAvailability;
try {
  optionalLoaderAvailability = await getOptionalLoaderAvailability();
  cases = await readCatalog();
  if (selectedCaseId) {
    cases = cases.filter((testCase) => testCase.id === selectedCaseId);
    if (cases.length === 0) {
      throw new Error(`unknown fixture case: ${selectedCaseId}`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage);
  process.exit(2);
}

if (listOnly) {
  for (const testCase of cases) {
    const details = [
      testCase.format,
      testCase.assetKind ? `assetKind=${testCase.assetKind}` : null,
      `assetState=${testCase.assetState}`,
      testCase.requiresLoader
        ? `requiresLoader=${testCase.requiresLoader}`
        : null,
    ].filter(Boolean);
    console.log(`${testCase.id}: ${testCase.path} [${details.join(", ")}]`);
  }
  process.exit(0);
}

await mkdir(outputDir, { recursive: true });
if (cases.some((testCase) => testCase.expect.nonBlankCanvas)) {
  await mkdir(privateScreenshotDir, { recursive: true });
}

const results = [];
for (const testCase of cases) {
  const exists = await pathExists(testCase.absolutePath);
  if (!exists) {
    const isPrivateCase = privateMode || testCase.private;
    const status = isPrivateCase
      ? "SKIP"
      : testCase.expect.shouldLoad
        ? testCase.knownFailure
          ? "XFAIL"
          : "FAIL"
        : "PASS";
    results.push({
      ...testCase,
      expectedShouldLoad: testCase.expect.shouldLoad,
      actualLoaded: false,
      ok: status !== "FAIL",
      status,
      skipped: status === "SKIP",
      skipReason: status === "SKIP" ? "private fixture file is missing" : null,
      knownFailure: status === "XFAIL" ? testCase.knownFailure : null,
      durationMs: 0,
      exitCode: null,
      error: "fixture file is missing",
      stdoutTail: "",
      stderrTail: "",
    });
    continue;
  }

  if (
    testCase.requiresLoader &&
    optionalLoaderAvailability[testCase.requiresLoader] === false
  ) {
    results.push({
      ...testCase,
      expectedShouldLoad: testCase.expect.shouldLoad,
      actualLoaded: false,
      ok: true,
      status: "SKIP",
      skipped: true,
      skipReason: `${testCase.requiresLoader} loader pack is not installed`,
      knownFailure: testCase.knownFailure,
      durationMs: 0,
      exitCode: null,
      error: null,
      stdoutTail: "",
      stderrTail: "",
    });
    continue;
  }

  console.log(`[fixture] ${testCase.id}`);
  const outcome = await runCase(testCase);
  const actualLoaded = outcome.exitCode === 0;
  const matchedExpectation = actualLoaded === testCase.expect.shouldLoad;
  const knownFailureHit = !matchedExpectation && Boolean(testCase.knownFailure);
  const xpass = matchedExpectation && Boolean(testCase.knownFailure);
  const status = knownFailureHit
    ? "XFAIL"
    : xpass
      ? "XPASS"
      : matchedExpectation
        ? "PASS"
        : "FAIL";
  results.push({
    id: testCase.id,
    category: testCase.category,
    format: testCase.format,
    assetKind: testCase.assetKind,
    assetState: testCase.assetState,
    requiresLoader: testCase.requiresLoader,
    path: testCase.path,
    expectedShouldLoad: testCase.expect.shouldLoad,
    expectedNonBlankCanvas: testCase.expect.nonBlankCanvas,
    actualLoaded,
    ok: status !== "FAIL",
    status,
    skipped: false,
    skipReason: null,
    knownFailure: testCase.knownFailure,
    durationMs: outcome.durationMs,
    exitCode: outcome.exitCode,
    screenshotPath: outcome.screenshotPath
      ? normalizeRepoPath(outcome.screenshotPath)
      : null,
    error: outcome.error,
    stdoutTail: tail(outcome.stdout),
    stderrTail: tail(outcome.stderr),
  });
}

const passed = results.filter(
  (result) => result.status === "PASS",
).length;
const knownFailures = results.filter(
  (result) => result.status === "XFAIL",
).length;
const skipped = results.filter((result) => result.status === "SKIP").length;
const xpass = results.filter((result) => result.status === "XPASS").length;
const failed = results.filter((result) => result.status === "FAIL").length;
const report = {
  generatedAt: new Date().toISOString(),
  catalog: normalizeRepoPath(catalogPath),
  optionalLoaders: optionalLoaderAvailability,
  summary: {
    total: results.length,
    passed,
    knownFailures,
    skipped,
    xpass,
    failed,
  },
  results,
};

await writeFile(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(markdownReportPath, toMarkdown(report));

console.log(
  `[fixture] ${passed}/${results.length} passed, ${knownFailures} known failure(s), ${skipped} skipped, ${xpass} xpass; report: ${normalizeRepoPath(
    jsonReportPath,
  )}`,
);

process.exit(report.summary.failed === 0 ? 0 : 1);
