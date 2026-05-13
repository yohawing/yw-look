#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { cp } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prebuiltRoot = join(repoRoot, "third_party", "prebuilt", "openusd");
const manifestPath = join(prebuiltRoot, "manifest.json");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function requireArg(name) {
  const value = argValue(name);
  if (!value) throw new Error(`missing required ${name}`);
  return value;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}`,
    );
  }
}

function sha256(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function validateManifestPath(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.includes("..") ||
    value.includes(":")
  ) {
    throw new Error(`invalid ${label} in OpenUSD prebuilt manifest: ${value}`);
  }
}

function extractZip(zipPath, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  run("tar", ["-xf", zipPath, "-C", dest]);
}

const triplet = requireArg("--triplet");
const dest = resolve(
  argValue("--dest", join(repoRoot, "src-tauri", "vcpkg_installed", triplet)),
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const artifact = manifest.artifacts?.find((entry) => entry.triplet === triplet);

if (!artifact) {
  console.log(`No OpenUSD prebuilt artifact for ${triplet}`);
  process.exit(2);
}
validateManifestPath(artifact.file, "file");
validateManifestPath(artifact.payloadRoot, "payloadRoot");

const zipPath = join(prebuiltRoot, artifact.file);
if (!existsSync(zipPath)) {
  throw new Error(`OpenUSD prebuilt zip is missing: ${zipPath}`);
}
if (statSync(zipPath).size !== artifact.size) {
  throw new Error(`OpenUSD prebuilt zip size mismatch: ${zipPath}`);
}
if (sha256(zipPath).toLowerCase() !== artifact.sha256.toLowerCase()) {
  throw new Error(`OpenUSD prebuilt zip sha256 mismatch: ${zipPath}`);
}

const staging = join(tmpdir(), `yw-look-openusd-extract-${process.pid}`);
try {
  extractZip(zipPath, staging);
  const payload = join(staging, artifact.payloadRoot);
  if (!existsSync(payload)) {
    throw new Error(`payload root is missing in zip: ${artifact.payloadRoot}`);
  }

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  await cp(payload, dest, { recursive: true, force: true });
} finally {
  rmSync(staging, { recursive: true, force: true });
}

console.log(`Extracted ${artifact.file} to ${dest}`);
