import {
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePngPixels, comparePixels } from "./pngPixels.mjs";
import { runChildProcess } from "./processRunner.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const scenarioPath = path.join(
  repoRoot,
  "tests/visual/usd-stateful-cases.json",
);
const outputDir = path.join(repoRoot, "artifacts/screenshots/usd-stateful");
const snapshotDir = path.join(repoRoot, "tests/visual/snapshots/usd-stateful");
const imageSize = { width: 384, height: 288 };
const usage = `usage: npm run test:usd-stateful-regression -- [--case <id>] [--update-snapshot] [--list] [--shot-binary <path>]`;

function fail(message) {
  throw new Error(message);
}

export function verifyReport(scenario, report) {
  if (!Array.isArray(report?.cases)) fail("capture report has no cases array");
  for (const scenarioCase of scenario.cases) {
    const actualCase = report.cases.find((item) => item.id === scenarioCase.id);
    if (!actualCase) fail(`capture report is missing case: ${scenarioCase.id}`);
    for (const expected of scenarioCase.captures) {
      const actual = actualCase.captures?.find(
        (item) => item.id === expected.id,
      );
      if (!actual) fail(`capture report is missing capture: ${expected.id}`);
      if (actual.error) fail(`capture failed: ${expected.id}: ${actual.error}`);
      const diagnostics = [
        ...(actual.operationDiagnostics ?? []),
        ...(actual.extractionDiagnostics ?? []),
      ];
      if (
        JSON.stringify(diagnostics) !==
        JSON.stringify(expected.expectedDiagnostics ?? [])
      ) {
        fail(
          `diagnostics mismatch for ${expected.id}: expected ${JSON.stringify(expected.expectedDiagnostics ?? [])}, got ${JSON.stringify(diagnostics)}`,
        );
      }
    }
  }
}

export function assertPngDimensions(buffer, label, expected = imageSize) {
  const decoded = decodePngPixels(buffer);
  if (decoded.width !== expected.width || decoded.height !== expected.height) {
    fail(
      `${label} dimensions must be ${expected.width}x${expected.height}, got ${decoded.width}x${decoded.height}`,
    );
  }
  return decoded;
}

export function requireBaseline(isPresent, label) {
  if (!isPresent) fail(`snapshot is missing: ${label}`);
}

export function validateScenarioCases(cases) {
  const captureIds = new Set();
  for (const scenarioCase of cases) {
    if (
      !Array.isArray(scenarioCase.captures) ||
      scenarioCase.captures.length === 0
    )
      fail(`case has no captures: ${scenarioCase.id}`);
    for (const capture of scenarioCase.captures) {
      if (!/^[A-Za-z0-9_-]+$/.test(capture.id ?? ""))
        fail(`capture id is not filename-safe: ${capture.id}`);
      if (captureIds.has(capture.id))
        fail(`duplicate capture id: ${capture.id}`);
      captureIds.add(capture.id);
    }
  }
}

export function verifyPayloadRelationships(captures) {
  const byId = new Map(captures.map((capture) => [capture.id, capture]));
  const loaded = byId.get("loaded");
  const unloaded = byId.get("unloaded");
  const reloaded = byId.get("reloaded");
  if (!loaded || !unloaded || !reloaded)
    fail("payload scenario needs loaded, unloaded, and reloaded captures");
  if (loaded.glb.equals(unloaded.glb))
    fail("unloaded GLB must differ from loaded GLB");
  if (!loaded.glb.equals(reloaded.glb))
    fail("reloaded GLB must exactly match loaded GLB");
  if (!comparePixels(loaded.png, reloaded.png))
    fail("reloaded PNG pixels must exactly match loaded PNG pixels");
  if (comparePixels(loaded.png, unloaded.png))
    fail("unloaded PNG pixels must differ from loaded PNG pixels");
  const hasPayload = (capture) =>
    capture.meshes.includes("Quad") || capture.nodes.includes("Quad");
  const hasInline = (capture) =>
    capture.meshes.includes("InlineMesh") ||
    capture.nodes.includes("InlineMesh");
  if (!hasPayload(loaded) || !hasPayload(reloaded) || hasPayload(unloaded))
    fail("payload mesh/node evidence does not match load state");
  if (!hasInline(loaded) || !hasInline(unloaded) || !hasInline(reloaded))
    fail("inline mesh/node evidence is missing");
}

function parseArgs(argv) {
  const parsed = { update: false, list: false, caseId: null, shotBinary: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--update-snapshot") parsed.update = true;
    else if (arg === "--list") parsed.list = true;
    else if (arg === "--case" || arg === "--shot-binary") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) fail(`${arg} requires a value`);
      if (arg === "--case") parsed.caseId = value;
      else parsed.shotBinary = value;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    } else fail(`unknown argument: ${arg}`);
  }
  return parsed;
}

