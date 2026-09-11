import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findVersionedInstaller,
  main,
  resolveNsisBundlePaths,
} from "./check-nsis-loader-pack-bundle.mjs";
import {
  LOADER_PACKS,
  buildPackManifest,
  readPackageVersion,
  renderTemplate,
} from "./prepare-nsis-loader-pack-hooks.mjs";
import { resolveCargoTargetDirectory } from "./cargo-target-directory.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("explicit bundle root wins over target directory and environment", () => {
  const bundleRoot = path.join(os.tmpdir(), "explicit NSIS bundle root");
  const resolved = resolveNsisBundlePaths({
    argv: ["--bundle-root", bundleRoot],
    env: { YW_LOOK_NSIS_BUNDLE_ROOT: "environment-root" },
    targetDirectory: path.join(os.tmpdir(), "Cargo target with spaces"),
  });

  assert.equal(resolved.bundleRoot, path.resolve(repoRoot, bundleRoot));
});

test("target directory resolves the Cargo release bundle layout", () => {
  const targetDirectory = path.join(os.tmpdir(), "Cargo target with spaces");
  const resolved = resolveNsisBundlePaths({ targetDirectory });

  assert.equal(
    resolved.bundleRoot,
    path.join(targetDirectory, "release", "bundle"),
  );
  assert.equal(
    resolved.nsisHookDir,
    path.join(repoRoot, "src-tauri", "target", "nsis"),
  );
});

test("resolves environment and Cargo config target directories with spaces", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "Cargo metadata "));
  const configTarget = path.join(root, "configured target directory");
  const environmentTarget = path.join(root, "environment target directory");
  const manifest = path.join(root, "Cargo.toml");
  const cargoConfig = path.join(root, ".cargo", "config.toml");

  try {
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(
      manifest,
      [
        "[package]",
        'name = "cargo-target-directory-test"',
        'version = "0.0.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
    );
    fs.writeFileSync(path.join(root, "src", "lib.rs"), "pub fn marker() {}\n");
    fs.mkdirSync(path.dirname(cargoConfig), { recursive: true });
    fs.writeFileSync(
      cargoConfig,
      [
        "[build]",
        'target-dir = "' + configTarget.replaceAll("\\", "/") + '"',
        "",
      ].join("\n"),
    );

    const baseEnv = { ...process.env };
    delete baseEnv.CARGO_TARGET_DIR;
    assert.equal(
      resolveCargoTargetDirectory({
        cwd: root,
        manifest,
        fallback: path.join(root, "fallback"),
        env: baseEnv,
      }),
      path.resolve(configTarget),
    );

    assert.equal(
      resolveCargoTargetDirectory({
        cwd: root,
        manifest,
        fallback: path.join(root, "fallback"),
        env: { ...baseEnv, CARGO_TARGET_DIR: environmentTarget },
      }),
      path.resolve(environmentTarget),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("target directory CLI option takes precedence over metadata and environment", () => {
  const targetDirectory = path.join(os.tmpdir(), "explicit target directory");
  const resolved = resolveNsisBundlePaths({
    argv: ["--target-dir", targetDirectory],
    env: { YW_LOOK_NSIS_BUNDLE_ROOT: "environment-root" },
    targetDirectory: path.join(os.tmpdir(), "metadata target"),
  });

  assert.equal(
    resolved.bundleRoot,
    path.join(targetDirectory, "release", "bundle"),
  );
});

test("missing explicit path arguments fail with a diagnostic", () => {
  assert.throws(
    () => resolveNsisBundlePaths({ argv: ["--bundle-root"] }),
    /--bundle-root requires a path argument/,
  );
});

test("finds a versioned NSIS installer in a custom path containing spaces", () => {
  const bundleRoot = os.tmpdir() + path.sep + "custom NSIS bundle root ";
  const nsisDirectory = path.join(bundleRoot, "release", "bundle", "nsis");
  const installerName = "yw-look_0.3.3_x64-setup.exe";
  try {
    fs.mkdirSync(nsisDirectory, { recursive: true });
    fs.writeFileSync(path.join(nsisDirectory, installerName), "installer");

    assert.equal(
      findVersionedInstaller(nsisDirectory, ".exe", "0.3.3"),
      path.join(nsisDirectory, installerName),
    );
  } finally {
    fs.rmSync(bundleRoot, { recursive: true, force: true });
  }
});

test("validates a complete NSIS bundle from a custom bundle root", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "NSIS bundle check "));
  try {
    const version = await readPackageVersion(repoRoot);
    const bundleRoot = path.join(root, "release", "bundle");
    const nsisDirectory = path.join(bundleRoot, "nsis");
    const installerPath = path.join(
      nsisDirectory,
      `yw-look_${version}_x64-setup.exe`,
    );
    const nsisHookDir = path.join(root, "nsis");
    const template = fs.readFileSync(
      path.join(
        repoRoot,
        "src-tauri",
        "nsis",
        "optional-loader-packs.template.nsh",
      ),
      "utf8",
    );
    const hookContent = renderTemplate(template, version);
    const meta = {
      appVersion: version,
      packs: LOADER_PACKS.map((pack) => ({
        ...buildPackManifest(pack, version),
        installDir: pack.installDir,
      })),
    };

    fs.mkdirSync(nsisDirectory, { recursive: true });
    fs.mkdirSync(nsisHookDir, { recursive: true });
    fs.writeFileSync(installerPath, "installer");
    fs.writeFileSync(`${installerPath}.sig`, "signature");
    fs.writeFileSync(
      path.join(nsisHookDir, "optional-loader-packs.generated.nsh"),
      hookContent,
    );
    fs.writeFileSync(
      path.join(nsisHookDir, "optional-loader-packs.meta.json"),
      `${JSON.stringify(meta)}\n`,
    );

    await main({ paths: { bundleRoot, nsisHookDir } });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
