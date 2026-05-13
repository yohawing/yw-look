#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { cp, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prebuiltRoot = join(repoRoot, "third_party", "prebuilt", "openusd");
const manifestPath = join(prebuiltRoot, "manifest.json");

function shouldExcludePayloadPath(path) {
  const lower = path.toLowerCase().replaceAll("\\", "/");
  return (
    lower.endsWith(".pdb") ||
    lower.endsWith(".exe") ||
    lower.includes("/debug/") ||
    lower.endsWith("-debug.cmake")
  );
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function requireArg(name) {
  const value = argValue(name);
  if (!value) {
    throw new Error(`missing required ${name}`);
  }
  return value;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
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

async function stagePayload(source, triplet, staging) {
  const payloadRoot = join(staging, "vcpkg_installed", triplet);
  mkdirSync(payloadRoot, { recursive: true });
  for (const name of ["include", "lib", "share", "plugin"]) {
    const src = join(source, name);
    if (!existsSync(src)) continue;
    await cp(src, join(payloadRoot, name), {
      recursive: true,
      dereference: true,
      errorOnExist: false,
      force: true,
      filter: (path) => !shouldExcludePayloadPath(path),
    });
  }

  const bin = join(source, "bin");
  const stagedBin = join(payloadRoot, "bin");
  if (existsSync(bin)) {
    mkdirSync(stagedBin, { recursive: true });
    for (const entry of await readdir(bin, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      const lower = name.toLowerCase();
      const keep =
        lower.endsWith(".dll") ||
        (lower.endsWith(".lib") &&
          (lower.startsWith("usd_") ||
            lower.startsWith("tbb") ||
            lower.startsWith("hwloc") ||
            lower === "zlib.lib" ||
            lower === "usd_ms.lib"));
      if (!keep) continue;
      await cp(join(bin, name), join(stagedBin, name), {
        dereference: true,
        force: true,
      });
    }

    const pluginTree = join(bin, "usd");
    if (existsSync(pluginTree)) {
      await cp(pluginTree, join(stagedBin, "usd"), {
        recursive: true,
        dereference: true,
        errorOnExist: false,
        force: true,
      });
    }
  }

  const entries = await readdir(payloadRoot);
  if (entries.length === 0) {
    throw new Error(`no payload directories copied from ${source}`);
  }
}

function writeZip(staging, zipPath) {
  rmSync(zipPath, { force: true });
  mkdirSync(dirname(zipPath), { recursive: true });
  run("tar", ["-a", "-cf", zipPath, "-C", staging, "vcpkg_installed"]);
}

function updateManifest(artifact) {
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : { version: 1, artifacts: [] };
  manifest.version = 1;
  manifest.artifacts = (manifest.artifacts ?? []).filter(
    (entry) => entry.triplet !== artifact.triplet,
  );
  manifest.artifacts.push(artifact);
  manifest.artifacts.sort((a, b) => a.triplet.localeCompare(b.triplet));
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const triplet = requireArg("--triplet");
const source = resolve(
  argValue("--source", join(repoRoot, "src-tauri", "vcpkg_installed", triplet)),
);
const openusdVersion = argValue("--openusd", "25.5.1");
const vcpkgBaseline = argValue(
  "--vcpkg-baseline",
  "b83a134447208c35f740e4b6faf1263b0d6e860e",
);
const ywrev = argValue("--ywrev", "1");
const fileName = `openusd-${triplet}-${openusdVersion}-${vcpkgBaseline.slice(0, 12)}-${ywrev}.zip`;
const zipPath = join(prebuiltRoot, fileName);
const staging = join(tmpdir(), `yw-look-openusd-prebuilt-${process.pid}`);

if (!existsSync(source)) {
  throw new Error(`source directory does not exist: ${source}`);
}

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
await stagePayload(source, triplet, staging);
writeZip(staging, zipPath);
rmSync(staging, { recursive: true, force: true });

const artifact = {
  triplet,
  file: basename(zipPath),
  sha256: sha256(zipPath),
  size: statSync(zipPath).size,
  payloadRoot: `vcpkg_installed/${triplet}`,
  openusdVersion,
  vcpkgBaseline,
  ywrev,
};
updateManifest(artifact);
console.log(`Wrote ${zipPath}`);
console.log(JSON.stringify(artifact, null, 2));