async function loadScenario() {
  const scenario = JSON.parse(await readFile(scenarioPath, "utf8"));
  if (!Array.isArray(scenario.cases) || scenario.cases.length === 0)
    fail("scenario must contain at least one case");
  return scenario;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function assertChild(result, label) {
  if (result.error) fail(`${label}: ${result.error}`);
  if (result.exitCode !== 0)
    fail(`${label} exited with code ${result.exitCode ?? 1}`);
}

async function removeOwnedOutputs(scenario) {
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    rm(path.join(outputDir, "report.json"), { force: true }),
    rm(path.join(outputDir, "shot-batch-config.json"), { force: true }),
    rm(path.join(outputDir, "selected-scenario.json"), { force: true }),
    ...scenario.cases.flatMap((scenarioCase) =>
      scenarioCase.captures.flatMap((capture) => [
        rm(path.join(outputDir, `${capture.id}.glb`), { force: true }),
        rm(path.join(outputDir, `${capture.id}.png`), { force: true }),
      ]),
    ),
  ]);
}

async function runExtractor(configPath) {
  const result = await runChildProcess(
    "cargo",
    [
      "run",
      "--manifest-path",
      path.join(repoRoot, "src-tauri/Cargo.toml"),
      "--example",
      "usd_stateful_capture",
      "--",
      "--config",
      configPath,
      "--out-dir",
      outputDir,
    ],
    {
      cwd: repoRoot,
      timeoutMs: 120_000,
      forwardStdout: true,
      forwardStderr: true,
    },
  );
  assertChild(result, "USD stateful extractor");
}

async function render(captures, shotBinary) {
  const batch = captures.map((capture) => ({
    inputPath: capture.glbPath,
    outputPath: capture.pngPath,
    width: imageSize.width,
    height: imageSize.height,
    background: "default",
  }));
  const batchPath = path.join(outputDir, "shot-batch-config.json");
  await writeFile(batchPath, JSON.stringify(batch, null, 2));
  const command = shotBinary ?? process.execPath;
  const args = shotBinary
    ? ["--shot-batch-file", batchPath]
    : [
        path.join(repoRoot, "scripts/run-shot.mjs"),
        "shot-batch",
        "--config-file",
        batchPath,
      ];
  const result = await runChildProcess(command, args, {
    cwd: repoRoot,
    timeoutMs: 120_000,
    forwardStdout: true,
    forwardStderr: true,
    shell: false,
  });
  assertChild(result, "USD stateful shot batch");
}

export async function validateSnapshots(captures, update) {
  for (const capture of captures) {
    if (!(await exists(capture.pngPath)))
      fail(`shot output is missing: ${capture.pngPath}`);
    const actual = await readFile(capture.pngPath);
    assertPngDimensions(actual, `actual ${capture.id}`);
    if (await exists(capture.snapshotPath)) {
      const baseline = await readFile(capture.snapshotPath);
      assertPngDimensions(baseline, `baseline ${capture.id}`);
      if (!update && !comparePixels(actual, baseline))
        fail(`snapshot pixels differ: ${capture.id}`);
    } else if (!update) {
      requireBaseline(false, capture.snapshotPath);
    }
    capture.png = actual;
    capture.glb = await readFile(capture.glbPath);
  }
}

export async function updateSnapshots(captures) {
  for (const capture of captures) {
    await mkdir(path.dirname(capture.snapshotPath), { recursive: true });
    await copyFile(capture.pngPath, capture.snapshotPath);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const scenario = await loadScenario();
  const selected = options.caseId
    ? scenario.cases.filter((item) => item.id === options.caseId)
    : scenario.cases;
  if (selected.length === 0) fail(`unknown case: ${options.caseId}`);
  if (options.list) {
    selected.forEach((item) => console.log(item.id));
    return;
  }
  validateScenarioCases(selected);
  const selectedScenario = { cases: selected };
  await removeOwnedOutputs(selectedScenario);
  const extractorScenario = {
    cases: selected.map((scenarioCase) => ({
      ...scenarioCase,
      stagePath: path.resolve(
        path.dirname(scenarioPath),
        scenarioCase.stagePath,
      ),
    })),
  };
  const extractorScenarioPath = path.join(outputDir, "selected-scenario.json");
  await writeFile(
    extractorScenarioPath,
    JSON.stringify(extractorScenario, null, 2),
  );
  await runExtractor(extractorScenarioPath);
  const report = JSON.parse(
    await readFile(path.join(outputDir, "report.json"), "utf8"),
  );
  verifyReport(selectedScenario, report);
  const captures = selected.flatMap((scenarioCase) => {
    const reportCase = report.cases.find((item) => item.id === scenarioCase.id);
    return scenarioCase.captures.map((capture) => {
      const actual = reportCase.captures.find((item) => item.id === capture.id);
      return {
        ...actual,
        pngPath: path.join(outputDir, `${capture.id}.png`),
        snapshotPath: path.join(snapshotDir, `${capture.id}.png`),
      };
    });
  });
  await render(captures, options.shotBinary);
  await validateSnapshots(captures, options.update);
  for (const scenarioCase of selected)
    verifyPayloadRelationships(
      captures.filter((capture) =>
        scenarioCase.captures.some((item) => item.id === capture.id),
      ),
    );
  if (options.update) await updateSnapshots(captures);
  console.log(
    `USD stateful regression passed: ${selected.map((item) => item.id).join(", ")}`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
