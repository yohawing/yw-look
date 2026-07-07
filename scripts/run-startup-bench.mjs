#!/usr/bin/env node
import http from "node:http";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { hasFlag, readOption } from "./cliArgs.mjs";
import { runChildProcess } from "./processRunner.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const shotScriptPath = path.join(repoRoot, "scripts", "run-shot.mjs");
const shotOutcomePrefix = "YW_LOOK_SHOT_OUTCOME:";
const packagedAppResultFile = "startup-bench-app-result.json";
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
const devHost = "127.0.0.1";
const devPort = 1420;
const playwrightViewport = { width: 1024, height: 768 };

const measurementScopeCaveats = {
  shot:
    "Dev Tauri shot-startup smoke only. This benchmark launches via scripts/run-shot.mjs, " +
    "which may start the Vite dev server, compile or launch cargo, and run the shot render path. " +
    "It is not a packaged application cold-start measurement.",
  playwright:
    "Playwright dev app-shell first-render only. This benchmark starts or reuses the local Vite " +
    "dev server, opens the normal app page in headless Chromium, and measures wall-clock time until " +
    ".app-shell is visible. Browser navigation and paint timings are collected from the Performance API. " +
    "It is not a packaged Tauri cold-start measurement.",
  packaged:
    "Packaged/release first-render measurement. This benchmark launches a built application executable, " +
    "waits for the normal app shell first render inside the packaged WebView, and records wall-clock " +
    "elapsed from process launch plus frontend Performance API metrics. It is not a Vite dev server or " +
    "cargo-run measurement.",
};

const args = process.argv.slice(2);
if (hasFlag(args, "--help") || hasFlag(args, "-h")) {
  console.log(`Usage: node scripts/run-startup-bench.mjs [options]

Measure startup timing for the Tauri shot path and/or the Playwright app-shell first render.

Options:
  --surface <name>     Measurement surface: shot, playwright, packaged, or both (default: shot)
  --iterations <n>     Number of runs per selected surface (default: 1)
  --input <path>       Model input path for shot runs (default: tests/fixtures/models/triangle.gltf)
  --app <path>         Packaged executable for packaged runs (default: platform release binary)
  --output-dir <path>  Report directory (default: artifacts/logs/startup-bench-<stamp>)
  --timeout-ms <n>     Per-iteration timeout in ms (default: 600000)
  --json <path>        Explicit JSON report path (Markdown is written beside it)

Outputs:
  artifacts/logs/startup-bench-*/startup-bench-report.{json,md}
  artifacts/screenshots/startup-bench/{iteration,playwright-iteration}-*.png
  artifacts/logs/startup-bench-*/packaged-iteration-*/startup-bench-app-result.json

Scope:
  shot: ${measurementScopeCaveats.shot}
  playwright: ${measurementScopeCaveats.playwright}
  packaged: ${measurementScopeCaveats.packaged}`);
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

function parseSurface(value) {
  if (!value || value === "shot") {
    return ["shot"];
  }
  if (value === "playwright") {
    return ["playwright"];
  }
  if (value === "packaged") {
    return ["packaged"];
  }
  if (value === "both") {
    return ["shot", "playwright"];
  }
  throw new Error("--surface must be one of: shot, playwright, packaged, both");
}

function defaultPackagedAppPath() {
  if (process.platform === "win32") {
    return path.join(repoRoot, "src-tauri", "target", "release", "yw-look.exe");
  }
  if (process.platform === "darwin") {
    return path.join(repoRoot, "src-tauri", "target", "release", "yw-look");
  }
  return path.join(repoRoot, "src-tauri", "target", "release", "yw-look");
}

async function assertPackagedAppExists(appPath) {
  try {
    await access(appPath);
  } catch {
    throw new Error(
      `packaged app executable not found: ${toRepoRelative(appPath)}. ` +
        "Build a release binary first or pass --app <path>.",
    );
  }
}

function packagedIterationOutDir(outputDir, iteration) {
  return path.join(
    outputDir,
    `packaged-iteration-${String(iteration).padStart(3, "0")}`,
  );
}

function packagedAppResultPath(iterationOutDir) {
  return path.join(iterationOutDir, packagedAppResultFile);
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

function shotIterationScreenshotPath(iteration) {
  return path.join(
    defaultScreenshotDir,
    `iteration-${String(iteration).padStart(3, "0")}.png`,
  );
}

function playwrightIterationScreenshotPath(iteration) {
  return path.join(
    defaultScreenshotDir,
    `playwright-iteration-${String(iteration).padStart(3, "0")}.png`,
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

function evaluateShotIteration(result, shotOutcome) {
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

function appUrl() {
  return `http://${devHost}:${devPort}/`;
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
    stdio: "ignore",
    shell: process.platform === "win32",
  });
}

async function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

async function collectBrowserMetrics(page) {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] ?? null;
    const paints = performance.getEntriesByType("paint");
    const firstPaint = paints.find((entry) => entry.name === "first-paint");
    const firstContentfulPaint = paints.find(
      (entry) => entry.name === "first-contentful-paint",
    );

    return {
      domContentLoadedEventEnd: navigation?.domContentLoadedEventEnd ?? null,
      loadEventEnd: navigation?.loadEventEnd ?? null,
      responseEnd: navigation?.responseEnd ?? null,
      domInteractive: navigation?.domInteractive ?? null,
      firstPaintMs: firstPaint?.startTime ?? null,
      firstContentfulPaintMs: firstContentfulPaint?.startTime ?? null,
      paintEntries: paints.map((entry) => ({
        name: entry.name,
        startTimeMs: entry.startTime,
      })),
    };
  });
}

