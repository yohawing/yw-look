import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flipCompare } from "./flip-compare.mjs";
import { comparePixels } from "./pngPixels.mjs";
import { readOption } from "./cliArgs.mjs";
import { runChildProcess } from "./processRunner.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const cases = [
  {
    id: "usda-tiny-sanity",
    input: "samples/assets/usd/tiny.usda",
    snapshot: "tests/visual/snapshots/viewport/usda-tiny-sanity.png",
    actual: "artifacts/screenshots/viewport/usda-tiny-sanity-current.png",
    size: "640x480",
    background: "default",
  },
  {
    id: "usd-tiny-sanity",
    input: "tests/fixtures/models/tiny.usd",
    snapshot: "tests/visual/snapshots/viewport/usd-tiny-sanity.png",
    actual: "artifacts/screenshots/viewport/usd-tiny-sanity-current.png",
    size: "640x480",
    background: "default",
  },
  {
    id: "usdc-tiny-sanity",
    input: "tests/fixtures/models/tiny.usdc",
    snapshot: "tests/visual/snapshots/viewport/usdc-tiny-sanity.png",
    actual: "artifacts/screenshots/viewport/usdc-tiny-sanity-current.png",
    size: "640x480",
    background: "default",
  },
  {
    id: "usdz-tiny-sanity",
    input: "tests/fixtures/models/tiny.usdz",
    snapshot: "tests/visual/snapshots/viewport/usdz-tiny-sanity.png",
    actual: "artifacts/screenshots/viewport/usdz-tiny-sanity-current.png",
    size: "640x480",
    background: "default",
  },
  {
    id: "glb-box-textured",
    input: "samples/assets/glb/BoxTextured.glb",
    snapshot: "tests/visual/snapshots/viewport/glb-box-textured.png",
    actual: "artifacts/screenshots/viewport/glb-box-textured-current.png",
    size: "384x288",
    background: "default",
  },
  {
    id: "obj-tiny-triangle",
    input: "samples/assets/obj/TinyTriangle.obj",
    snapshot: "tests/visual/snapshots/viewport/obj-tiny-triangle.png",
    actual: "artifacts/screenshots/viewport/obj-tiny-triangle-current.png",
    size: "384x288",
    background: "default",
  },
  {
    id: "dae-tiny-tetrahedron",
    input: "samples/assets/dae/TinyTetrahedron.dae",
    snapshot: "tests/visual/snapshots/viewport/dae-tiny-tetrahedron.png",
    actual: "artifacts/screenshots/viewport/dae-tiny-tetrahedron-current.png",
    size: "384x288",
    background: "default",
  },
  {
    id: "stl-tiny-tetrahedron-ascii",
    input: "samples/assets/stl/TinyTetrahedronAscii.stl",
    snapshot: "tests/visual/snapshots/viewport/stl-tiny-tetrahedron-ascii.png",
    actual:
      "artifacts/screenshots/viewport/stl-tiny-tetrahedron-ascii-current.png",
    size: "384x288",
    background: "default",
  },
  {
    id: "fbx-animated-triangle",
    input: "tests/fixtures/models/animated-triangle.fbx",
    snapshot: "tests/visual/snapshots/viewport/fbx-animated-triangle.png",
    actual: "artifacts/screenshots/viewport/fbx-animated-triangle-current.png",
    size: "384x288",
    background: "default",
  },
  {
    id: "gltf-duck",
    input: "samples/assets/gltf/Duck.gltf",
    snapshot: "tests/visual/snapshots/viewport/gltf-duck.png",
    actual: "artifacts/screenshots/viewport/gltf-duck-current.png",
    size: "384x288",
    background: "default",
  },
  {
    id: "ply-triangle",
    input: "tests/fixtures/models/triangle.ply",
    snapshot: "tests/visual/snapshots/viewport/ply-triangle.png",
    actual: "artifacts/screenshots/viewport/ply-triangle-current.png",
    size: "384x288",
    background: "default",
  },
  {
    id: "abc-monkey",
    input: "tests/fixtures/models/monkey.abc",
    snapshot: "tests/visual/snapshots/viewport/abc-monkey.png",
    actual: "artifacts/screenshots/viewport/abc-monkey-current.png",
    size: "384x288",
    background: "default",
  },
];

