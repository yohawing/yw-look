#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOADER_PACKS,
  buildPackManifest,
  readPackageVersion,
} from "./prepare-nsis-loader-pack-hooks.mjs";
import { resolveCargoTargetDirectory } from "./cargo-target-directory.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cargoManifest = path.join(repoRoot, "src-tauri", "Cargo.toml");
const defaultTargetDirectory = path.join(repoRoot, "src-tauri", "target");
const defaultNsisHookDir = path.join(defaultTargetDirectory, "nsis");
const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");

function readOption(argv, option) {
  const index = argv.indexOf(option);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a path argument`);
  }
  return value;
}

export function resolveNsisBundlePaths({
  argv = [],
  env = process.env,
  targetDirectory = resolveCargoTargetDirectory({
    cwd: repoRoot,
    manifest: cargoManifest,
    fallback: defaultTargetDirectory,
    env,
  }),
} = {}) {
  const explicitBundleRoot = readOption(argv, "--bundle-root");
  const explicitTargetDirectory =
    readOption(argv, "--target-dir") ?? readOption(argv, "--target-directory");
  const configuredBundleRoot = env.YW_LOOK_NSIS_BUNDLE_ROOT?.trim();
  const bundleRoot = explicitBundleRoot
    ? path.resolve(repoRoot, explicitBundleRoot)
    : explicitTargetDirectory
      ? path.join(
          path.resolve(repoRoot, explicitTargetDirectory),
          "release",
          "bundle",
        )
      : configuredBundleRoot
        ? path.resolve(repoRoot, configuredBundleRoot)
        : path.join(targetDirectory, "release", "bundle");

  return {
    bundleRoot,
    // Tauri's installerHooks config still points at src-tauri/target/nsis.
    nsisHookDir: defaultNsisHookDir,
  };
}

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

export function findVersionedInstaller(directory, extension, version) {
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

export async function main({ paths = resolveNsisBundlePaths() } = {}) {
  const { bundleRoot, nsisHookDir } = paths;
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
      [
        "No Windows NSIS Loader Pack bundle artifacts found. Run `npm run bundle:win:loaders` first.",
        `Searched: ${toRelative(path.join(bundleRoot, "nsis"))}`,
      ].join("\n"),
    );
  }

  assert(
    nsisInstaller,
    `Missing NSIS setup .exe for v${version} under ${toRelative(
      path.join(bundleRoot, "nsis"),
    )}/`,
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

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: node scripts/check-nsis-loader-pack-bundle.mjs [options]

Options:
  --bundle-root <path>  Explicit release/bundle directory (highest priority).
  --target-dir <path>   Cargo target directory; checks <path>/release/bundle.
  --target-directory <path>
                        Alias for --target-dir.

Environment:
  YW_LOOK_NSIS_BUNDLE_ROOT  Alternate release/bundle directory.
  Cargo metadata            Used to resolve the configured target directory.`);
    process.exit(0);
  }

  try {
    await main({ paths: resolveNsisBundlePaths({ argv: args }) });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
