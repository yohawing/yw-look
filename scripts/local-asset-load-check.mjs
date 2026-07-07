import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseNamedArgs } from "./cliArgs.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const defaultCsv = path.join(
  repoRoot,
  "artifacts",
  "local-assets",
  "3dcg-assets.csv",
);
const defaultOutDir = path.join(repoRoot, "artifacts", "local-assets");

const argv = parseNamedArgs(process.argv.slice(2), {
  values: {
    "--csv": "csv",
    "--out": "out",
    "--kinds": "kinds",
    "--case": "case",
    "--offset": "offset",
    "--limit": "limit",
    "--timeout-ms": "timeoutMs",
  },
});

if (argv.help) {
  printUsage();
  process.exit(0);
}

const csvPath = path.resolve(repoRoot, argv.csv ?? defaultCsv);
const outDir = path.resolve(repoRoot, argv.out ?? defaultOutDir);
const selectedId = argv.case ?? null;
const limit = argv.limit === undefined ? null : Number(argv.limit);
const offset = argv.offset === undefined ? 0 : Number(argv.offset);
const timeoutMs =
  argv.timeoutMs === undefined ? 180_000 : Number(argv.timeoutMs);
const includeKinds = argv.kinds
  ? new Set(
      argv.kinds
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    )
  : new Set(["model", "splat"]);

if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) {
  throw new Error("--limit must be a positive number");
}
if (!Number.isInteger(offset) || offset < 0) {
  throw new Error("--offset must be a non-negative integer");
}
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new Error("--timeout-ms must be a positive number");
}

const rows = parseCsv(await readFile(csvPath, "utf8"))
  .map(normalizeRow)
  .filter((row) => row.enabled)
  .filter((row) => includeKinds.has(row.kind));

let cases = selectedId ? rows.filter((row) => row.id === selectedId) : rows;
if (selectedId && cases.length === 0) {
  throw new Error(`unknown CSV case: ${selectedId}`);
}
if (!selectedId && offset > 0) {
  cases = cases.slice(offset);
}
if (limit !== null) {
  cases = cases.slice(0, limit);
}

const devServer = await ensureDevServer();
try {
  await mkdir(outDir, { recursive: true });

  const results = [];
  for (const [index, testCase] of cases.entries()) {
    console.log(`[local-assets] ${index + 1}/${cases.length} ${testCase.id}`);
    results.push(await evaluateCase(testCase));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    csv: csvPath,
    reportSchemaVersion: 1,
    filters: {
      kinds: [...includeKinds].sort(),
      case: selectedId,
      offset,
      limit,
      timeoutMs,
    },
    summary: summarize(results),
    results,
  };

  const jsonReportPath = path.join(outDir, "local-asset-load-report.json");
  const markdownReportPath = path.join(outDir, "local-asset-load-report.md");
  await writeFile(
    jsonReportPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await writeFile(markdownReportPath, renderMarkdown(report), "utf8");

  console.log("=== local-asset-load-check ===");
  console.log(`Total   : ${report.summary.total}`);
  console.log(`Pass    : ${report.summary.pass}`);
  console.log(`Warning : ${report.summary.warning}`);
  console.log(`Fail    : ${report.summary.fail}`);
  console.log(`Skip    : ${report.summary.skip}`);
  console.log(`JSON    : ${jsonReportPath}`);
  console.log(`Summary : ${markdownReportPath}`);

  process.exitCode = report.summary.fail > 0 ? 1 : 0;
} finally {
  await stopDevServer(devServer);
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}

async function evaluateCase(testCase) {
  if (!(await pathExists(testCase.path))) {
    return {
      ...publicCaseFields(testCase),
      status: "fail",
      category: "missing_file",
      durationMs: 0,
      exitCode: null,
      error: `missing file: ${testCase.path}`,
      stdoutTail: "",
      stderrTail: "",
    };
  }

  const outcome = await runShotCheck(testCase);
  const output = `${outcome.stdout}\n${outcome.stderr}`;
  const warnings = collectWarnings(output);
  const failed = outcome.exitCode !== 0 || Boolean(outcome.error);
  return {
    ...publicCaseFields(testCase),
    status: failed ? "fail" : warnings.length > 0 ? "warning" : "pass",
    category: failed ? classifyFailure(outcome, output) : null,
    durationMs: outcome.durationMs,
    exitCode: outcome.exitCode,
    error: outcome.error,
    warningCount: warnings.length,
    warnings,
    stdoutTail: tail(outcome.stdout),
    stderrTail: tail(outcome.stderr),
  };
}

function runShotCheck(testCase) {
  const startedAt = performance.now();
  const runArgs = [
    path.join(repoRoot, "scripts", "run-shot.mjs"),
    "check",
    "--in",
    testCase.path,
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
      shell: false,
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
    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: code,
        durationMs: Math.round(performance.now() - startedAt),
        stdout,
        stderr,
        error: signal ? `terminated by ${signal}` : null,
      });
    });
  });
}

async function ensureDevServer() {
  const devUrl = "http://127.0.0.1:1420/?entry=shot";
  if (await probeUrl(devUrl)) {
    return null;
  }

  const child = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  child.stdout?.on("data", (chunk) => {
    const text = chunk.toString();
    if (/error|failed|ready in/i.test(text)) {
      process.stdout.write(text);
    }
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
  try {
    await waitForUrl(devUrl, 60_000, child);
  } catch (error) {
    await stopDevServer(child);
    throw error;
  }
  return child;
}

function probeUrl(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(true);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(2_000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function waitForUrl(url, timeoutMs, serverProcess) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      serverProcess?.off("exit", onServerExit);
      serverProcess?.off("error", onServerError);
      callback(value);
    };
    const onServerExit = (code, signal) => {
      const reason =
        signal ?? (code === null ? "unknown status" : `exit code ${code}`);
      finish(reject, new Error(`dev server exited before ready: ${reason}`));
    };
    const onServerError = (error) => {
      finish(reject, error);
    };
    serverProcess?.once("exit", onServerExit);
    serverProcess?.once("error", onServerError);
    const poll = async () => {
      if (await probeUrl(url)) {
        finish(resolve);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        finish(reject, new Error(`dev server did not become ready: ${url}`));
        return;
      }
      setTimeout(poll, 500);
    };
    poll();
  });
}