const usage = `usage:
  npm run test:viewport-snapshot
  npm run test:viewport-snapshot -- --case <id>
  npm run test:viewport-snapshot:update
  UPDATE_SNAPSHOTS=1 npm run test:viewport-snapshot

Options:
  --case <id>          Run one viewport snapshot case.
  --update-snapshot    Replace baselines with the newly rendered PNGs.
  --strict             Use exact PNG byte comparison instead of FLIP.
  --list               Print available cases without running shot CLI.`;

const args = process.argv.slice(2);
const updateSnapshots =
  process.env.UPDATE_SNAPSHOTS === "1" || args.includes("--update-snapshot");
const strictMode = args.includes("--strict");
const listOnly = args.includes("--list");

if (args.includes("--help") || args.includes("-h")) {
  console.log(usage);
  process.exit(0);
}

let selectedCases = cases;
try {
  const selectedCaseId = readOption(args, "--case");
  if (selectedCaseId) {
    selectedCases = cases.filter((testCase) => testCase.id === selectedCaseId);
    if (selectedCases.length === 0) {
      throw new Error(`unknown viewport snapshot case: ${selectedCaseId}`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage);
  process.exit(2);
}

if (listOnly) {
  for (const testCase of selectedCases) {
    console.log(`${testCase.id}: ${testCase.input}`);
  }
  process.exit(0);
}

function resolveRepoPath(repoPath) {
  return path.resolve(repoRoot, repoPath);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function flipErrorMapPath(testCase) {
  return resolveRepoPath(testCase.actual.replace(/\.png$/, "-flip-error.png"));
}

function flipReportPath(testCase) {
  return resolveRepoPath(
    testCase.actual.replace(/\.png$/, "-flip-report.json"),
  );
}

function parseSize(size) {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) {
    throw new Error(`invalid viewport snapshot size: ${size}`);
  }
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

const FLIP_MEAN_THRESHOLD = Number(process.env.FLIP_MEAN_THRESHOLD ?? 0.05);
const FLIP_MAX_THRESHOLD = Number(process.env.FLIP_MAX_THRESHOLD ?? 0.3);

function assertShotProcessResult(result, label) {
  if (result.error?.startsWith("terminated by ")) {
    const signal = result.error.slice("terminated by ".length);
    throw new Error(`${label} was terminated by ${signal}`);
  }
  if (result.error) {
    throw new Error(result.error);
  }
  if (result.exitCode !== 0) {
    throw new Error(`${label} exited with code ${result.exitCode ?? 1}`);
  }
}

async function compareWithFlip(testCase) {
  const reportPath = flipReportPath(testCase);
  const errorMapPath = flipErrorMapPath(testCase);

  const result = await flipCompare({
    reference: resolveRepoPath(testCase.snapshot),
    test: resolveRepoPath(testCase.actual),
    report: reportPath,
    errorMap: errorMapPath,
    meanThreshold: FLIP_MEAN_THRESHOLD,
    maxThreshold: FLIP_MAX_THRESHOLD,
  });

  if (!result.passed) {
    throw new Error(
      [
        `Viewport snapshot FLIP mismatch: ${testCase.id}`,
        `mean=${result.mean.toFixed(4)} (threshold=${FLIP_MEAN_THRESHOLD})`,
        `max=${result.max.toFixed(4)} (threshold=${FLIP_MAX_THRESHOLD})`,
        `p50=${result.p50.toFixed(4)} p75=${result.p75.toFixed(4)}`,
        `error map: ${path.relative(repoRoot, errorMapPath)}`,
        `report:    ${path.relative(repoRoot, reportPath)}`,
      ].join("\n"),
    );
  }

  console.log(
    `Viewport snapshot FLIP passed: ${testCase.id} mean=${result.mean.toFixed(4)}`,
  );
}

async function runShot(testCase) {
  const shotArgs = [
    path.join(repoRoot, "scripts/run-shot.mjs"),
    "shot",
    "--in",
    resolveRepoPath(testCase.input),
    "--out",
    resolveRepoPath(testCase.actual),
    "--size",
    testCase.size,
    "--bg",
    testCase.background,
  ];

  const result = await runChildProcess(process.execPath, shotArgs, {
    cwd: repoRoot,
    env: {
      ...process.env,
      YW_LOOK_CARGO_NO_DEFAULT_FEATURES:
        process.env.YW_LOOK_CARGO_NO_DEFAULT_FEATURES ?? "1",
      YW_LOOK_CARGO_FEATURES:
        process.env.YW_LOOK_CARGO_FEATURES ?? "backend-openusd-rs",
    },
    shell: process.platform === "win32",
    forwardStdout: true,
    forwardStderr: true,
  });

  assertShotProcessResult(result, "shot CLI");
}

async function runShotBatch(testCases) {
  const batch = testCases.map((testCase) => {
    const { width, height } = parseSize(testCase.size);
    return {
      inputPath: resolveRepoPath(testCase.input),
      outputPath: resolveRepoPath(testCase.actual),
      width,
      height,
      background: testCase.background,
    };
  });
  const batchConfigPath = resolveRepoPath(
    "artifacts/screenshots/viewport/shot-batch-config.json",
  );
  await mkdir(path.dirname(batchConfigPath), { recursive: true });
  await writeFile(batchConfigPath, JSON.stringify(batch, null, 2));
  const shotArgs = [
    path.join(repoRoot, "scripts/run-shot.mjs"),
    "shot-batch",
    "--config-file",
    batchConfigPath,
  ];

  const result = await runChildProcess(process.execPath, shotArgs, {
    cwd: repoRoot,
    env: {
      ...process.env,
      YW_LOOK_CARGO_NO_DEFAULT_FEATURES:
        process.env.YW_LOOK_CARGO_NO_DEFAULT_FEATURES ?? "1",
      YW_LOOK_CARGO_FEATURES:
        process.env.YW_LOOK_CARGO_FEATURES ?? "backend-openusd-rs",
    },
    shell: process.platform === "win32",
    forwardStdout: true,
    forwardStderr: true,
  });

  assertShotProcessResult(result, "shot batch");
}

async function compareSnapshot(testCase) {
  const actualPath = resolveRepoPath(testCase.actual);
  const snapshotPath = resolveRepoPath(testCase.snapshot);
  const actualBuffer = await readFile(actualPath);

  if (updateSnapshots) {
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await copyFile(actualPath, snapshotPath);
    console.log(`Updated viewport snapshot: ${testCase.snapshot}`);
    return;
  }

  let expectedBuffer;
  try {
    expectedBuffer = await readFile(snapshotPath);
  } catch {
    throw new Error(
      `Snapshot not found at ${testCase.snapshot}. Run UPDATE_SNAPSHOTS=1 npm run test:viewport-snapshot first.`,
    );
  }

  if (strictMode) {
    if (!comparePixels(actualBuffer, expectedBuffer)) {
      throw new Error(
        [
          `Viewport snapshot mismatch: ${testCase.id}`,
          `expected sha256: ${sha256(expectedBuffer)}`,
          `actual   sha256: ${sha256(actualBuffer)}`,
          `actual image: ${testCase.actual}`,
        ].join("\n"),
      );
    }
    console.log(`Viewport snapshot matched: ${testCase.id}`);
    return;
  }

  await compareWithFlip(testCase);
}

let failed = false;
for (const testCase of selectedCases) {
  try {
    await mkdir(path.dirname(resolveRepoPath(testCase.actual)), {
      recursive: true,
    });
    await rm(resolveRepoPath(testCase.actual), { force: true });
  } catch (error) {
    failed = true;
    console.error(error instanceof Error ? error.message : String(error));
  }
}

if (!failed) {
  try {
    if (selectedCases.length === 1) {
      console.log(`Rendering viewport snapshot: ${selectedCases[0].id}`);
      await runShot(selectedCases[0]);
    } else {
      console.log(`Rendering ${selectedCases.length} viewport snapshots`);
      await runShotBatch(selectedCases);
    }
  } catch (error) {
    failed = true;
    console.error(error instanceof Error ? error.message : String(error));
  }
}

for (const testCase of selectedCases) {
  try {
    if (failed) {
      continue;
    }
    await compareSnapshot(testCase);
  } catch (error) {
    failed = true;
    console.error(error instanceof Error ? error.message : String(error));
  }
}

if (failed) {
  process.exit(1);
}