async function waitForAppShellReady(page, timeoutMs) {
  await page.locator(".app-shell").waitFor({
    state: "visible",
    timeout: timeoutMs,
  });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        globalThis.requestAnimationFrame(() => {
          globalThis.requestAnimationFrame(() => resolve());
        });
      }),
  );
}

async function measurePlaywrightAppShell(page, url, timeoutMs) {
  const wallStart = Date.now();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitForAppShellReady(page, timeoutMs);
    const wallClockMs = Date.now() - wallStart;
    const browserMetrics = await collectBrowserMetrics(page);
    return { ok: true, reason: null, wallClockMs, browserMetrics };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      wallClockMs: Date.now() - wallStart,
      browserMetrics: null,
    };
  }
}

async function runShotIterations({ iterations, inputPath, timeoutMs }) {
  const iterationResults = [];

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const screenshotPath = shotIterationScreenshotPath(iteration);
    const command = buildShotCommand(inputPath, screenshotPath);
    console.log(
      `[startup-bench:shot] iteration ${iteration}/${iterations}: ${toRepoRelative(inputPath)}`,
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
    const verdict = evaluateShotIteration(result, shotOutcome);

    iterationResults.push({
      surface: "shot",
      iteration,
      ok: verdict.ok,
      reason: verdict.reason,
      wallClockMs: result.durationMs,
      exitCode: result.exitCode,
      command: command.map((token) =>
        token.includes(" ") ? `"${token}"` : token,
      ),
      url: null,
      inputPath: toRepoRelative(inputPath),
      outputScreenshotPath: toRepoRelative(screenshotPath),
      shotOutcome,
      browserMetrics: null,
      stdoutTail: tail(result.stdout),
      stderrTail: tail(result.stderr),
    });

    console.log(
      `[startup-bench:shot] iteration ${iteration}: ${verdict.ok ? "pass" : "fail"} wall=${result.durationMs}ms loadTimeMs=${shotOutcome?.loadTimeMs ?? "n/a"}`,
    );
    if (!verdict.ok) {
      console.error(`[startup-bench:shot] failure: ${verdict.reason}`);
    }
  }

  return iterationResults;
}

