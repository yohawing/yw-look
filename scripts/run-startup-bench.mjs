#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasFlag, readOption } from "./cliArgs.mjs";
import { runChildProcess } from "./processRunner.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const shotScriptPath = path.join(repoRoot, "scripts", "run-shot.mjs");
const shotOutcomePrefix = "YW_LOOK_SHOT_OUTCOME:";
const defaultInput = path.join(
  repoRoot,
  "tests",
  "fixtures",
  "models",
  "triangle.gltf",
);
const defaultScreenshotDir = path.join(
  repoRoot,
  "artifacts",
  "screenshots",
  "startup-bench",
);
const measurementScopeCaveat =
  "Dev Tauri shot-startup smoke only. This benchmark launches via scripts/run-shot.mjs, " +
  "which may start the Vite dev server, compile or launch cargo, and run the shot render path. " +
  "It is not a packaged application cold-start measurement.";

const args = process.argv.slice(2);
if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
  console.log(`Usage: node scripts/run-startup-bench.mjs [options]

Measure wall-clock time for the existing Tauri shot path to complete its first render.

Options:
  --iterations <n>     Number of shot runs (default: 1)
  --input <path>       Model input path (default: tests/fixtures/models/triangle.gltf)
  --output-dir <path>  Report directory (default: artifacts/logs/startup-bench-<stamp>)
  --timeout-ms <n>     Per-iteration timeout in ms (default: 600000)
  --json <path>        Explicit JSON report path (Markdown is written beside it)

Outputs:
  artifacts/logs/startup-bench-*/startup-bench-report.{json,md}
  artifacts/screenshots/startup-bench/iteration-*.png

Scope:
  ${measurementScopeCaveat}`);
  process.exit(0);
}

function toRepoRelative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

function stampNow() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parsePositiveInt(value, optionName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

function parsePositiveNumber(value, optionName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive number`);
  }
  return parsed;
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

function summarizeNumbers(values) {
  if (values.length === 0) {
    return { count: 0, min: null, max: null, mean: null };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean =
    Math.round(
      (values.reduce((sum, value) => sum + value, 0) / values.length) * 100,
    ) / 100;
  return { count: values.length, min, max, mean };
}

function iterationScreenshotPath(iteration) {
  return path.join(
    defaultScreenshotDir,
    `iteration-${String(iteration).padStart(3, "0")}.png`,
  );
}

function buildShotCommand(inputPath, screenshotPath) {
  return [
    process.execPath,
    shotScriptPath,
    "shot",
    "--in",
    inputPath,
    "--out",
    screenshotPath,
  ];
}

function evaluateIteration(result, shotOutcome) {
  if (result.error) {
    return { ok: false, reason: result.error };
  }
  if (result.exitCode !== 0) {
    return {
      ok: false,
      reason: `shot exited with code ${result.exitCode ?? 1}`,
    };
  }
  if (!shotOutcome) {
    return { ok: false, reason: "missing YW_LOOK_SHOT_OUTCOME line" };
  }
  if (shotOutcome.parseError) {
    return {
      ok: false,
      reason: `invalid shot outcome JSON: ${shotOutcome.parseError}`,
    };
  }
  if (!shotOutcome.loaded) {
    return { ok: false, reason: "shot outcome reported loaded=false" };
  }
  if (!shotOutcome.nonBlankCanvas) {
    return {
      ok: false,
      reason: "shot outcome reported nonBlankCanvas=false",
    };
  }
  return { ok: true, reason: null };
}

function toMarkdown(report) {
  const lines = [
    "# Startup Bench Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Measurement scope",
    "",
    report.measurementScopeCaveat,
    "",
    "## Environment",
    "",
    `- Node: ${report.nodeVersion}`,
    `- Platform: ${report.platform}`,
    `- Input: \`${report.inputPath}\``,
    `- Iterations requested: ${report.iterationsRequested}`,
    `- Timeout per iteration: ${report.timeoutMs}ms`,
    "",
    "## Summary",
    "",
    `- Passed: ${report.summary.passed}/${report.summary.total}`,
    `- Failed: ${report.summary.failed}`,
    `- Wall-clock ms: min=${report.summary.wallClockMs.min ?? "n/a"}, max=${report.summary.wallClockMs.max ?? "n/a"}, mean=${report.summary.wallClockMs.mean ?? "n/a"}`,
    `- Shot loadTimeMs: min=${report.summary.loadTimeMs.min ?? "n/a"}, max=${report.summary.loadTimeMs.max ?? "n/a"}, mean=${report.summary.loadTimeMs.mean ?? "n/a"}`,
    "",
    "## Iterations",
    "",
    "| Iteration | Wall ms | loadTimeMs | Exit | Result | Screenshot |",
    "| --------- | ------- | ---------- | ---- | ------ | ---------- |",
  ];

  for (const iteration of report.iterations) {
    lines.push(
      `| ${[
        iteration.iteration,
        iteration.wallClockMs,
        iteration.shotOutcome?.loadTimeMs ?? "n/a",
        iteration.exitCode ?? "null",
        iteration.ok ? "pass" : `fail (${iteration.reason})`,
        iteration.outputScreenshotPath
          ? `\`${iteration.outputScreenshotPath}\``
          : "n/a",
      ].join(" | ")} |`,
    );
  }

  lines.push("", "## Commands", "");
  for (const iteration of report.iterations) {
    lines.push(`${iteration.iteration}. \`${iteration.command.join(" ")}\``);
  }

  return `${lines.join("\n")}\n`;
}

