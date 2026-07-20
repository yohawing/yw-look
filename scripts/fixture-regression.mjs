import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readOption } from "./cliArgs.mjs";
import { runChildProcess } from "./processRunner.mjs";

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
const catalogOption = readOption(args, "--catalog");
const catalogPath =
  catalogOption === null
    ? defaultCatalogPath
    : path.resolve(repoRoot, catalogOption);
const selectedCaseId = readOption(args, "--case");
const timeoutOption = readOption(args, "--timeout-ms");
const timeoutMs = timeoutOption === null ? null : Number(timeoutOption);
const reportStem =
  path.resolve(catalogPath) === path.resolve(defaultCatalogPath)
    ? "fixture-regression-report"
    : `fixture-regression-report.${getCatalogReportName(catalogPath)}`;
const jsonReportPath = path.join(outputDir, `${reportStem}.json`);
const markdownReportPath = path.join(outputDir, `${reportStem}.md`);
const htmlReportPath = path.join(outputDir, `${reportStem}.html`);
const privateScreenshotDir = path.join(
  repoRoot,
  "artifacts",
  "screenshots",
  "private-fixtures",
);
const shotOutcomePrefix = "YW_LOOK_SHOT_OUTCOME:";

const usage = `usage:
  npm run test:fixtures
  npm run test:fixtures -- --catalog <path>
  npm run test:fixtures -- --catalog samples/private/catalog.json --private
  npm run test:fixtures -- --case <id>
  npm run test:fixtures -- --list
  npm run test:fixtures -- --timeout-ms <ms>

Runs fixture catalog cases through the real shot/check loader path and writes
artifacts/logs/fixture-regression-report[.<catalog>].{json,md,html}.`;

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
        return [loader, envOverride ?? (await pathExists(config.packagePath))];
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
        shouldWarn: testCase.expect?.shouldWarn === true,
        nonBlankCanvas: testCase.expect?.nonBlankCanvas === true,
      },
      errorExpect: normalizeErrorExpect(testCase),
      knownFailure:
        typeof testCase.knownFailure === "string" && testCase.knownFailure
          ? testCase.knownFailure
          : null,
    };
  });
}

function normalizeStringArray(value, fieldName, caseId) {
  if (value === undefined || value === null) return [];
  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.length > 0)
  ) {
    return value;
  }
  throw new Error(`${caseId} has invalid ${fieldName}`);
}

function normalizeErrorExpect(testCase) {
  if (!testCase.errorExpect) return null;
  const category = testCase.errorExpect.category;
  if (typeof category !== "string" || category.length === 0) {
    throw new Error(`${testCase.id} has invalid errorExpect.category`);
  }
  return {
    category,
    reasonContains: normalizeStringArray(
      testCase.errorExpect.reasonContains,
      "errorExpect.reasonContains",
      testCase.id,
    ),
    logContains: normalizeStringArray(
      testCase.errorExpect.logContains,
      "errorExpect.logContains",
      testCase.id,
    ),
  };
}

function tail(text, maxLines = 24) {
  return text.split(/\r?\n/).slice(-maxLines).join("\n").trim();
}

function parseShotOutcome(text) {
  const outcomes = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(shotOutcomePrefix))
    .map((line) => line.slice(shotOutcomePrefix.length))
    .map((payload) => {
      try {
        return JSON.parse(payload);
      } catch (error) {
        return {
          parseError: error instanceof Error ? error.message : String(error),
          raw: payload,
        };
      }
    });
  return outcomes.at(-1) ?? null;
}

function normalizeText(value) {
  return String(value ?? "").toLowerCase();
}

function includesAll(haystack, needles) {
  const normalizedHaystack = normalizeText(haystack);
  return needles.filter(
    (needle) => !normalizedHaystack.includes(normalizeText(needle)),
  );
}

function stringifyShotOutcome(shotOutcome) {
  if (!shotOutcome) return "";
  if (shotOutcome.parseError)
    return `${shotOutcome.raw}\n${shotOutcome.parseError}`;
  return JSON.stringify(shotOutcome);
}

function validateRuntimeExpectations(testCase, outcome, shotOutcome) {
  const mismatches = [];
  const warnings = Array.isArray(shotOutcome?.warnings)
    ? shotOutcome.warnings.filter((warning) => typeof warning === "string")
    : [];

  if (testCase.expect.shouldWarn && warnings.length === 0) {
    mismatches.push("expected warning(s), but shot outcome had none");
  }

  if (!testCase.errorExpect) {
    return { ok: mismatches.length === 0, mismatches, warnings };
  }

  if (!shotOutcome) {
    mismatches.push("missing structured shot outcome");
  } else if (shotOutcome.parseError) {
    mismatches.push(
      `invalid structured shot outcome: ${shotOutcome.parseError}`,
    );
  }

  const outcomeText = stringifyShotOutcome(shotOutcome);
  const reasonHaystack = [
    shotOutcome?.error,
    ...(Array.isArray(shotOutcome?.warnings) ? shotOutcome.warnings : []),
    outcome.stderr,
  ].join("\n");
  const logHaystack = [outcomeText, outcome.stdout, outcome.stderr].join("\n");
  const missingReasonTokens = includesAll(
    reasonHaystack,
    testCase.errorExpect.reasonContains,
  );
  const missingLogTokens = includesAll(
    logHaystack,
    testCase.errorExpect.logContains,
  );

  if (missingReasonTokens.length > 0) {
    mismatches.push(
      `reason missing token(s): ${missingReasonTokens.join(", ")}`,
    );
  }
  if (missingLogTokens.length > 0) {
    mismatches.push(`log missing token(s): ${missingLogTokens.join(", ")}`);
  }

  return { ok: mismatches.length === 0, mismatches, warnings };
}

