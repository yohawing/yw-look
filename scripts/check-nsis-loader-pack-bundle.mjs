#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOADER_PACKS,
  buildPackManifest,
  readPackageVersion,
} from "./prepare-nsis-loader-pack-hooks.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const bundleRoot = path.join(
  repoRoot,
  "src-tauri",
  "target",
  "release",
  "bundle",
);
const nsisHookDir = path.join(repoRoot, "src-tauri", "target", "nsis");
const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");

function toRelative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function findVersionedInstaller(directory, extension, version) {
  const versionMarker = `_${version}_`;

  if (!fs.existsSync(directory)) {
    return null;
  }

  const matches = fs
    .readdirSync(directory)
    .filter(
      (name) =>
        name.toLowerCase().endsWith(extension) &&
        (extension !== ".exe" || name.toLowerCase().endsWith("-setup.exe")) &&
        !name.toLowerCase().endsWith(".sig") &&
        name.includes(versionMarker),
    );

  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    throw new Error(
      `Multiple ${extension} installers found in ${toRelative(directory)}: ${matches.join(", ")}`,
    );
  }

  return path.join(directory, matches[0]);
}

function assertUpdaterSignature(installerPath) {
  const signaturePath = `${installerPath}.sig`;
  assert(
    fs.existsSync(signaturePath),
    `Missing updater signature: ${toRelative(signaturePath)}. Re-run \`npm run bundle:win:loaders\` with TAURI_SIGNING_PRIVATE_KEY configured.`,
  );

  const signature = fs.readFileSync(signaturePath, "utf8").trim();
  assert(
    signature.length > 0,
    `Updater signature is empty: ${toRelative(signaturePath)}`,
  );

  return signaturePath;
}

function assertJsonEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      `${label} mismatch:\nexpected ${expectedJson}\nactual   ${actualJson}`,
    );
  }
}

async function main() {
  const version = await readPackageVersion();
  const tauriConfig = readJson(tauriConfigPath);

  assert(
    tauriConfig.version === version,
    `src-tauri/tauri.conf.json version (${tauriConfig.version}) must match package.json version (${version})`,
  );

  const nsisInstaller = findVersionedInstaller(
    path.join(bundleRoot, "nsis"),
    ".exe",
    version,
  );
  if (!nsisInstaller) {
    throw new Error(
      "No Windows NSIS Loader Pack bundle artifacts found. Run `npm run bundle:win:loaders` first.",
    );
  }

  assert(
    nsisInstaller,
    `Missing NSIS setup .exe for v${version} under src-tauri/target/release/bundle/nsis/`,
  );
  const nsisSignaturePath = assertUpdaterSignature(nsisInstaller);

  const hookPath = path.join(
    nsisHookDir,
    "optional-loader-packs.generated.nsh",
  );
  const metaPath = path.join(nsisHookDir, "optional-loader-packs.meta.json");

  assert(
    fs.existsSync(hookPath),
    `Missing generated NSIS hook: ${toRelative(hookPath)}. Run \`npm run prepare:nsis-loader-packs\` before bundling.`,
  );
  assert(
    fs.existsSync(metaPath),
    `Missing optional-loader-packs.meta.json: ${toRelative(metaPath)}. Run \`npm run prepare:nsis-loader-packs\` before bundling.`,
  );

  const hookContent = fs.readFileSync(hookPath, "utf8");
  assert(
    hookContent.includes(version),
    `Generated NSIS hook does not include app version v${version}`,
  );

  for (const pack of LOADER_PACKS) {
    assert(
      hookContent.includes(pack.id),
      `Generated NSIS hook is missing pack id: ${pack.id}`,
    );
  }

  const meta = readJson(metaPath);
  assert(
    meta.appVersion === version,
    `optional-loader-packs.meta.json appVersion (${meta.appVersion}) must match current version (${version})`,
  );

  const expectedPackIds = LOADER_PACKS.map((pack) => pack.id);
  const actualPackIds = (meta.packs ?? []).map((pack) => pack.id);
  assertJsonEqual(
    actualPackIds,
    expectedPackIds,
    "optional-loader-packs.meta.json pack ids",
  );

  assertJsonEqual(
    meta.packs,
    LOADER_PACKS.map((pack) => ({
      ...buildPackManifest(pack, version),
      installDir: pack.installDir,
    })),
    "optional-loader-packs.meta.json packs",
  );

  console.log(
    `NSIS Loader Pack bundle readiness verified for v${version} (${LOADER_PACKS.length} packs)`,
  );
  console.log(`  NSIS: ${toRelative(nsisInstaller)}`);
  console.log(`  NSIS sig: ${toRelative(nsisSignaturePath)}`);
  console.log(`  Hook: ${toRelative(hookPath)}`);
  console.log(`  Meta: ${toRelative(metaPath)}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
