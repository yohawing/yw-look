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
import { verifyGlbFeatures } from "./usd-stateful-glb.mjs";

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
const caseRelationships = new Set(["payload", "independent", "variant"]);
const glbProfiles = new Set([
  "material-subsets",
  "authored-normals",
  "skinning",
  "point-instancer",
  "variant-red",
  "variant-blue",
]);
const approvedExpectedFailures = new Set([
  "extraction\u0000USD_INVALID_VARIANT_SELECTION",
  "adapter\u0000USD_STATEFUL_TIMECODE_UNSUPPORTED",
]);

function fail(message) {
  throw new Error(message);
}

export function verifyReport(scenario, report) {
  const summary = classifyReport(scenario, report);
  const issue = summary.records.find(
    (record) => record.status === "FAIL" || record.status === "XPASS",
  );
  if (issue) fail(issue.detail);
  return summary;
}

function diagnosticsFor(actualCase) {
  return [
    ...(actualCase.operationDiagnostics ?? []),
    ...(actualCase.extractionDiagnostics ?? []),
  ];
}

function matchesExpectedFailure(actualFailure, expectedFailure) {
  if (!actualFailure || typeof actualFailure !== "object") return false;
  const failureKind = `${actualFailure.origin}\u0000${actualFailure.code}`;
  if (failureKind !== `${expectedFailure.origin}\u0000${expectedFailure.code}`)
    return false;
  return actualFailure.message === expectedFailure.message;
}

export function classifyReport(scenario, report) {
  if (!Array.isArray(report?.cases)) fail("capture report has no cases array");
  validateScenarioCases(scenario.cases);
  const records = [];
  const counts = { PASS: 0, XFAIL: 0, FAIL: 0, XPASS: 0 };
  for (const scenarioCase of scenario.cases) {
    const actualCase = report.cases.find((item) => item.id === scenarioCase.id);
    if (!actualCase) fail(`capture report is missing case: ${scenarioCase.id}`);
    if (!Array.isArray(actualCase.captures))
      fail(`capture report has no captures array: ${scenarioCase.id}`);
    for (const expected of scenarioCase.captures) {
      const actual = actualCase.captures?.find(
        (item) => item.id === expected.id,
      );
      if (!actual) fail(`capture report is missing capture: ${expected.id}`);
      const diagnostics = diagnosticsFor(actual);
      const expectedDiagnostics = expected.expectedDiagnostics ?? [];
      const diagnosticsMatch =
        JSON.stringify(diagnostics) === JSON.stringify(expectedDiagnostics);
      let status = "PASS";
      let detail = "";
      if (expected.expectedFailure && !actual.error) {
        status = "XPASS";
        detail = `expected failure passed unexpectedly: ${expected.id}`;
      } else if (actual.error && expected.expectedFailure) {
        const declaration = expected.expectedFailure;
        const approved = approvedExpectedFailures.has(
          `${declaration.origin}\u0000${declaration.code}`,
        );
        if (!approved) {
          status = "FAIL";
          detail = `expected failure type is not approved: ${expected.id}`;
        } else if (
          actual.error !== actual.failure?.message ||
          !matchesExpectedFailure(actual.failure, declaration)
        ) {
          status = "FAIL";
          detail = `expected failure mismatch for ${expected.id}: expected ${declaration.message}, got ${actual.failure?.message ?? actual.error}`;
        } else if (!diagnosticsMatch) {
          status = "FAIL";
          detail = `diagnostics mismatch for ${expected.id}: expected ${JSON.stringify(expectedDiagnostics)}, got ${JSON.stringify(diagnostics)}`;
        } else {
          status = "XFAIL";
          detail = `expected failure: ${declaration.reason}`;
        }
      } else if (actual.error) {
        status = "FAIL";
        detail = `capture failed: ${expected.id}: ${actual.error}`;
      } else if (!diagnosticsMatch) {
        status = "FAIL";
        detail = `diagnostics mismatch for ${expected.id}: expected ${JSON.stringify(expectedDiagnostics)}, got ${JSON.stringify(diagnostics)}`;
      } else if (actual.failure) {
        status = "FAIL";
        detail = `capture has an unexpected structured failure: ${expected.id}`;
      }
      counts[status] += 1;
      records.push({
        caseId: scenarioCase.id,
        captureId: expected.id,
        status,
        detail,
      });
    }
  }
  return { records, counts };
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
  if (!Array.isArray(cases) || cases.length === 0)
    fail("scenario must contain at least one case");
  const caseIds = new Set();
  const captureIds = new Set();
  for (const scenarioCase of cases) {
    if (!/^[A-Za-z0-9_-]+$/.test(scenarioCase.id ?? ""))
      fail(`case id is not filename-safe: ${scenarioCase.id}`);
    if (caseIds.has(scenarioCase.id))
      fail(`duplicate case id: ${scenarioCase.id}`);
    caseIds.add(scenarioCase.id);
    const relationship = scenarioCase.relationship ?? "payload";
    if (!caseRelationships.has(relationship))
      fail(`unsupported case relationship: ${relationship}`);
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
      if (
        capture.expectedDiagnostics !== undefined &&
        !Array.isArray(capture.expectedDiagnostics)
      )
        fail(`expectedDiagnostics must be an array: ${capture.id}`);
      if (
        capture.glbProfile !== undefined &&
        !glbProfiles.has(capture.glbProfile)
      )
        fail(`unsupported glbProfile: ${capture.glbProfile}`);
      validateExpectedFailure(capture.expectedFailure, capture.id);
    }
  }
}