function stopDevServer(serverProcess) {
  if (!serverProcess || serverProcess.killed) {
    return Promise.resolve();
  }
  if (process.platform === "win32" && serverProcess.pid) {
    return new Promise((resolve) => {
      const child = spawn(
        "taskkill",
        ["/pid", String(serverProcess.pid), "/T", "/F"],
        {
          stdio: "ignore",
          shell: false,
        },
      );
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    });
  }
  serverProcess.kill();
  return Promise.resolve();
}

async function pathExists(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

function publicCaseFields(testCase) {
  return {
    id: testCase.id,
    kind: testCase.kind,
    extension: testCase.extension,
    path: testCase.path,
    relativePath: testCase.relativePath,
    bytes: testCase.bytes,
  };
}

function collectWarnings(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\b(warn|warning)\b/i.test(line))
    .filter((line) => !line.startsWith("warning: constant "))
    .filter((line) => !line.startsWith("warning: `yw-look` "))
    .filter((line) => !line.startsWith("= note: `#[warn("))
    .slice(0, 50);
}

function classifyFailure(outcome, output) {
  const text = `${outcome.error ?? ""}\n${output}`.toLowerCase();
  if (text.includes("preview loader is not installed")) return "unsupported";
  if (text.includes("file not found") || text.includes("no such file")) {
    return "missing_reference";
  }
  if (
    text.includes("failed to remove file") &&
    text.includes("target\\debug\\yw-look.exe")
  ) {
    return "build_locked";
  }
  if (text.includes("timed out")) return "timeout";
  if (text.includes("usd inspector validation failed")) return "usd_quality";
  if (text.includes("unable to load mmd preview")) return "mmd_loader";
  if (text.includes("load failed")) return "loader_error";
  return outcome.error ? "process_error" : "loader_error";
}

function summarize(results) {
  const summary = {
    total: results.length,
    pass: 0,
    warning: 0,
    fail: 0,
    skip: 0,
    byKind: {},
    byExtension: {},
    categories: {},
  };
  for (const result of results) {
    summary[result.status] += 1;
    count(summary.byKind, result.kind);
    count(summary.byExtension, result.extension);
    if (result.category) {
      count(summary.categories, result.category);
    }
  }
  return summary;
}

function count(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

function renderMarkdown(report) {
  const lines = [
    "# Local Asset Load Report",
    "",
    `Generated: ${report.generatedAt}`,
    `CSV: \`${report.csv}\``,
    `Kinds: ${report.filters.kinds.join(", ")}`,
    "",
    "## Summary",
    "",
    `- Total: ${report.summary.total}`,
    `- Pass: ${report.summary.pass}`,
    `- Warning: ${report.summary.warning}`,
    `- Fail: ${report.summary.fail}`,
    `- Skip: ${report.summary.skip}`,
    "",
    "## Results",
    "",
    "| Status | Category | Kind | Ext | Duration | Path |",
    "| --- | --- | --- | --- | ---: | --- |",
  ];

  for (const result of report.results) {
    lines.push(
      `| ${result.status} | ${result.category ?? ""} | ${result.kind} | ${result.extension} | ${result.durationMs}ms | ${result.path} |`,
    );
  }

  const failures = report.results.filter((result) => result.status === "fail");
  if (failures.length > 0) {
    lines.push("", "## Failures", "");
    for (const failure of failures) {
      lines.push(`### ${failure.id}`, "");
      lines.push(`- Path: \`${failure.path}\``);
      lines.push(`- Category: ${failure.category ?? "unknown"}`);
      if (failure.error) {
        lines.push(`- Error: ${failure.error}`);
      }
      if (failure.stderrTail) {
        lines.push("", "```text", failure.stderrTail, "```");
      }
      if (failure.stdoutTail) {
        lines.push("", "```text", failure.stdoutTail, "```");
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) {
    return [];
  }
  const header = rows[0].map((name) => name.trim());
  return rows
    .slice(1)
    .filter((values) => values.length > 1)
    .map((values) =>
      Object.fromEntries(
        header.map((name, index) => [name, values[index] ?? ""]),
      ),
    );
}

function normalizeRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    extension: row.extension,
    path: path.resolve(row.path),
    relativePath: row.relative_path,
    bytes: Number(row.bytes) || 0,
    enabled: !["0", "false", "no", "off"].includes(
      String(row.enabled ?? "1")
        .trim()
        .toLowerCase(),
    ),
  };
}

function tail(value, maxLines = 28) {
  return value
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-maxLines)
    .join("\n");
}

function printUsage() {
  console.log(`usage:
  node scripts/local-asset-load-check.mjs --csv artifacts/local-assets/3dcg-assets.csv
  node scripts/local-asset-load-check.mjs --csv artifacts/local-assets/3dcg-assets.csv --kinds model,splat --limit 20
  node scripts/local-asset-load-check.mjs --csv artifacts/local-assets/3dcg-assets.csv --offset 100 --limit 50
  node scripts/local-asset-load-check.mjs --case <csv-id>

Reads a local asset CSV and runs each enabled model/splat case through scripts/run-shot.mjs check.
Default checked kinds: model,splat. Add MMD/VMD motion checks with --kinds model,motion,splat.`);
}
