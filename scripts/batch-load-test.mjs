import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const samplesDir = path.join(repoRoot, "samples", "private");
const manifestPath = path.join(samplesDir, "models.json");
const outputDir = path.join(repoRoot, "artifacts", "logs");
const jsonReportPath = path.join(outputDir, "batch-load-report.json");
const textReportPath = path.join(outputDir, "batch-load-report.md");

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const useStaticEnumeration = args.includes("--static-enumeration");
const selectedCaseId = readOption("--case");
const timeoutMs = Number(readOption("--timeout-ms") ?? 180_000);

const loaderMap = {
  ".gltf": "GLTFLoader",
  ".glb": "GLTFLoader",
  ".fbx": "FBXLoader",
  ".obj": "OBJLoader",
  ".stl": "STLLoader",
  ".ply": "PLYLoader",
  ".dae": "ColladaLoader",
  ".usd": "USDLoader",
  ".usda": "USDLoader",
  ".usdc": "USDLoader",
  ".usdz": "USDLoader",
  ".png": "TextureLoader",
  ".jpg": "TextureLoader",
  ".jpeg": "TextureLoader",
  ".tga": "TGALoader",
  ".hdr": "RGBELoader",
  ".exr": "EXRLoader",
  ".dds": "DDSLoader",
  ".ktx2": "KTX2Loader",
};

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

function loaderFor(filePath) {
  return loaderMap[path.extname(filePath).toLowerCase()] ?? null;
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walkDir(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function readManifestCases() {
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  if (!Array.isArray(manifest.models)) {
    throw new Error(`${normalizeRepoPath(manifestPath)} must contain models[]`);
  }

  return manifest.models.map((model) => {
    const input = path.resolve(repoRoot, model.path);
    return {
      id: model.id,
      name: model.name ?? model.id,
      source: "manifest",
      path: normalizeRepoPath(input),
      absolutePath: input,
      expected: model.expect ?? null,
      loader: loaderFor(input),
    };
  });
}

async function readStaticCases() {
  const files = await walkDir(samplesDir);
  return files
    .filter((filePath) => path.basename(filePath) !== "models.json")
    .map((filePath) => ({
      id: normalizeRepoPath(filePath),
      name: path.basename(filePath),
      source: "static-enumeration",
      path: normalizeRepoPath(filePath),
      absolutePath: filePath,
      expected: null,
      loader: loaderFor(filePath),
    }));
}

function collectWarnings(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\b(warn|warning)\b/i.test(line))
    .filter((line) => !line.startsWith("warning: constant "))
    .filter((line) => !line.startsWith("warning: `yw-look` "))
    .filter((line) => !line.startsWith("= note: `#[warn("));
}

function classifyFailure({ exitCode, error, output, loader }) {
  const text = `${error ?? ""}\n${output ?? ""}`.toLowerCase();
  if (!loader) return "unsupported";
  if (text.includes("not found") || text.includes("no such file")) {
    return "missing_reference";
  }
  if (
    text.includes("texture") &&
    (text.includes("missing") || text.includes("not found"))
  ) {
    return "texture_missing";
  }
  if (text.includes("unsupported") || text.includes("unknown extension")) {
    return "unsupported";
  }
  if (
    text.includes("tauri") ||
    text.includes("backend") ||
    text.includes("usd")
  ) {
    return "backend_error";
  }
  if (exitCode !== 0 && text.includes("loader")) return "loader_error";
  if (error) return "process_error";
  return "loader_error";
}

function runCheck(testCase) {
  const startedAt = performance.now();
  const runArgs = [
    path.join(repoRoot, "scripts/run-shot.mjs"),
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

async function evaluateCase(testCase) {
  if (!testCase.loader) {
    return {
      ...publicCaseFields(testCase),
      status: "failed",
      category: "unsupported",
      durationMs: 0,
      warnings: [],
      error: "unsupported extension",
    };
  }

  if (!(await pathExists(testCase.absolutePath))) {
    return {
      ...publicCaseFields(testCase),
      status: "failed",
      category: "missing_file",
      durationMs: 0,
      warnings: [],
      error: `missing file: ${testCase.path}`,
    };
  }

  const result = await runCheck(testCase);
  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  const warnings = collectWarnings(combinedOutput);
  const failed = result.exitCode !== 0 || result.error !== null;

  return {
    ...publicCaseFields(testCase),
    status: failed ? "failed" : warnings.length > 0 ? "warning" : "success",
    category: failed
      ? classifyFailure({
          exitCode: result.exitCode,
          error: result.error,
          output: combinedOutput,
          loader: testCase.loader,
        })
      : null,
    durationMs: result.durationMs,
    warnings,
    error: result.error,
    exitCode: result.exitCode,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
  };
}

function publicCaseFields(testCase) {
  return {
    id: testCase.id,
    name: testCase.name,
    source: testCase.source,
    path: testCase.path,
    loader: testCase.loader,
    expected: testCase.expected,
  };
}

function tail(value, maxLines = 40) {
  const lines = value.trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-maxLines);
}

function summarize(results) {
  const summary = {
    total: results.length,
    success: 0,
    warning: 0,
    failed: 0,
    categories: {},
  };
  for (const result of results) {
    summary[result.status] += 1;
    if (result.category) {
      summary.categories[result.category] =
        (summary.categories[result.category] ?? 0) + 1;
    }
  }
  return summary;
}

function renderMarkdown(report) {
  const lines = [
    "# Batch Load Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Input: ${report.input}`,
    "",
    "## Summary",
    "",
    `- Total: ${report.summary.total}`,
    `- Success: ${report.summary.success}`,
    `- Warning: ${report.summary.warning}`,
    `- Failed: ${report.summary.failed}`,
    "",
    "## Results",
    "",
    "| Status | Category | Loader | Duration | Path |",
    "| --- | --- | --- | ---: | --- |",
  ];

  for (const result of report.results) {
    lines.push(
      `| ${result.status} | ${result.category ?? ""} | ${result.loader ?? ""} | ${result.durationMs}ms | ${result.path} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

let cases = useStaticEnumeration
  ? await readStaticCases()
  : await readManifestCases();

if (selectedCaseId) {
  cases = cases.filter((testCase) => testCase.id === selectedCaseId);
  if (cases.length === 0) {
    throw new Error(`unknown batch load case: ${selectedCaseId}`);
  }
}

if (listOnly) {
  for (const testCase of cases) {
    console.log(`${testCase.id}: ${testCase.path}`);
  }
  process.exit(0);
}

const results = [];
for (const testCase of cases) {
  console.log(`[batch] ${testCase.id}: ${testCase.path}`);
  results.push(await evaluateCase(testCase));
}

const report = {
  generatedAt: new Date().toISOString(),
  input: useStaticEnumeration
    ? normalizeRepoPath(samplesDir)
    : normalizeRepoPath(manifestPath),
  reportSchemaVersion: 2,
  summary: summarize(results),
  results,
};

await mkdir(outputDir, { recursive: true });
await writeFile(jsonReportPath, JSON.stringify(report, null, 2), "utf8");
await writeFile(textReportPath, renderMarkdown(report), "utf8");

console.log("=== batch-load-test ===");
console.log(`Total   : ${report.summary.total}`);
console.log(`Success : ${report.summary.success}`);
console.log(`Warning : ${report.summary.warning}`);
console.log(`Failed  : ${report.summary.failed}`);
console.log(`JSON    : ${jsonReportPath}`);
console.log(`Summary : ${textReportPath}`);

process.exit(report.summary.failed > 0 ? 1 : 0);