function validateExpectedFailure(expectedFailure, captureId) {
  if (expectedFailure === undefined || expectedFailure === null) return;
  if (typeof expectedFailure !== "object" || Array.isArray(expectedFailure))
    fail(`expectedFailure must be an object: ${captureId}`);
  const keys = new Set(["origin", "code", "message", "reason"]);
  for (const key of Object.keys(expectedFailure)) {
    if (!keys.has(key)) fail(`unknown expectedFailure field: ${key}`);
  }
  for (const key of ["origin", "code", "reason"]) {
    if (
      typeof expectedFailure[key] !== "string" ||
      expectedFailure[key].trim() === ""
    )
      fail(`expectedFailure.${key} must be non-empty: ${captureId}`);
  }
  const hasMessage =
    typeof expectedFailure.message === "string" &&
    expectedFailure.message.trim() !== "";
  if (!hasMessage)
    fail(`expectedFailure.message must be non-empty: ${captureId}`);
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

export function verifyVariantRelationships(captures) {
  const byId = new Map(captures.map((capture) => [capture.id, capture]));
  const defaultCapture = byId.get("variant-default");
  const blueCapture = byId.get("variant-blue");
  const resetCapture = byId.get("variant-reset");
  if (!defaultCapture || !blueCapture || !resetCapture) {
    fail(
      "variant scenario needs variant-default, variant-blue, and variant-reset captures",
    );
  }
  const requiredBuffers = [defaultCapture, blueCapture, resetCapture];
  for (const capture of requiredBuffers) {
    if (!capture.glb || !capture.png) {
      fail(`variant capture output is missing: ${capture.id}`);
    }
  }
  if (!Buffer.from(defaultCapture.glb).equals(Buffer.from(resetCapture.glb))) {
    fail("variant-reset GLB must exactly match variant-default GLB");
  }
  if (Buffer.from(defaultCapture.glb).equals(Buffer.from(blueCapture.glb))) {
    fail("variant-blue GLB must differ from variant-default GLB");
  }
  if (!comparePixels(defaultCapture.png, resetCapture.png)) {
    fail(
      "variant-reset PNG pixels must exactly match variant-default PNG pixels",
    );
  }
  if (comparePixels(defaultCapture.png, blueCapture.png)) {
    fail("variant-blue PNG pixels must differ from variant-default PNG pixels");
  }
  const evidence = (capture, meshName, nodeName) => {
    if (
      !Array.isArray(capture.meshes) ||
      !capture.meshes.includes(meshName) ||
      !capture.meshes.includes("/Root/InlineAnchor") ||
      !Array.isArray(capture.nodes) ||
      !capture.nodes.includes(nodeName) ||
      !capture.nodes.includes("InlineAnchor")
    ) {
      fail(`variant ${capture.id} mesh/node evidence is incorrect`);
    }
  };
  evidence(defaultCapture, "/Root/RedQuad", "RedQuad");
  evidence(blueCapture, "/Root/BlueQuad", "BlueQuad");
  evidence(resetCapture, "/Root/RedQuad", "RedQuad");
  if (defaultCapture.glbProfile !== "variant-red") {
    fail("variant-default must use the variant-red GLB profile");
  }
  if (blueCapture.glbProfile !== "variant-blue") {
    fail("variant-blue must use the variant-blue GLB profile");
  }
  if (resetCapture.glbProfile !== "variant-red") {
    fail("variant-reset must use the variant-red GLB profile");
  }
  return {
    relationship: "variant",
    default: "red",
    blue: "blue",
    reset: "red",
  };
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
    rm(path.join(outputDir, "gate-summary.json"), { force: true }),
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
    const glb = await readFile(capture.glbPath);
    if (capture.glbProfile !== undefined) {
      try {
        verifyGlbFeatures(capture.glbProfile, glb);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        fail(`GLB feature verification failed: ${capture.id}: ${detail}`);
      }
    }
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
    capture.glb = glb;
  }
}

