import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import http from "node:http";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const usage = `usage:
  npm run shot -- --in <model> --out <png> [--size WxH] [--bg color]
  npm run check -- --in <model>

Forwards extra args to the yw-look binary running with a local Vite dev server.
The first positional argument is treated as the subcommand
(\`shot\` or \`check\`); other tokens are forwarded verbatim.`;

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
  console.log(usage);
  process.exit(0);
}

const subcommand = argv[0];
if (subcommand !== "shot" && subcommand !== "check") {
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
cargoArgs.push("--", `--${subcommand}`, ...forwarded);

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

function waitForUrl(url, timeoutMs = 60_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      if (await probeUrl(url)) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`dev server did not become ready: ${url}`));
        return;
      }
      setTimeout(poll, 500);
    };
    poll();
  });
}

const devUrl = "http://127.0.0.1:1420/shot.html";
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
    return;
  }
  if (process.platform === "win32" && devServer.pid) {
    spawn("taskkill", ["/pid", String(devServer.pid), "/T", "/F"], {
      stdio: "ignore",
      shell: false,
    });
    return;
  }
  devServer.kill();
}

devServer?.on("error", (error) => {
  stopDevServer();
  console.error(error);
  process.exit(1);
});

try {
  await waitForUrl(devUrl);
} catch (error) {
  stopDevServer();
  console.error(error);
  process.exit(1);
}

const child = spawn("cargo", cargoArgs, {
  cwd: repoRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("error", (error) => {
  stopDevServer();
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  stopDevServer();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