const iterations = parsePositiveInt(
  readOption(args, "--iterations") ?? "1",
  "--iterations",
);
const inputPath = path.resolve(
  repoRoot,
  readOption(args, "--input") ?? defaultInput,
);
const timeoutMs = parsePositiveNumber(
  readOption(args, "--timeout-ms") ?? "600000",
  "--timeout-ms",
);
const outputDir = path.resolve(
  repoRoot,
  readOption(args, "--output-dir") ??
    path.join("artifacts", "logs", `startup-bench-${stampNow()}`),
);
const jsonReportPath = path.resolve(
  repoRoot,
  readOption(args, "--json") ??
    path.join(outputDir, "startup-bench-report.json"),
);
const markdownReportPath = /\.json$/i.test(jsonReportPath)
  ? jsonReportPath.replace(/\.json$/i, ".md")
  : `${jsonReportPath}.md`;

await mkdir(outputDir, { recursive: true });
await mkdir(path.dirname(jsonReportPath), { recursive: true });
await mkdir(defaultScreenshotDir, { recursive: true });

const iterationResults = [];
for (let iteration = 1; iteration <= iterations; iteration += 1) {
  const screenshotPath = iterationScreenshotPath(iteration);
  const command = buildShotCommand(inputPath, screenshotPath);
  console.log(
    `[startup-bench] iteration ${iteration}/${iterations}: ${toRepoRelative(inputPath)}`,
  );

  const result = await runChildProcess(command[0], command.slice(1), {
    cwd: repoRoot,
    env: {
      ...process.env,
      YW_LOOK_CARGO_NO_DEFAULT_FEATURES:
        process.env.YW_LOOK_CARGO_NO_DEFAULT_FEATURES ?? "1",
      YW_LOOK_CARGO_FEATURES:
        process.env.YW_LOOK_CARGO_FEATURES ?? "backend-openusd-rs",
    },
    shell: process.platform === "win32",
    timeoutMs,
    forwardStdout: true,
    forwardStderr: true,
    signalError: false,
  });

  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  const shotOutcome = parseShotOutcome(combinedOutput);
  const verdict = evaluateIteration(result, shotOutcome);

  iterationResults.push({
    iteration,
    ok: verdict.ok,
    reason: verdict.reason,
    wallClockMs: result.durationMs,
    exitCode: result.exitCode,
    command: command.map((token) =>
      token.includes(" ") ? `"${token}"` : token,
    ),
    inputPath: toRepoRelative(inputPath),
    outputScreenshotPath: toRepoRelative(screenshotPath),
    shotOutcome,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
  });

  console.log(
    `[startup-bench] iteration ${iteration}: ${verdict.ok ? "pass" : "fail"} wall=${result.durationMs}ms loadTimeMs=${shotOutcome?.loadTimeMs ?? "n/a"}`,
  );
  if (!verdict.ok) {
    console.error(`[startup-bench] failure: ${verdict.reason}`);
  }
}

const passedIterations = iterationResults.filter((entry) => entry.ok);
const failedIterations = iterationResults.filter((entry) => !entry.ok);
const report = {
  generatedAt: new Date().toISOString(),
  measurementScopeCaveat,
  nodeVersion: process.version,
  platform: process.platform,
  inputPath: toRepoRelative(inputPath),
  outputDir: toRepoRelative(outputDir),
  screenshotDir: toRepoRelative(defaultScreenshotDir),
  iterationsRequested: iterations,
  timeoutMs,
  summary: {
    total: iterationResults.length,
    passed: passedIterations.length,
    failed: failedIterations.length,
    wallClockMs: summarizeNumbers(
      passedIterations.map((entry) => entry.wallClockMs),
    ),
    loadTimeMs: summarizeNumbers(
      passedIterations
        .map((entry) => entry.shotOutcome?.loadTimeMs)
        .filter((value) => typeof value === "number"),
    ),
  },
  iterations: iterationResults,
};

await writeFile(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(markdownReportPath, toMarkdown(report), "utf8");

console.log(`[startup-bench] json report: ${toRepoRelative(jsonReportPath)}`);
console.log(
  `[startup-bench] markdown report: ${toRepoRelative(markdownReportPath)}`,
);
console.log(
  `[startup-bench] summary: ${report.summary.passed}/${report.summary.total} passed`,
);

if (failedIterations.length > 0) {
  process.exit(1);
}