export async function updateSnapshots(captures) {
  for (const capture of captures) {
    await mkdir(path.dirname(capture.snapshotPath), { recursive: true });
    await copyFile(capture.pngPath, capture.snapshotPath);
  }
}

async function writeGateSummary(selected, summary, phase = "classified") {
  await writeFile(
    path.join(outputDir, "gate-summary.json"),
    JSON.stringify(
      {
        version: 1,
        phase,
        cases: selected.map((scenarioCase) => scenarioCase.id),
        counts: summary.counts,
        captures: summary.records,
      },
      null,
      2,
    ),
  );
}

export async function runCaptureGate(captures, selected, options, hooks = {}) {
  const blockedCapture = captures.find(
    (capture) => capture.status === "FAIL" || capture.status === "XPASS",
  );
  if (blockedCapture)
    fail(
      `${blockedCapture.status} capture cannot enter the visual capture gate: ${blockedCapture.id}`,
    );
  const renderCaptures = hooks.render ?? render;
  const validate = hooks.validateSnapshots ?? validateSnapshots;
  const update = hooks.updateSnapshots ?? updateSnapshots;
  const verifyRelationships =
    hooks.verifyPayloadRelationships ?? verifyPayloadRelationships;
  const verifyVariants =
    hooks.verifyVariantRelationships ?? verifyVariantRelationships;
  const passingCaptures = captures.filter(
    (capture) => capture.status === "PASS",
  );
  if (passingCaptures.length > 0) {
    await renderCaptures(passingCaptures, options.shotBinary);
    await validate(passingCaptures, options.update);
  }
  for (const scenarioCase of selected) {
    const relationship = scenarioCase.relationship ?? "payload";
    if (relationship === "payload")
      verifyRelationships(
        captures.filter((capture) =>
          scenarioCase.captures.some((item) => item.id === capture.id),
        ),
      );
    if (relationship === "variant")
      verifyVariants(
        captures.filter((capture) =>
          scenarioCase.captures.some((item) => item.id === capture.id),
        ),
      );
  }
  if (options.update) await update(passingCaptures);
  return passingCaptures;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const scenario = await loadScenario();
  validateScenarioCases(scenario.cases);
  const selected = options.caseId
    ? scenario.cases.filter((item) => item.id === options.caseId)
    : scenario.cases;
  if (selected.length === 0) fail(`unknown case: ${options.caseId}`);
  if (options.list) {
    selected.forEach((item) => console.log(item.id));
    return;
  }
  const selectedScenario = { cases: selected };
  await removeOwnedOutputs(selectedScenario);
  const extractorScenario = {
    cases: selected.map((scenarioCase) => ({
      ...scenarioCase,
      stagePath: path.resolve(
        path.dirname(scenarioPath),
        scenarioCase.stagePath,
      ),
      captures: scenarioCase.captures.map((capture) => {
        const extractorCapture = { ...capture };
        delete extractorCapture.glbProfile;
        return extractorCapture;
      }),
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
  const summary = classifyReport(selectedScenario, report);
  await writeGateSummary(selected, summary);
  const issue = summary.records.find(
    (record) => record.status === "FAIL" || record.status === "XPASS",
  );
  if (issue) {
    await writeGateSummary(selected, summary, "failed");
    fail(issue.detail);
  }
  const captures = selected.flatMap((scenarioCase) => {
    const reportCase = report.cases.find((item) => item.id === scenarioCase.id);
    return scenarioCase.captures.map((capture) => {
      const actual = reportCase.captures.find((item) => item.id === capture.id);
      const record = summary.records.find(
        (item) =>
          item.caseId === scenarioCase.id && item.captureId === capture.id,
      );
      return {
        ...actual,
        glbProfile: capture.glbProfile,
        status: record.status,
        pngPath: path.join(outputDir, `${capture.id}.png`),
        snapshotPath: path.join(snapshotDir, `${capture.id}.png`),
      };
    });
  });
  try {
    await runCaptureGate(captures, selected, options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await writeGateSummary(
      selected,
      {
        counts: {
          ...summary.counts,
          FAIL: summary.counts.FAIL + 1,
        },
        records: [
          ...summary.records,
          { caseId: "<gate>", captureId: "<gate>", status: "FAIL", detail },
        ],
      },
      "failed",
    );
    throw error;
  }
  await writeGateSummary(selected, summary, "complete");
  console.log(
    `USD stateful regression passed: ${selected.map((item) => item.id).join(", ")} ` +
      `(PASS=${summary.counts.PASS}, XFAIL=${summary.counts.XFAIL})`,
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
