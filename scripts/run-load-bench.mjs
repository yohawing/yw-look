import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hasFlag, readRepeatedOption } from "./cliArgs.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const modelsPath = path.join(repoRoot, "samples", "private", "models.json");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(repoRoot, "artifacts", "bench", stamp);
const cliArgs = process.argv.slice(2);
const benchCaseIds = readRepeatedOption(cliArgs, "--case");
const visible = hasFlag(cliArgs, "--visible");

await mkdir(outDir, { recursive: true });

const args = [
  "tauri",
  "dev",
  "--",
  "--",
  "--bench-load",
  "--bench-models",
  modelsPath,
  "--bench-repo-root",
  repoRoot,
  "--bench-out",
  outDir,
  "--bench-node-version",
  process.version,
];

for (const id of benchCaseIds) {
  args.push("--bench-case", id);
}
if (visible) {
  args.push("--bench-visible");
}

console.log(`[bench] output: ${outDir}`);
if (benchCaseIds.length > 0) {
  console.log(`[bench] cases: ${benchCaseIds.join(", ")}`);
}
if (visible) {
  console.log("[bench] visible window enabled");
}

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
