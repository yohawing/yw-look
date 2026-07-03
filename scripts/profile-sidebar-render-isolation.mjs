#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const repoRoot = process.cwd();
const devUrl = "http://127.0.0.1:1420/?entry=sidebar-profile";
const outputPath = path.join(
  repoRoot,
  "artifacts",
  "screenshots",
  "r2",
  "sidebar-render-isolation-profile.json",
);

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
  return spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1"], {
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

const reuseDevServer = await probeUrl(devUrl);
const devServer = reuseDevServer ? null : startDevServer();

try {
  await waitForUrl(devUrl, 60_000, devServer);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    await page.goto(devUrl, { waitUntil: "networkidle" });
    const result = await page.waitForFunction(
      () => globalThis.__YW_SIDEBAR_PROFILE_RESULT__ ?? null,
      null,
      { timeout: 10_000 },
    );
    const profile = await result.jsonValue();
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(profile, null, 2)}\n`);
    if (!profile.passed) {
      throw new Error(
        `sidebar committed during camera preset action: ${profile.commitsAfterCameraPreset} total commit(s), ${profile.commitsAfterMount} mount commit(s)`,
      );
    }
    console.log(`wrote ${path.relative(repoRoot, outputPath)}`);
  } finally {
    await browser.close();
  }
} finally {
  await stopDevServer(devServer);
}
