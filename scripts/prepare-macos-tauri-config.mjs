#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriRoot = join(repoRoot, "src-tauri");
const triplet = "arm64-osx";
const installedRoot = join(tauriRoot, "vcpkg_installed", triplet);
const installedLib = join(installedRoot, "lib");
const staging = join(tauriRoot, "cpp-artifacts", triplet);
const generatedConfig = join(tauriRoot, "tauri.macos.generated.json");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}`,
    );
  }
}

function tryExtractPrebuilt() {
  const result = spawnSync(
    process.execPath,
    [
      join(repoRoot, "scripts", "extract-openusd-prebuilt.mjs"),
      "--triplet",
      triplet,
      "--dest",
      installedRoot,
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  return result.status === 0;
}

function fallbackVcpkgInstall() {
  const vcpkgRoot = process.env.VCPKG_ROOT;
  if (!vcpkgRoot) {
    throw new Error(
      `No OpenUSD prebuilt payload for ${triplet}, and VCPKG_ROOT is not set.`,
    );
  }
  run(
    join(vcpkgRoot, "vcpkg"),
    [
      "install",
      "--x-manifest-root=.",
      `--triplet=${triplet}`,
      "--x-install-root=vcpkg_installed",
      "--overlay-triplets=triplets",
    ],
    { cwd: tauriRoot },
  );
}

function shouldStage(name) {
  return (
    /^libusd_.*\.dylib$/.test(name) ||
    /^libtbb.*\.dylib$/.test(name) ||
    /^libhwloc.*\.dylib$/.test(name) ||
    /^libz\..*\.dylib$/.test(name)
  );
}

function stageDylibs() {
  if (!existsSync(installedLib)) {
    if (!tryExtractPrebuilt()) {
      fallbackVcpkgInstall();
    }
  }
  if (!existsSync(installedLib)) {
    throw new Error(`OpenUSD lib directory is missing: ${installedLib}`);
  }

  mkdirSync(staging, { recursive: true });
  for (const entry of readdirSync(installedLib, { withFileTypes: true })) {
    if (!entry.isFile() || !shouldStage(entry.name)) continue;
    copyFileSync(join(installedLib, entry.name), join(staging, entry.name));
  }
}

function writeConfig() {
  const dylibs = readdirSync(staging)
    .filter((name) => name.endsWith(".dylib"))
    .map((name) => `cpp-artifacts/${triplet}/${name}`);
  dylibs.push(`cpp-artifacts/${triplet}/libusd_c_shim.dylib`);
  const frameworks = [...new Set(dylibs)].sort();

  if (frameworks.length < 10) {
    throw new Error(
      `Only ${frameworks.length} macOS frameworks discovered under ${staging}.`,
    );
  }
  if (!frameworks.includes(`cpp-artifacts/${triplet}/libusd_c_shim.dylib`)) {
    throw new Error("Generated macOS config is missing libusd_c_shim.dylib.");
  }

  const config = {
    $schema: "https://schema.tauri.app/config/2",
    bundle: {
      resources: {
        "alembic-tools/arm64-osx/": "alembic-tools/arm64-osx/",
        "cpp-artifacts/arm64-osx/usd/": "usd/",
      },
      macOS: {
        frameworks,
      },
    },
  };
  writeFileSync(generatedConfig, `${JSON.stringify(config, null, 2)}\n`);
  console.log(
    `Generated ${generatedConfig} with ${frameworks.length} frameworks.`,
  );
}

stageDylibs();
writeConfig();
