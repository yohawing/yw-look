#!/usr/bin/env node
/* global window, document */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  sha256,
  sourceFingerprint,
  validateCapture,
} from "./readme-screenshot-contract.mjs";
import { runChildProcess } from "./processRunner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
  await fs.readFile(path.join(root, "scripts/readme-screenshot.json")),
);
const version = JSON.parse(
  await fs.readFile(path.join(root, "package.json")),
).version;
const imagePath = path.join(root, "docs/images/hero.png");
const manifestPath = path.join(root, "docs/images/hero.capture.json");
const args = process.argv.slice(2);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function check() {
  const manifest = JSON.parse(await fs.readFile(manifestPath));
  validateCapture({
    manifest,
    config,
    version,
    fingerprint: sourceFingerprint(root),
    png: await fs.readFile(imagePath),
  });
  const readme = await fs.readFile(path.join(root, "README.md"), "utf8");
  if (!readme.includes("(docs/images/hero.png)"))
    throw new Error("README does not reference the captured image.");
  console.log("README screenshot gate passed.");
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function capture() {
  if (process.platform !== "win32")
    throw new Error(
      "Capture requires Windows + WebView2; --check is cross-platform.",
    );
  const modelPath = path.join(root, config.model);
  if (sha256(await fs.readFile(modelPath)) !== config.modelSha256)
    throw new Error("Capture model SHA256 mismatch.");
  const fingerprint = sourceFingerprint(root);
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "yw-look-readme-"));
  // A separate identity gives native settings/recent files a fresh, isolated home.
  const identifier = `com.yohawing.ywlook.capture-${randomUUID()}`;
  const tauriConfig = path.join(work, "tauri.capture.json");
  await fs.writeFile(
    tauriConfig,
    JSON.stringify({
      identifier,
      app: {
        windows: [
          {
            label: "main",
            title: "yw-look",
            width: config.width,
            height: config.height,
            visible: false,
            decorations: false,
          },
        ],
      },
      bundle: { createUpdaterArtifacts: false },
    }),
  );
  console.log("Building current production UI for README capture...");
  const build = await runChildProcess(
    process.execPath,
    [
      path.join(root, "node_modules/@tauri-apps/cli/tauri.js"),
      "build",
      "--no-bundle",
      "--config",
      tauriConfig,
    ],
    { cwd: root, timeoutMs: 600_000, windowsHide: true },
  );
  await fs.mkdir(path.join(root, "artifacts/logs"), { recursive: true });
  await fs.writeFile(
    path.join(root, "artifacts/logs/readme-screenshot-build.log"),
    build.stdout + build.stderr,
  );
  if (build.exitCode !== 0)
    throw new Error(
      "Capture build failed; see artifacts/logs/readme-screenshot-build.log",
    );
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--no-deps",
        "--format-version",
        "1",
        "--manifest-path",
        "src-tauri/Cargo.toml",
      ],
      { cwd: root, encoding: "utf8" },
    ),
  );
  const executable = path.join(
    metadata.target_directory,
    "release/yw-look.exe",
  );
  const port = await freePort();
  const child = spawn(executable, [], {
    cwd: root,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: path.join(work, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
  });
  let launchError;
  child.on("error", (error) => {
    launchError = error;
  });
  let browser;
  try {
    const { chromium } = await import("playwright");
    const endpoint = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (launchError) throw launchError;
      if (child.exitCode !== null)
        throw new Error("Capture app exited before connecting.");
      try {
        browser = await chromium.connectOverCDP(endpoint, { timeout: 1000 });
        break;
      } catch {
        await delay(300);
      }
    }
    if (!browser) throw new Error("Native WebView2 connection timed out.");
    const page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(60_000);
    await page.waitForURL("http://tauri.localhost/**");
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: config.width,
      height: config.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.locator(".app-statusbar").waitFor();
    await page.evaluate(
      (file) =>
        window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
          event: "tauri://drag-drop",
          payload: { paths: [file], position: { x: 200, y: 200 } },
        }),
      modelPath,
    );
    await page.waitForFunction(
      (name) =>
        document
          .querySelector(".app-statusbar")
          ?.textContent?.includes(`Model loaded: ${name}`) &&
        document.querySelector(".viewport-canvas canvas") &&
        !document.querySelector(".viewport-overlay"),
      path.basename(modelPath),
    );
    const pause = page.getByRole("button", { name: "Pause", exact: true });
    if (await pause.count()) await pause.click();
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Control+ArrowLeft");
    await page.keyboard.press("r");
    await page.keyboard.press("Home");
    await delay(500);
    const canvas = page.locator(".viewport-canvas canvas");
    const box = await canvas.boundingBox();
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(
      x + box.width * config.orbit.dx,
      y + box.height * config.orbit.dy,
      { steps: 30 },
    );
    await page.mouse.up();
    await page.mouse.wheel(0, config.zoomWheel);
    await page.mouse.move(x, y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(
      x + box.width * config.pan.dx,
      y + box.height * config.pan.dy,
      { steps: 20 },
    );
    await page.mouse.up({ button: "middle" });
    await page.mouse.move(config.width - 1, config.height - 1);
    await page.evaluate(() => document.fonts.ready);
    await delay(config.settleMs);
    if (errors.length)
      throw new Error(`Native UI errors: ${errors.join("; ")}`);
    const viewport = await canvas.screenshot();
    if (viewport.length < 50_000)
      throw new Error("Viewport appears empty; refusing README update.");
    const png = await page.screenshot({ scale: "css" });
    await fs.mkdir(path.join(root, "artifacts/screenshots"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, "artifacts/screenshots/readme-candidate.png"),
      png,
    );
    if (sourceFingerprint(root) !== fingerprint)
      throw new Error(
        "Source changed during capture; rerun after edits finish.",
      );
    const manifest = {
      schemaVersion: 1,
      surface: "tauri-production-ui",
      version,
      capturedAt: new Date().toISOString(),
      sourceSha256: fingerprint,
      configSha256: sha256(JSON.stringify(config)),
      modelSha256: config.modelSha256,
      imageSha256: sha256(png),
      viewportSha256: sha256(viewport),
      loadedModel: path.basename(modelPath),
      errors,
    };
    validateCapture({ manifest, config, version, fingerprint, png });
    await fs.writeFile(imagePath, png);
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log("Updated docs/images/hero.png and hero.capture.json");
  } finally {
    await browser?.close();
    try {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `$captureProcess = Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue; if ($captureProcess) { $null = $captureProcess.CloseMainWindow(); if (-not $captureProcess.WaitForExit(5000)) { exit 1 } }`,
        ],
        { windowsHide: true, timeout: 10_000 },
      );
    } catch {
      child.kill();
    }
    // Keep the isolated profile and build config under TEMP for diagnostics.
    console.log(`Capture diagnostics: ${work}`);
  }
}

try {
  if (args.length === 0) await capture();
  else if (args.length === 1 && args[0] === "--check") await check();
  else throw new Error("Usage: node scripts/readme-screenshot.mjs [--check]");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
