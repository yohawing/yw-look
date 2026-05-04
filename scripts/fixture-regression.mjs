import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const catalogPath = path.join(repoRoot, "tests", "fixtures", "catalog.json");
const outputDir = path.join(repoRoot, "artifacts", "logs");
const jsonReportPath = path.join(outputDir, "fixture-regression-report.json");
const markdownReportPath = path.join(outputDir, "fixture-regression-report.md");

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const selectedCaseId = readOption("--case");
const timeoutMs = Number(readOption("--timeout-ms") ?? 120_000);

const usage = `usage:
  npm run test:fixtures
  npm run test:fixtures -- --case <id>
  npm run test:fixtures -- --list

Runs fixture catalog cases through the real shot/check loader path and writes
artifacts/logs/fixture-regression-report.{json,md}.`;

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

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readCatalog() {
  const raw = await readFile(catalogPath, "utf8");
  const catalog = JSON.parse(raw);
  if (!Array.isArray(catalog.cases)) {
    throw new Error(`${normalizeRepoPath(catalogPath)} must contain cases[]`);
  }

  return catalog.cases.map((testCase) => {
    const absolutePath = path.resolve(repoRoot, testCase.path);
    return {
      id: testCase.id,
      category: testCase.category ?? "uncategorized",
      format: testCase.format ?? path.extname(testCase.path).slice(1),
      path: normalizeRepoPath(absolutePath),
      absolutePath,
      expect: {
        shouldLoad: testCase.expect?.shouldLoad !== false,
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

function runCheck(testCase) {
  const startedAt = performance.now();
  const runArgs = [
    path.join(repoRoot, "scripts", "run-shot.mjs"),
    "check",
    "--in",
    testCase.absolutePath,
  ];

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
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill("SIGKILL");
      resolve({
        exitCode: null,
        durationMs: Math.round(performance.now() - startedAt),
        stdout,
        stderr,
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
      clearTimeout(timeout);
      resolve({
        exitCode: null,
        durationMs: Math.round(performance.now() - startedAt),
        stdout,
        stderr,
        error: error.message,
      });
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: code,
        durationMs: Math.round(performance.now() - startedAt),
        stdout,
        stderr,
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
    `Summary: ${report.summary.passed}/${report.summary.total} passed, ${report.summary.knownFailures} known failure(s)`,
    "",
    "| Case | Category | Format | Expected | Actual | Duration | Result |",
    "| ---- | -------- | ------ | -------- | ------ | -------- | ------ |",
  ];

  for (const result of report.results) {
    lines.push(
      [
        result.id,
        result.category,
        result.format,
        result.expectedShouldLoad ? "load" : "fail",
        result.actualLoaded ? "loaded" : "failed",
        `${result.durationMs}ms`,
        result.knownFailure ? "XFAIL" : result.ok ? "PASS" : "FAIL",
      ]
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }

  const failures = report.results.filter((result) => !result.ok);
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

let cases;
try {
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
    console.log(`${testCase.id}: ${testCase.path}`);
  }
  process.exit(0);
}

await mkdir(outputDir, { recursive: true });

const results = [];
for (const testCase of cases) {
  const exists = await pathExists(testCase.absolutePath);
  if (!exists) {
    results.push({
      ...testCase,
      expectedShouldLoad: testCase.expect.shouldLoad,
      actualLoaded: false,
      ok: !testCase.expect.shouldLoad || Boolean(testCase.knownFailure),
      knownFailure: testCase.knownFailure,
      durationMs: 0,
      exitCode: null,
      error: "fixture file is missing",
      stdoutTail: "",
      stderrTail: "",
    });
    continue;
  }

  console.log(`[fixture] ${testCase.id}`);
  const outcome = await runCheck(testCase);
  const actualLoaded = outcome.exitCode === 0;
  const matchedExpectation = actualLoaded === testCase.expect.shouldLoad;
  const knownFailureHit = !matchedExpectation && Boolean(testCase.knownFailure);
  results.push({
    id: testCase.id,
    category: testCase.category,
    format: testCase.format,
    path: testCase.path,
    expectedShouldLoad: testCase.expect.shouldLoad,
    actualLoaded,
    ok: matchedExpectation || knownFailureHit,
    knownFailure: knownFailureHit ? testCase.knownFailure : null,
    durationMs: outcome.durationMs,
    exitCode: outcome.exitCode,
    error: outcome.error,
    stdoutTail: tail(outcome.stdout),
    stderrTail: tail(outcome.stderr),
  });
}

const passed = results.filter(
  (result) => result.ok && !result.knownFailure,
).length;
const knownFailures = results.filter((result) => result.knownFailure).length;
const failed = results.filter((result) => !result.ok).length;
const report = {
  generatedAt: new Date().toISOString(),
  catalog: normalizeRepoPath(catalogPath),
  summary: {
    total: results.length,
    passed,
    knownFailures,
    failed,
  },
  results,
};

await writeFile(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(markdownReportPath, toMarkdown(report));

console.log(
  `[fixture] ${passed}/${results.length} passed, ${knownFailures} known failure(s); report: ${normalizeRepoPath(
    jsonReportPath,
  )}`,
);

process.exit(report.summary.failed === 0 ? 0 : 1);
