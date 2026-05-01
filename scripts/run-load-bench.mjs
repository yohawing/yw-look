import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const modelsPath = path.join(repoRoot, "samples", "private", "models.json");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(repoRoot, "artifacts", "bench", stamp);

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

console.log(`[bench] output: ${outDir}`);

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
