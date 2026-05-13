#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);

function firstExisting(paths) {
  return paths.find((path) => existsSync(path));
}

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

function loadVisualStudioEnv(vsDevCmd) {
  if (!vsDevCmd) return {};
  const command = `call "${vsDevCmd}" -arch=x64 -host_arch=x64 >nul && set`;
  const result = spawnSync("cmd.exe", ["/d", "/c", command], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) return {};
  const env = {};
  const keep = new Set(
    [
      "PATH",
      "INCLUDE",
      "LIB",
      "LIBPATH",
      "VCToolsInstallDir",
      "VSINSTALLDIR",
      "WindowsSdkDir",
      "WindowsSDKLibVersion",
      "WindowsSDKVersion",
      "UCRTVersion",
      "ExtensionSdkDir",
    ].map((key) => key.toLowerCase()),
  );
  for (const line of result.stdout.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!keep.has(key.toLowerCase())) continue;
    if (key.includes("\0") || value.includes("\0")) continue;
    env[key] = value;
  }
  return env;
}

if (process.platform !== "win32") {
  run(join(repoRoot, "node_modules", ".bin", "tauri"), args);
} else {
  const vsDevCmd = firstExisting([
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\Common7\\Tools\\VsDevCmd.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\Tools\\VsDevCmd.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional\\Common7\\Tools\\VsDevCmd.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise\\Common7\\Tools\\VsDevCmd.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\Common7\\Tools\\VsDevCmd.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\18\\Professional\\Common7\\Tools\\VsDevCmd.bat",
    "C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise\\Common7\\Tools\\VsDevCmd.bat",
  ]);
  const ninja = firstExisting([
    join(homedir(), "AppData", "Local", "Microsoft", "WinGet", "Links", "ninja.exe"),
    "C:\\Program Files\\Ninja\\ninja.exe",
  ]);
  const tauri = join(repoRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
  const env = {
    ...process.env,
    ...loadVisualStudioEnv(vsDevCmd),
  };
  if (ninja) {
    env.CMAKE_GENERATOR = "Ninja";
    env.CMAKE_MAKE_PROGRAM = ninja;
  }
  run(process.execPath, [tauri, ...args], { env });
}
