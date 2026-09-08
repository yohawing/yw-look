#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { hasFlag, readOption } from "./cliArgs.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OFFICIAL_ENDPOINT =
  "https://github.com/yohawing/yw-look/releases/latest/download/latest.json";

export function validateCompiledConfiguration(config, { version, publicKey }) {
  const errors = [];
  if (config?.version !== version)
    errors.push("binary version does not match release version");
  if (config?.debugBuild !== false)
    errors.push("binary is not a release build");
  if (config?.source !== "compile-time environment")
    errors.push("configuration provenance is missing");
  if (config?.endpoint !== OFFICIAL_ENDPOINT)
    errors.push("binary does not contain the official updater endpoint");
  if (!publicKey || config?.publicKey !== publicKey)
    errors.push("binary does not contain the expected updater public key");
  return errors;
}

export function checkReleaseConfiguration(args) {
  const binary = readOption(args, "--binary");
  const manifest = readOption(args, "--manifest");
  const url = readOption(args, "--url");
  const configOnly = hasFlag(args, "--config-only");
  const valueOptions = new Set(["--binary", "--manifest", "--url"]);
  for (let index = 0; index < args.length; index++) {
    if (valueOptions.has(args[index])) {
      if (!args[index + 1] || args[index + 1].startsWith("--"))
        throw new Error(`missing value for ${args[index]}`);
      index++;
    } else if (args[index] !== "--config-only") {
      throw new Error(`unknown argument: ${args[index]}`);
    }
  }
  if (!binary) throw new Error("--binary is required");
  if (
    Number(Boolean(manifest)) + Number(Boolean(url)) + Number(configOnly) !==
    1
  ) {
    throw new Error(
      "choose exactly one of --manifest, --url, or --config-only",
    );
  }
  if (url && url !== OFFICIAL_ENDPOINT)
    throw new Error("--url must be the official updater endpoint");
  const version = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ).version;
  const publicKey = JSON.parse(
    fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"),
  ).plugins.updater.pubkey;
  const config = JSON.parse(
    execFileSync(path.resolve(binary), ["--print-update-config"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 64 * 1024,
    }).trim(),
  );
  const errors = validateCompiledConfiguration(config, { version, publicKey });
  if (errors.length) throw new Error(errors.join("; "));
  if (!configOnly) {
    execFileSync(
      process.execPath,
      [
        path.join(root, "scripts/check-release-updater-manifest.mjs"),
        ...(manifest ? ["--manifest", path.resolve(manifest)] : ["--url", url]),
        "--expected-version",
        version,
      ],
      { stdio: "inherit", windowsHide: true, timeout: 180000 },
    );
  }
  return {
    binary: path.resolve(binary),
    ...config,
    manifest: configOnly ? "not_checked" : "passed",
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(
      JSON.stringify(checkReleaseConfiguration(process.argv.slice(2)), null, 2),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
