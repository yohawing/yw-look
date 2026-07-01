import { spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const defaultOpenUsdRoot = "D:\\OpenUSD\\build";
const defaultCases = [
  {
    id: "psx-all",
    path: "D:\\psx\\repo\\ALL.usda",
  },
  {
    id: "psx-buildings",
    path: "D:\\psx\\repo\\BUILDINGS.usda",
  },
  {
    id: "psx-projectors",
    path: "D:\\psx\\repo\\PROJECTORS.usda",
  },
];

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const skipApp = args.includes("--skip-app");
const runUsdChecker = !args.includes("--skip-usdchecker");
const requireUsdChecker = args.includes("--require-usdchecker");
const selectedCaseIds = readRepeatedOption("--case");
const extraPaths = readRepeatedOption("--path");
const openUsdRoot = path.resolve(
  readOption("--openusd-root") ?? defaultOpenUsdRoot,
);
const openUsdBin = path.resolve(
  readOption("--openusd-bin") ?? path.join(openUsdRoot, "bin"),
);
const openUsdPython = path.resolve(
  readOption("--openusd-pythonpath") ?? path.join(openUsdRoot, "lib", "python"),
);
const timeoutMs = Number(readOption("--timeout-ms") ?? 180_000);
const appTimeoutMs = Number(readOption("--app-timeout-ms") ?? 300_000);
const backend = readOption("--backend") ?? "rust";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(repoRoot, "artifacts", "logs");
const jsonReportPath = path.join(outputDir, `usd-openusd-parity.${stamp}.json`);
const markdownReportPath = path.join(
  outputDir,
  `usd-openusd-parity.${stamp}.md`,
);

const usage = `usage:
  npm run test:usd:openusd-parity
  npm run test:usd:openusd-parity -- --case psx-buildings
  npm run test:usd:openusd-parity -- --path D:\\path\\asset.usda
  npm run test:usd:openusd-parity -- --backend rust|cpp|default
  npm run test:usd:openusd-parity -- --skip-app
  npm run test:usd:openusd-parity -- --list

Compares yw-look's USD check path against a local Pixar OpenUSD build.
OpenUSD root defaults to D:\\OpenUSD\\build. Reports are written under
artifacts/logs/usd-openusd-parity.<timestamp>.{json,md}.`;

if (args.includes("--help") || args.includes("-h")) {
  console.log(usage);
  process.exit(0);
}

if (!["rust", "cpp", "default"].includes(backend)) {
  throw new Error(`--backend must be rust, cpp, or default; got ${backend}`);
}

const cases = buildCases();
if (listOnly) {
  for (const testCase of cases) {
    console.log(`${testCase.id}\t${testCase.path}`);
  }
  process.exit(0);
}

await mkdir(outputDir, { recursive: true });
await assertTool(path.join(openUsdBin, "usdchecker.exe"), "usdchecker.exe");

const results = [];
for (const testCase of cases) {
  console.log(`[usd-parity] ${testCase.id}: ${testCase.path}`);
  results.push(await runCase(testCase));
}

const report = {
  generatedAt: new Date().toISOString(),
  repoRoot,
  openUsdRoot,
  openUsdBin,
  openUsdPython,
  backend,
  timeoutMs,
  appTimeoutMs,
  runUsdChecker,
  requireUsdChecker,
  cases: results,
};

await writeFile(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(markdownReportPath, renderMarkdown(report));

const failed = results.filter((result) => result.status !== "passed");
console.log(`[usd-parity] report: ${jsonReportPath}`);
if (failed.length > 0) {
  console.error(
    `[usd-parity] failed: ${failed.map((result) => result.id).join(", ")}`,
  );
  process.exit(1);
}
console.log(`[usd-parity] passed: ${results.length}`);
process.exit(0);

function buildCases() {
  const casesById = new Map(
    defaultCases.map((testCase) => [testCase.id, testCase]),
  );
  for (const rawPath of extraPaths) {
    const absolutePath = path.resolve(rawPath);
    const id = sanitizeId(
      path.basename(absolutePath, path.extname(absolutePath)),
    );
    casesById.set(id, { id, path: absolutePath });
  }

  const values = Array.from(casesById.values());
  if (selectedCaseIds.length === 0) {
    return values;
  }

  const selected = [];
  for (const id of selectedCaseIds) {
    const testCase = casesById.get(id);
    if (!testCase) {
      throw new Error(
        `unknown --case ${id}; available: ${values
          .map((value) => value.id)
          .join(", ")}`,
      );
    }
    selected.push(testCase);
  }
  return selected;
}

async function runCase(testCase) {
  const exists = await pathExists(testCase.path);
  if (!exists) {
    return {
      id: testCase.id,
      path: testCase.path,
      status: "failed",
      openUsd: null,
      usdchecker: null,
      app: null,
      error: "missing asset",
    };
  }

  const openUsd = await runOpenUsdProbe(testCase.path);
  const usdchecker = runUsdChecker
    ? await runUsdCheckerProbe(testCase.path)
    : null;
  const app = skipApp ? null : await runAppCheck(testCase.path);
  const failedReasons = [];

  if (openUsd.exitCode !== 0 || openUsd.error) {
    failedReasons.push("OpenUSD Python probe failed");
  }
  if (requireUsdChecker && usdchecker && usdchecker.exitCode !== 0) {
    failedReasons.push("usdchecker failed");
  }
  if (app && app.exitCode !== 0) {
    failedReasons.push("yw-look check failed");
  }
  if (app?.hasPanic) {
    failedReasons.push("yw-look check panicked");
  }

  return {
    id: testCase.id,
    path: testCase.path,
    status: failedReasons.length === 0 ? "passed" : "failed",
    openUsd,
    usdchecker,
    app,
    error: failedReasons.length === 0 ? null : failedReasons.join("; "),
  };
}

async function runOpenUsdProbe(assetPath) {
  const script = String.raw`
import json
import sys
from pxr import Usd, UsdGeom

path = sys.argv[1]
stage = Usd.Stage.Open(path, Usd.Stage.LoadAll)
if stage is None:
    raise RuntimeError("Usd.Stage.Open returned None")

stats = {
    "defaultPrim": str(stage.GetDefaultPrim().GetPath()) if stage.GetDefaultPrim() else None,
    "rootPrimCount": len(list(stage.GetPseudoRoot().GetChildren())),
    "primCount": 0,
    "meshCount": 0,
    "payloadPrimCount": 0,
    "variantSetCount": 0,
    "variantSets": [],
}
for prim in stage.TraverseAll():
    stats["primCount"] += 1
    if prim.IsA(UsdGeom.Mesh):
        stats["meshCount"] += 1
    if prim.HasAuthoredPayloads():
        stats["payloadPrimCount"] += 1
    if prim.HasVariantSets():
        variant_sets = prim.GetVariantSets()
        for set_name in variant_sets.GetNames():
            vset = variant_sets.GetVariantSet(set_name)
            stats["variantSetCount"] += 1
            stats["variantSets"].append({
                "primPath": str(prim.GetPath()),
                "setName": set_name,
                "selection": vset.GetVariantSelection() or None,
                "variants": list(vset.GetVariantNames()),
            })
print(json.dumps(stats, ensure_ascii=False))
`;
  const result = await runProcess("python", ["-c", script, assetPath], {
    timeout: timeoutMs,
    env: openUsdEnv(),
  });
  return {
    ...result,
    stats: parseJsonLine(result.stdout),
  };
}

async function runUsdCheckerProbe(assetPath) {
  const exe = path.join(openUsdBin, "usdchecker.exe");
  const result = await runProcess(exe, [assetPath], {
    timeout: timeoutMs,
    env: openUsdEnv(),
  });
  return {
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    hasPanic: hasPanicOutput(`${result.stdout}\n${result.stderr}`),
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
    error: result.error,
  };
}

async function runAppCheck(assetPath) {
  const env = {
    ...process.env,
  };
  if (backend === "rust") {
    env.YW_LOOK_CARGO_NO_DEFAULT_FEATURES = "1";
    env.YW_LOOK_CARGO_FEATURES = "backend-openusd-rs";
  } else if (backend === "cpp") {
    env.YW_LOOK_CARGO_NO_DEFAULT_FEATURES = "1";
    env.YW_LOOK_CARGO_FEATURES = "backend-openusd-cpp";
  }

  const result = await runProcess(
    process.execPath,
    [
      path.join(repoRoot, "scripts", "run-shot.mjs"),
      "check",
      "--in",
      assetPath,
    ],
    {
      timeout: appTimeoutMs,
      cwd: repoRoot,
      env,
    },
  );
  return {
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    hasPanic: hasPanicOutput(`${result.stdout}\n${result.stderr}`),
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
    error: result.error,
  };
}

function runProcess(command, commandArgs, options = {}) {
  const startedAt = performance.now();
  const timeout = options.timeout ?? 180_000;
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({
        exitCode: null,
        durationMs: Math.round(performance.now() - startedAt),
        stdout,
        stderr,
        error: `timed out after ${timeout}ms`,
      });
    }, timeout);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
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
      clearTimeout(timer);
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

function openUsdEnv() {
  const delimiter = path.delimiter;
  return {
    ...process.env,
    PATH: [openUsdBin, process.env.PATH].filter(Boolean).join(delimiter),
    PYTHONPATH: [openUsdPython, process.env.PYTHONPATH]
      .filter(Boolean)
      .join(delimiter),
  };
}

function parseJsonLine(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.startsWith("{") && value.endsWith("}"));
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function renderMarkdown(report) {
  const lines = [
    "# USD OpenUSD Parity Report",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Backend: ${report.backend}`,
    `- OpenUSD: ${report.openUsdRoot}`,
    `- requireUsdChecker: ${report.requireUsdChecker}`,
    "",
    "| Case | Status | OpenUSD meshes | OpenUSD variants | App exit | App panic | App ms | Error |",
    "| --- | --- | ---: | ---: | ---: | --- | ---: | --- |",
  ];
  for (const result of report.cases) {
    lines.push(
      [
        result.id,
        result.status,
        result.openUsd?.stats?.meshCount ?? "-",
        result.openUsd?.stats?.variantSetCount ?? "-",
        result.app?.exitCode ?? "-",
        result.app?.hasPanic ? "yes" : "no",
        result.app?.durationMs ?? "-",
        result.error ?? "",
      ]
        .map(escapeMarkdownCell)
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function escapeMarkdownCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function tail(text, maxLines = 32) {
  return text.split(/\r?\n/).slice(-maxLines).join("\n").trim();
}

function hasPanicOutput(text) {
  return /\bthread '.*' panicked at\b|\bpanicked at\b/.test(text);
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertTool(filePath, label) {
  if (!(await pathExists(filePath))) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function sanitizeId(value) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
}

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function readRepeatedOption(name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    values.push(value);
    index += 1;
  }
  return values;
}
