#!/usr/bin/env node
import { spawn } from "node:child_process";

const [profile, separator, ...command] = process.argv.slice(2);

if (!profile || separator !== "--" || command.length === 0) {
  console.error(
    "Usage: node scripts/run-loader-pack-profile.mjs <core|all> -- <command...>",
  );
  process.exit(1);
}

const profiles = {
  core: {
    YW_INCLUDE_MMD_LOADER_PACK: "0",
    YW_INCLUDE_SPARK_LOADER_PACK: "0",
  },
  all: {
    YW_INCLUDE_MMD_LOADER_PACK: "1",
    YW_INCLUDE_SPARK_LOADER_PACK: "1",
  },
};

const profileEnv = profiles[profile];
if (!profileEnv) {
  console.error(`Unknown loader pack profile: ${profile}`);
  process.exit(1);
}

const child = spawn(command[0], command.slice(1), {
  env: {
    ...process.env,
    ...profileEnv,
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