async function runCase(testCase) {
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

  const result = await runChildProcess(process.execPath, runArgs, {
    cwd: repoRoot,
    env: {
      ...process.env,
      YW_LOOK_CARGO_NO_DEFAULT_FEATURES:
        process.env.YW_LOOK_CARGO_NO_DEFAULT_FEATURES ?? "1",
      YW_LOOK_CARGO_FEATURES:
        process.env.YW_LOOK_CARGO_FEATURES ?? "backend-openusd-rs",
    },
    shell: false,
    timeoutMs,
    signalError: false,
  });

  return {
    ...result,
    screenshotPath,
  };
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
      if (failure.errorExpectMismatches?.length > 0) {
        lines.push(
          "Expectation mismatches:",
          "",
          ...failure.errorExpectMismatches.map((mismatch) => `- ${mismatch}`),
          "",
        );
      }
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toHtml(report) {
  const rows = report.results
    .map((result) => {
      const actual = result.skipped
        ? "skipped"
        : result.actualLoaded
          ? "loaded"
          : "failed";
      const details = [
        result.skipReason,
        result.knownFailure,
        result.error,
        ...(result.errorExpectMismatches ?? []),
      ].filter(Boolean);
      return `<tr class="status-${escapeHtml(result.status.toLowerCase())}">
  <td>${escapeHtml(result.id)}</td>
  <td>${escapeHtml(result.category)}</td>
  <td>${escapeHtml(result.assetState)}</td>
  <td>${escapeHtml(result.format)}</td>
  <td>${escapeHtml(result.requiresLoader ?? "")}</td>
  <td>${result.expectedShouldLoad ? "load" : "fail"}</td>
  <td>${escapeHtml(actual)}</td>
  <td>${escapeHtml(`${result.durationMs}ms`)}</td>
  <td>${escapeHtml(result.status)}</td>
  <td>${escapeHtml(details.join(" | "))}</td>
</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fixture Regression Report</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #08090a;
      color: #f7f8f8;
    }
    body {
      margin: 0;
      padding: 32px;
      background: #08090a;
    }
    main {
      max-width: 1200px;
      margin: 0 auto;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 28px;
      font-weight: 590;
    }
    .meta,
    .summary {
      color: #8a8f98;
      font-size: 13px;
    }
    .summary {
      margin: 20px 0;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .pill {
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 9999px;
      padding: 4px 10px;
      background: rgba(255, 255, 255, 0.03);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.02);
    }
    th,
    td {
      padding: 8px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      text-align: left;
      vertical-align: top;
      font-size: 12px;
    }
    th {
      color: #d0d6e0;
      font-weight: 510;
      background: rgba(255, 255, 255, 0.04);
    }
    td {
      color: #f7f8f8;
    }
    tr.status-pass td {
      color: #dff8e7;
    }
    tr.status-xfail td,
    tr.status-skip td {
      color: #d0d6e0;
    }
    tr.status-fail td,
    tr.status-xpass td {
      color: #ffd7d7;
    }
  </style>
</head>
<body>
  <main>
    <h1>Fixture Regression Report</h1>
    <div class="meta">
      Generated: ${escapeHtml(report.generatedAt)}<br>
      Catalog: ${escapeHtml(report.catalog)}
    </div>
    <div class="summary">
      <span class="pill">Total: ${report.summary.total}</span>
      <span class="pill">Passed: ${report.summary.passed}</span>
      <span class="pill">Known failures: ${report.summary.knownFailures}</span>
      <span class="pill">Skipped: ${report.summary.skipped}</span>
      <span class="pill">XPass: ${report.summary.xpass}</span>
      <span class="pill">Failed: ${report.summary.failed}</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Case</th>
          <th>Category</th>
          <th>State</th>
          <th>Format</th>
          <th>Loader</th>
          <th>Expected</th>
          <th>Actual</th>
          <th>Duration</th>
          <th>Result</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </main>
</body>
</html>
`;
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
  const shotOutcome = parseShotOutcome(outcome.stderr);
  const runtimeExpectation = validateRuntimeExpectations(
    testCase,
    outcome,
    shotOutcome,
  );
  const matchedExpectation =
    actualLoaded === testCase.expect.shouldLoad && runtimeExpectation.ok;
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
    expectedShouldWarn: testCase.expect.shouldWarn,
    expectedNonBlankCanvas: testCase.expect.nonBlankCanvas,
    errorExpect: testCase.errorExpect,
    errorExpectStatus: runtimeExpectation.ok ? "PASS" : "FAIL",
    errorExpectMismatches: runtimeExpectation.mismatches,
    warnings: runtimeExpectation.warnings,
    shotOutcome,
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

const passed = results.filter((result) => result.status === "PASS").length;
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
await writeFile(htmlReportPath, toHtml(report));

console.log(
  `[fixture] ${passed}/${results.length} passed, ${knownFailures} known failure(s), ${skipped} skipped, ${xpass} xpass; report: ${normalizeRepoPath(
    jsonReportPath,
  )}`,
);

process.exit(report.summary.failed === 0 ? 0 : 1);