async function runPlaywrightIterations({ iterations, timeoutMs }) {
  const url = appUrl();
  const iterationResults = [];
  const reuseDevServer = await probeUrl(url);
  const devServer = reuseDevServer ? null : startDevServer();

  try {
    await waitForUrl(url, 60_000, devServer);

    const browser = await chromium.launch({ headless: true });
    try {
      for (let iteration = 1; iteration <= iterations; iteration += 1) {
        const screenshotPath = playwrightIterationScreenshotPath(iteration);
        console.log(
          `[startup-bench:playwright] iteration ${iteration}/${iterations}: ${url}`,
        );

        const page = await browser.newPage({ viewport: playwrightViewport });
        let verdict;
        try {
          verdict = await measurePlaywrightAppShell(page, url, timeoutMs);
          if (verdict.ok) {
            await page
              .locator(".app-shell")
              .screenshot({ path: screenshotPath });
          }
        } finally {
          await page.close();
        }

        iterationResults.push({
          surface: "playwright",
          iteration,
          ok: verdict.ok,
          reason: verdict.reason,
          wallClockMs: verdict.wallClockMs,
          exitCode: verdict.ok ? 0 : 1,
          command: null,
          url,
          inputPath: null,
          outputScreenshotPath: verdict.ok
            ? toRepoRelative(screenshotPath)
            : null,
          shotOutcome: null,
          browserMetrics: verdict.browserMetrics,
          stdoutTail: null,
          stderrTail: null,
        });

        console.log(
          `[startup-bench:playwright] iteration ${iteration}: ${verdict.ok ? "pass" : "fail"} wall=${verdict.wallClockMs}ms fcp=${verdict.browserMetrics?.firstContentfulPaintMs ?? "n/a"}`,
        );
        if (!verdict.ok) {
          console.error(
            `[startup-bench:playwright] failure: ${verdict.reason}`,
          );
        }
      }
    } finally {
      try {
        await withTimeout(browser.close(), 10_000, "browser.close");
      } catch (error) {
        console.error(
          `[startup-bench:playwright] cleanup warning: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  } finally {
    if (devServer) {
      try {
        await withTimeout(stopDevServer(devServer), 10_000, "stopDevServer");
      } catch (error) {
        console.error(
          `[startup-bench:playwright] cleanup warning: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  return iterationResults;
}

async function readPackagedAppResult(iterationOutDir) {
  try {
    const raw = await readFile(packagedAppResultPath(iterationOutDir), "utf8");
    return JSON.parse(raw);
  } catch (error) {
    return {
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function evaluatePackagedIteration(result, appResult) {
  if (result.error) {
    return { ok: false, reason: result.error };
  }
  if (result.exitCode !== 0) {
    return {
      ok: false,
      reason: `packaged app exited with code ${result.exitCode ?? 1}`,
    };
  }
  if (!appResult || appResult.parseError) {
    return {
      ok: false,
      reason: appResult?.parseError
        ? `invalid packaged app result JSON: ${appResult.parseError}`
        : "missing startup-bench-app-result.json",
    };
  }
  return { ok: true, reason: null };
}

async function runPackagedIterations({
  iterations,
  appPath,
  timeoutMs,
  outputDir,
}) {
  await assertPackagedAppExists(appPath);
  const iterationResults = [];

  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const iterationOutDir = packagedIterationOutDir(outputDir, iteration);
    await mkdir(iterationOutDir, { recursive: true });
    const command = [
      appPath,
      "--startup-bench",
      "--startup-bench-out",
      iterationOutDir,
      "--startup-bench-node-version",
      process.version,
    ];
    console.log(
      `[startup-bench:packaged] iteration ${iteration}/${iterations}: ${toRepoRelative(appPath)}`,
    );

    const wallStart = Date.now();
    const result = await runChildProcess(command[0], command.slice(1), {
      cwd: repoRoot,
      shell: false,
      timeoutMs,
      forwardStdout: true,
      forwardStderr: true,
      signalError: false,
    });
    const wallClockMs = Date.now() - wallStart;
    const appResult = await readPackagedAppResult(iterationOutDir);
    const verdict = evaluatePackagedIteration(result, appResult);

    iterationResults.push({
      surface: "packaged",
      iteration,
      ok: verdict.ok,
      reason: verdict.reason,
      wallClockMs,
      exitCode: result.exitCode,
      command: command.map((token) =>
        token.includes(" ") ? `"${token}"` : token,
      ),
      url: null,
      inputPath: null,
      appPath: toRepoRelative(appPath),
      outputDir: toRepoRelative(iterationOutDir),
      outputResultPath: verdict.ok
        ? toRepoRelative(packagedAppResultPath(iterationOutDir))
        : null,
      outputScreenshotPath: null,
      shotOutcome: null,
      appResult: verdict.ok ? appResult : null,
      browserMetrics: verdict.ok ? (appResult.browserMetrics ?? null) : null,
      stdoutTail: tail(result.stdout),
      stderrTail: tail(result.stderr),
    });

    console.log(
      `[startup-bench:packaged] iteration ${iteration}: ${verdict.ok ? "pass" : "fail"} wall=${wallClockMs}ms performanceNow=${appResult?.performanceNowMs ?? "n/a"}`,
    );
    if (!verdict.ok) {
      console.error(`[startup-bench:packaged] failure: ${verdict.reason}`);
    }
  }

  return iterationResults;
}

function buildSummary(iterationResults) {
  const passedIterations = iterationResults.filter((entry) => entry.ok);
  const failedIterations = iterationResults.filter((entry) => !entry.ok);
  const shotIterations = iterationResults.filter(
    (entry) => entry.surface === "shot",
  );
  const playwrightIterations = iterationResults.filter(
    (entry) => entry.surface === "playwright",
  );
  const packagedIterations = iterationResults.filter(
    (entry) => entry.surface === "packaged",
  );
  const passedShot = shotIterations.filter((entry) => entry.ok);
  const passedPlaywright = playwrightIterations.filter((entry) => entry.ok);
  const passedPackaged = packagedIterations.filter((entry) => entry.ok);

  return {
    total: iterationResults.length,
    passed: passedIterations.length,
    failed: failedIterations.length,
    wallClockMs: summarizeNumbers(
      passedIterations.map((entry) => entry.wallClockMs),
    ),
    loadTimeMs: summarizeNumbers(
      passedShot
        .map((entry) => entry.shotOutcome?.loadTimeMs)
        .filter((value) => typeof value === "number"),
    ),
    firstContentfulPaintMs: summarizeNumbers(
      passedPlaywright
        .map((entry) => entry.browserMetrics?.firstContentfulPaintMs)
        .filter((value) => typeof value === "number"),
    ),
    firstPaintMs: summarizeNumbers(
      passedPlaywright
        .map((entry) => entry.browserMetrics?.firstPaintMs)
        .filter((value) => typeof value === "number"),
    ),
    performanceNowMs: summarizeNumbers(
      passedPackaged
        .map((entry) => entry.appResult?.performanceNowMs)
        .filter((value) => typeof value === "number"),
    ),
    bySurface: {
      shot: {
        total: shotIterations.length,
        passed: passedShot.length,
        failed: shotIterations.length - passedShot.length,
        wallClockMs: summarizeNumbers(
          passedShot.map((entry) => entry.wallClockMs),
        ),
        loadTimeMs: summarizeNumbers(
          passedShot
            .map((entry) => entry.shotOutcome?.loadTimeMs)
            .filter((value) => typeof value === "number"),
        ),
      },
      playwright: {
        total: playwrightIterations.length,
        passed: passedPlaywright.length,
        failed: playwrightIterations.length - passedPlaywright.length,
        wallClockMs: summarizeNumbers(
          passedPlaywright.map((entry) => entry.wallClockMs),
        ),
        firstContentfulPaintMs: summarizeNumbers(
          passedPlaywright
            .map((entry) => entry.browserMetrics?.firstContentfulPaintMs)
            .filter((value) => typeof value === "number"),
        ),
        firstPaintMs: summarizeNumbers(
          passedPlaywright
            .map((entry) => entry.browserMetrics?.firstPaintMs)
            .filter((value) => typeof value === "number"),
        ),
      },
      packaged: {
        total: packagedIterations.length,
        passed: passedPackaged.length,
        failed: packagedIterations.length - passedPackaged.length,
        wallClockMs: summarizeNumbers(
          passedPackaged.map((entry) => entry.wallClockMs),
        ),
        performanceNowMs: summarizeNumbers(
          passedPackaged
            .map((entry) => entry.appResult?.performanceNowMs)
            .filter((value) => typeof value === "number"),
        ),
        firstContentfulPaintMs: summarizeNumbers(
          passedPackaged
            .map((entry) => entry.browserMetrics?.firstContentfulPaintMs)
            .filter((value) => typeof value === "number"),
        ),
        firstPaintMs: summarizeNumbers(
          passedPackaged
            .map((entry) => entry.browserMetrics?.firstPaintMs)
            .filter((value) => typeof value === "number"),
        ),
      },
    },
  };
}

function primaryMeasurementScopeCaveat(surfacesRun) {
  if (surfacesRun.length === 1) {
    return measurementScopeCaveats[surfacesRun[0]];
  }
  return surfacesRun
    .map((surface) => `${surface}: ${measurementScopeCaveats[surface]}`)
    .join(" ");
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
    `- Surfaces: ${report.surfacesRun.join(", ")}`,
  ];

  if (report.inputPath) {
    lines.push(`- Shot input: \`${report.inputPath}\``);
  }
  if (report.appUrl) {
    lines.push(`- Playwright app URL: \`${report.appUrl}\``);
  }
  if (report.packagedAppPath) {
    lines.push(`- Packaged app executable: \`${report.packagedAppPath}\``);
  }

  lines.push(
    `- Iterations requested per surface: ${report.iterationsRequested}`,
    `- Timeout per iteration: ${report.timeoutMs}ms`,
    "",
    "## Summary",
    "",
    `- Passed: ${report.summary.passed}/${report.summary.total}`,
    `- Failed: ${report.summary.failed}`,
    `- Wall-clock ms: min=${report.summary.wallClockMs.min ?? "n/a"}, max=${report.summary.wallClockMs.max ?? "n/a"}, mean=${report.summary.wallClockMs.mean ?? "n/a"}`,
  );

  if (report.surfacesRun.includes("shot")) {
    lines.push(
      `- Shot loadTimeMs: min=${report.summary.loadTimeMs.min ?? "n/a"}, max=${report.summary.loadTimeMs.max ?? "n/a"}, mean=${report.summary.loadTimeMs.mean ?? "n/a"}`,
    );
  }
  if (report.surfacesRun.includes("playwright")) {
    lines.push(
      `- Playwright FCP ms: min=${report.summary.firstContentfulPaintMs.min ?? "n/a"}, max=${report.summary.firstContentfulPaintMs.max ?? "n/a"}, mean=${report.summary.firstContentfulPaintMs.mean ?? "n/a"}`,
      `- Playwright first paint ms: min=${report.summary.firstPaintMs.min ?? "n/a"}, max=${report.summary.firstPaintMs.max ?? "n/a"}, mean=${report.summary.firstPaintMs.mean ?? "n/a"}`,
    );
  }
  if (report.surfacesRun.includes("packaged")) {
    lines.push(
      `- Packaged/release first-render wall-clock ms: min=${report.summary.bySurface.packaged.wallClockMs.min ?? "n/a"}, max=${report.summary.bySurface.packaged.wallClockMs.max ?? "n/a"}, mean=${report.summary.bySurface.packaged.wallClockMs.mean ?? "n/a"}`,
      `- Packaged performance.now ms: min=${report.summary.bySurface.packaged.performanceNowMs.min ?? "n/a"}, max=${report.summary.bySurface.packaged.performanceNowMs.max ?? "n/a"}, mean=${report.summary.bySurface.packaged.performanceNowMs.mean ?? "n/a"}`,
      `- Packaged FCP ms: min=${report.summary.bySurface.packaged.firstContentfulPaintMs.min ?? "n/a"}, max=${report.summary.bySurface.packaged.firstContentfulPaintMs.max ?? "n/a"}, mean=${report.summary.bySurface.packaged.firstContentfulPaintMs.mean ?? "n/a"}`,
      `- Packaged first paint ms: min=${report.summary.bySurface.packaged.firstPaintMs.min ?? "n/a"}, max=${report.summary.bySurface.packaged.firstPaintMs.max ?? "n/a"}, mean=${report.summary.bySurface.packaged.firstPaintMs.mean ?? "n/a"}`,
    );
  }

  lines.push(
    "",
    "## Iterations",
    "",
    "| Surface | Iteration | Wall ms | loadTimeMs | performance.now ms | FCP ms | First paint ms | Exit | Result | Artifact |",
    "| ------- | --------- | ------- | ---------- | ------------------ | ------ | -------------- | ---- | ------ | -------- |",
  );

  for (const iteration of report.iterations) {
    lines.push(
      `| ${[
        iteration.surface,
        iteration.iteration,
        iteration.wallClockMs,
        iteration.shotOutcome?.loadTimeMs ?? "n/a",
        iteration.appResult?.performanceNowMs ?? "n/a",
        iteration.browserMetrics?.firstContentfulPaintMs ?? "n/a",
        iteration.browserMetrics?.firstPaintMs ?? "n/a",
        iteration.exitCode ?? "null",
        iteration.ok ? "pass" : `fail (${iteration.reason})`,
        iteration.outputScreenshotPath
          ? `\`${iteration.outputScreenshotPath}\``
          : iteration.outputResultPath
            ? `\`${iteration.outputResultPath}\``
            : "n/a",
      ].join(" | ")} |`,
    );
  }

  lines.push("", "## Commands and URLs", "");
  for (const iteration of report.iterations) {
    if (iteration.command) {
      lines.push(
        `${iteration.surface} ${iteration.iteration}. \`${iteration.command.join(" ")}\``,
      );
      continue;
    }
    lines.push(
      `${iteration.surface} ${iteration.iteration}. \`${iteration.url}\``,
    );
  }

  const browserMetricIterations = report.iterations.filter(
    (entry) =>
      (entry.surface === "playwright" || entry.surface === "packaged") &&
      entry.browserMetrics,
  );
  if (browserMetricIterations.length > 0) {
    lines.push("", "## Browser metrics", "");
    for (const iteration of browserMetricIterations) {
      const metrics = iteration.browserMetrics;
      lines.push(
        `${iteration.surface} ${iteration.iteration}.`,
        `- domContentLoadedEventEnd: ${metrics.domContentLoadedEventEnd ?? "n/a"} ms`,
        `- loadEventEnd: ${metrics.loadEventEnd ?? "n/a"} ms`,
        `- responseEnd: ${metrics.responseEnd ?? "n/a"} ms`,
        `- domInteractive: ${metrics.domInteractive ?? "n/a"} ms`,
        `- firstPaintMs: ${metrics.firstPaintMs ?? "n/a"}`,
        `- firstContentfulPaintMs: ${metrics.firstContentfulPaintMs ?? "n/a"}`,
        "",
      );
    }
  }

  const packagedIterations = report.iterations.filter(
    (entry) => entry.surface === "packaged" && entry.appResult,
  );
  if (packagedIterations.length > 0) {
    lines.push("", "## Packaged app results", "");
    for (const iteration of packagedIterations) {
      const appResult = iteration.appResult;
      lines.push(
        `${iteration.surface} ${iteration.iteration}.`,
        `- appVersion: ${appResult.appVersion ?? "n/a"}`,
        `- os/arch: ${appResult.os ?? "n/a"}/${appResult.arch ?? "n/a"}`,
        `- processId: ${appResult.processId ?? "n/a"}`,
        `- mode: ${appResult.mode ?? "n/a"}`,
        `- packaged: ${appResult.packaged === true ? "true" : "false"}`,
        `- finishedAt: ${appResult.finishedAt ?? "n/a"}`,
        "",
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

const surfacesRun = parseSurface(readOption(args, "--surface") ?? "shot");
const packagedAppPath = path.resolve(
  repoRoot,
  readOption(args, "--app") ?? defaultPackagedAppPath(),
);
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

if (surfacesRun.includes("shot")) {
  iterationResults.push(
    ...(await runShotIterations({
      iterations,
      inputPath,
      timeoutMs,
    })),
  );
}

if (surfacesRun.includes("playwright")) {
  iterationResults.push(
    ...(await runPlaywrightIterations({
      iterations,
      timeoutMs,
    })),
  );
}

if (surfacesRun.includes("packaged")) {
  iterationResults.push(
    ...(await runPackagedIterations({
      iterations,
      appPath: packagedAppPath,
      timeoutMs,
      outputDir,
    })),
  );
}

const failedIterations = iterationResults.filter((entry) => !entry.ok);
const report = {
  generatedAt: new Date().toISOString(),
  surfacesRun,
  measurementScopeCaveat: primaryMeasurementScopeCaveat(surfacesRun),
  measurementScopeCaveats,
  nodeVersion: process.version,
  platform: process.platform,
  inputPath: surfacesRun.includes("shot") ? toRepoRelative(inputPath) : null,
  appUrl: surfacesRun.includes("playwright") ? appUrl() : null,
  packagedAppPath: surfacesRun.includes("packaged")
    ? toRepoRelative(packagedAppPath)
    : null,
  outputDir: toRepoRelative(outputDir),
  screenshotDir: toRepoRelative(defaultScreenshotDir),
  iterationsRequested: iterations,
  timeoutMs,
  summary: buildSummary(iterationResults),
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
