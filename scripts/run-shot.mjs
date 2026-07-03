import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { hasFlag } from "./cliArgs.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const usage = `usage:
  npm run shot -- --in <model> --out <png> [--motion <vmd>] [--size WxH] [--bg color]
  npm run shot:batch -- --config <json>
  npm run shot:batch -- --config-file <path>
  npm run check -- --in <model> [--usd-load-policy loadAll|noPayloads]

Forwards extra args to the yw-look binary running with a local Vite dev server.
The first positional argument is treated as the subcommand
(\`shot\`, \`shot-batch\`, or \`check\`); other tokens are forwarded verbatim.`;

const argv = process.argv.slice(2);
if (argv.length === 0 || hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
  console.log(usage);
  process.exit(0);
}

const subcommand = argv[0];
if (
  subcommand !== "shot" &&
  subcommand !== "shot-batch" &&
  subcommand !== "check"
) {
  console.error(`unknown subcommand: ${subcommand}`);
  console.error(usage);
  process.exit(2);
}

const forwarded = argv.slice(1);
const cargoArgs = [
  "run",
  "--manifest-path",
  path.join(repoRoot, "src-tauri/Cargo.toml"),
];
const cargoFeatures = process.env.YW_LOOK_CARGO_FEATURES;
if (process.env.YW_LOOK_CARGO_NO_DEFAULT_FEATURES === "1") {
  cargoArgs.push("--no-default-features");
}
if (cargoFeatures) {
  cargoArgs.push("--features", cargoFeatures);
}
if (subcommand === "shot-batch") {
  const configIndex = forwarded.indexOf("--config");
  const configFileIndex = forwarded.indexOf("--config-file");
  if (configIndex !== -1 && configFileIndex !== -1) {
    console.error(
      "shot-batch accepts either --config or --config-file, not both",
    );
    console.error(usage);
    process.exit(2);
  }
  const config = configIndex === -1 ? null : forwarded[configIndex + 1];
  const configFile =
    configFileIndex === -1 ? null : forwarded[configFileIndex + 1];
  if (config && !config.startsWith("--")) {
    cargoArgs.push("--", "--shot-batch", config);
  } else if (configFile && !configFile.startsWith("--")) {
    cargoArgs.push("--", "--shot-batch-file", configFile);
  } else {
    console.error(
      "shot-batch requires --config <json> or --config-file <path>",
    );
    console.error(usage);
    process.exit(2);
  }
} else {
  cargoArgs.push("--", `--${subcommand}`, ...forwarded);
}

function probeUrl(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(true);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(2_000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function waitForUrl(url, timeoutMs = 60_000, serverProcess = null) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      serverProcess?.off("exit", onServerExit);
      callback(value);
    };
    const onServerExit = (code, signal) => {
      const reason =
        signal ?? (code === null ? "unknown status" : `exit code ${code}`);
      finish(reject, new Error(`dev server exited before ready: ${reason}`));
    };
    serverProcess?.once("exit", onServerExit);
    const poll = async () => {
      if (await probeUrl(url)) {
        finish(resolve);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        finish(reject, new Error(`dev server did not become ready: ${url}`));
        return;
      }
      setTimeout(poll, 500);
    };
    poll();
  });
}

const devUrl = "http://127.0.0.1:1420/?entry=shot";
const reuseDevServer = await probeUrl(devUrl);
const devServer = reuseDevServer
  ? null
  : spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

function stopDevServer() {
  if (!devServer || devServer.killed) {
    return Promise.resolve();
  }
  if (process.platform === "win32" && devServer.pid) {
    return new Promise((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/pid", String(devServer.pid), "/T", "/F"],
        {
          stdio: "ignore",
          shell: false,
          windowsHide: true,
        },
      );
      const timer = setTimeout(resolve, 5_000);
      const finish = () => {
        clearTimeout(timer);
        resolve();
      };
      killer.once("exit", finish);
      killer.once("error", finish);
    });
  }
  devServer.kill();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    devServer.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

devServer?.on("error", (error) => {
  void (async () => {
    await stopDevServer();
    console.error(error);
    process.exit(1);
  })();
});

try {
  await waitForUrl(devUrl, 60_000, devServer);
} catch (error) {
  await stopDevServer();
  console.error(error);
  process.exit(1);
}

const child = spawn("cargo", cargoArgs, {
  cwd: repoRoot,
  stdio: "inherit",
  shell: false,
});

child.on("error", (error) => {
  void (async () => {
    await stopDevServer();
    console.error(error);
    process.exit(1);
  })();
});

child.on("exit", (code, signal) => {
  void (async () => {
    await stopDevServer();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  })();
});
