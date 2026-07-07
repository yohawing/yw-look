import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { flipCompare } from "./flip-compare.mjs";
import { comparePixels } from "./pngPixels.mjs";
import { readOption } from "./cliArgs.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const devHost = "127.0.0.1";
const devPort = 1420;
const viewport = { width: 1024, height: 768 };

const cases = [
  {
    id: "empty",
    state: "empty",
    snapshot: "tests/visual/snapshots/viewport-state/empty.png",
    actual: "artifacts/screenshots/viewport-state/empty-current.png",
  },
  {
    id: "loading",
    state: "loading",
    snapshot: "tests/visual/snapshots/viewport-state/loading.png",
    actual: "artifacts/screenshots/viewport-state/loading-current.png",
  },
  {
    id: "error",
    state: "error",
    snapshot: "tests/visual/snapshots/viewport-state/error.png",
    actual: "artifacts/screenshots/viewport-state/error-current.png",
  },
];

const usage = `usage:
  npm run test:viewport-state-snapshot
  npm run test:viewport-state-snapshot -- --case <id>
  npm run test:viewport-state-snapshot:update
  UPDATE_SNAPSHOTS=1 npm run test:viewport-state-snapshot

Options:
  --case <id>          Run one viewport state snapshot case.
  --update-snapshot    Replace baselines with the newly rendered PNGs.
  --strict             Use exact PNG byte comparison instead of FLIP.
  --list               Print available cases without capturing screenshots.`;

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
      throw new Error(
        `unknown viewport state snapshot case: ${selectedCaseId}`,
      );
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage);
  process.exit(2);
}

if (listOnly) {
  for (const testCase of selectedCases) {
    console.log(`${testCase.id}: state=${testCase.state}`);
  }
  process.exit(0);
}

function resolveRepoPath(repoPath) {
  return path.resolve(repoRoot, repoPath);
}

function snapshotUrl(testCase) {
  return `http://${devHost}:${devPort}/?entry=viewport-state-snapshot&state=${testCase.state}`;
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

const FLIP_MEAN_THRESHOLD = Number(process.env.FLIP_MEAN_THRESHOLD ?? 0.05);
const FLIP_MAX_THRESHOLD = Number(process.env.FLIP_MAX_THRESHOLD ?? 0.3);

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

async function waitForUrl(url, timeoutMs = 60_000, serverProcess = null) {
  const startedAt = Date.now();
  let serverExit = null;
  const onServerExit = (code, signal) => {
    const reason =
      signal ?? (code === null ? "unknown status" : `exit ${code}`);
    serverExit = new Error(`dev server exited before ready: ${reason}`);
  };
  serverProcess?.once("exit", onServerExit);

  while (Date.now() - startedAt <= timeoutMs) {
    if (serverExit) throw serverExit;
    if (await probeUrl(url)) {
      serverProcess?.off("exit", onServerExit);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  serverProcess?.off("exit", onServerExit);
  throw new Error(`dev server did not become ready: ${url}`);
}

function startDevServer() {
  return spawn("npm", ["run", "dev", "--", "--host", devHost], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function stopDevServer(devServer) {
  if (!devServer || devServer.killed) return Promise.resolve();
  if (process.platform === "win32" && devServer.pid) {
    return new Promise((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/pid", String(devServer.pid), "/T", "/F"],
        {
          stdio: "ignore",
          shell: false,
          windowsHide: true,
        },
      );
      const timer = setTimeout(resolve, 5_000);
      const finish = () => {
        clearTimeout(timer);
        resolve();
      };
      killer.once("exit", finish);
      killer.once("error", finish);
    });
  }
  devServer.kill();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    devServer.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
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
        `Viewport state snapshot FLIP mismatch: ${testCase.id}`,
        `mean=${result.mean.toFixed(4)} (threshold=${FLIP_MEAN_THRESHOLD})`,
        `max=${result.max.toFixed(4)} (threshold=${FLIP_MAX_THRESHOLD})`,
        `p50=${result.p50.toFixed(4)} p75=${result.p75.toFixed(4)}`,
        `error map: ${path.relative(repoRoot, errorMapPath)}`,
        `report:    ${path.relative(repoRoot, reportPath)}`,
      ].join("\n"),
    );
  }

  console.log(
    `Viewport state snapshot FLIP passed: ${testCase.id} mean=${result.mean.toFixed(4)}`,
  );
}

async function compareSnapshot(testCase) {
  const actualPath = resolveRepoPath(testCase.actual);
  const snapshotPath = resolveRepoPath(testCase.snapshot);
  const actualBuffer = await readFile(actualPath);

  if (updateSnapshots) {
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await copyFile(actualPath, snapshotPath);
    console.log(`Updated viewport state snapshot: ${testCase.snapshot}`);
    return;
  }

  let expectedBuffer;
  try {
    expectedBuffer = await readFile(snapshotPath);
  } catch {
    throw new Error(
      `Snapshot not found at ${testCase.snapshot}. Run UPDATE_SNAPSHOTS=1 npm run test:viewport-state-snapshot first.`,
    );
  }

  if (strictMode) {
    if (!comparePixels(actualBuffer, expectedBuffer)) {
      throw new Error(
        [
          `Viewport state snapshot mismatch: ${testCase.id}`,
          `expected sha256: ${sha256(expectedBuffer)}`,
          `actual   sha256: ${sha256(actualBuffer)}`,
          `actual image: ${testCase.actual}`,
        ].join("\n"),
      );
    }
    console.log(`Viewport state snapshot matched: ${testCase.id}`);
    return;
  }

  await compareWithFlip(testCase);
}

async function captureSnapshots(testCases) {
  const probeTarget = snapshotUrl(testCases[0]);
  const reuseDevServer = await probeUrl(probeTarget);
  const devServer = reuseDevServer ? null : startDevServer();

  try {
    await waitForUrl(probeTarget, 60_000, devServer);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport });
      for (const testCase of testCases) {
        const actualPath = resolveRepoPath(testCase.actual);
        await mkdir(path.dirname(actualPath), { recursive: true });
        await rm(actualPath, { force: true });

        console.log(`Rendering viewport state snapshot: ${testCase.id}`);
        await page.goto(snapshotUrl(testCase), { waitUntil: "networkidle" });
        await page.waitForFunction(
          (expectedState) =>
            document.documentElement.dataset.viewportStateSnapshotReady ===
            expectedState,
          testCase.state,
          { timeout: 15_000 },
        );
        await page.evaluate(() => document.fonts.ready);
        const harness = page.locator(".viewport-state-snapshot-harness");
        await harness.screenshot({ path: actualPath });
      }
    } finally {
      await browser.close();
    }
  } finally {
    await stopDevServer(devServer);
  }
}

let failed = false;

try {
  await captureSnapshots(selectedCases);
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : String(error));
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
