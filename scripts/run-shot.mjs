import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const usage = `usage:
  npm run shot -- --in <model> --out <png> [--size WxH] [--bg color]
  npm run check -- --in <model>

Forwards extra args to the yw-look binary running under \`tauri dev\`.
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
const args = ["tauri", "dev", "--", "--", `--${subcommand}`, ...forwarded];

const child = spawn("npx", args, {
  cwd: repoRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
