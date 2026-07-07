#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
const bundleDir = path.join(
  repoRoot,
  "src-tauri",
  "target",
  "release",
  "bundle",
);
const feedDir = path.join(repoRoot, "artifacts", "updater-feed");

function detectTarget() {
  if (process.env.YW_LOOK_LOCAL_UPDATE_TARGET) {
    return process.env.YW_LOOK_LOCAL_UPDATE_TARGET;
  }
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "darwin-aarch64" : "darwin-x86_64";
  }
  return "windows-x86_64";
}

const target = detectTarget();

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hashFile(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function findSourceBundle(installerName) {
  const candidates = target.startsWith("darwin")
    ? [path.join(bundleDir, "macos", installerName)]
    : [
        path.join(bundleDir, "nsis", installerName),
        path.join(bundleDir, "msi", installerName),
      ];

  const sourcePath = candidates.find((candidate) => fs.existsSync(candidate));
  assert(sourcePath, `No source bundle found for ${installerName}`);
  return sourcePath;
}

function main() {
  const tauriConfig = readJson(tauriConfigPath);
  const latestPath = path.join(feedDir, "latest.json");
  assert(
    fs.existsSync(latestPath),
    "Missing artifacts/updater-feed/latest.json",
  );

  const latest = readJson(latestPath);
  assert(
    latest.version === tauriConfig.version,
    `Feed version ${latest.version} does not match tauri.conf.json ${tauriConfig.version}`,
  );

  const platform = latest.platforms?.[target];
  assert(platform, `Missing update platform entry: ${target}`);
  assert(platform.signature?.trim(), `Missing signature for ${target}`);

  const updateUrl = new URL(platform.url);
  const installerName = decodeURIComponent(path.basename(updateUrl.pathname));
  assert(installerName, "Feed URL does not point to an installer artifact");

  const feedInstallerPath = path.join(feedDir, installerName);
  const feedSignaturePath = path.join(feedDir, `${installerName}.sig`);
  assert(
    fs.existsSync(feedInstallerPath),
    `Missing feed installer: ${installerName}`,
  );
  assert(
    fs.existsSync(feedSignaturePath),
    `Missing feed signature: ${installerName}.sig`,
  );

  const signature = fs.readFileSync(feedSignaturePath, "utf8").trim();
  assert(
    signature === platform.signature.trim(),
    "latest.json signature does not match copied .sig file",
  );

  const sourceInstallerPath = findSourceBundle(installerName);
  const sourceSignaturePath = `${sourceInstallerPath}.sig`;
  assert(
    fs.existsSync(sourceSignaturePath),
    `Missing source signature: ${path.relative(repoRoot, sourceSignaturePath)}`,
  );

  assert(
    hashFile(sourceInstallerPath) === hashFile(feedInstallerPath),
    "Copied feed installer differs from source bundle",
  );
  assert(
    hashFile(sourceSignaturePath) === hashFile(feedSignaturePath),
    "Copied feed signature differs from source bundle signature",
  );

  console.log(
    `check:update-feed ok (${target}, v${latest.version}, ${installerName})`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
