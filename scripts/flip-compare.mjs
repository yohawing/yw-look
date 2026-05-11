import { accessSync, constants } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const exeSuffix = process.platform === "win32" ? ".exe" : "";
const binaryName = `flip_compare${exeSuffix}`;
const cargoManifest = path.join(repoRoot, "src-tauri", "Cargo.toml");

function findBinary() {
  const candidates = [
    path.join(repoRoot, "src-tauri", "target", "debug", binaryName),
    path.join(repoRoot, "src-tauri", "target", "release", binaryName),
  ];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not found or not executable
    }
  }
  return null;
}

let binaryPath = findBinary();

function buildBinary() {
  if (binaryPath) return;
  console.error("flip_compare binary not found, building...");
  const result = spawnSync(
    "cargo",
    [
      "build",
      "--manifest-path",
      cargoManifest,
      "--bin",
      "flip_compare",
      "--no-default-features",
      "--features",
      "flip-compare,backend-openusd-rs",
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
  if (result.status !== 0) {
    throw new Error("cargo build flip_compare failed");
  }
  binaryPath = findBinary();
  if (!binaryPath) {
    throw new Error("flip_compare binary not found after build");
  }
}

/**
 * Compare two PNG images using NVIDIA FLIP perceptual diff.
 *
 * @param {object}  opts
 * @param {string}  opts.reference       Path to the reference (baseline) PNG.
 * @param {string}  opts.test            Path to the test (current) PNG.
 * @param {string} [opts.errorMap]       Path to write magma-colored error map PNG.
 * @param {string} [opts.report]         Path to write JSON report.
 * @param {number} [opts.meanThreshold]  Mean FLIP error threshold (default 0.05).
 * @param {number} [opts.maxThreshold]   Max FLIP error threshold (default 0.30).
 * @param {number} [opts.ppd]            Pixels per degree (default 67).
 * @returns {Promise<object>}  The FLIP report object with { passed, mean, max, ... }.
 */
export async function flipCompare({
  reference,
  test,
  errorMap,
  report,
  meanThreshold,
  maxThreshold,
  ppd,
}) {
  buildBinary();

  const args = [reference, test];
  if (report) args.push("--report", report);
  if (errorMap) args.push("--error-map", errorMap);
  if (meanThreshold != null)
    args.push("--mean-threshold", String(meanThreshold));
  if (maxThreshold != null) args.push("--max-threshold", String(maxThreshold));
  if (ppd != null) args.push("--ppd", String(ppd));

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const child = spawn(binaryPath, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);

    child.on("exit", (code) => {
      if (stderr) {
        console.error(stderr.trim());
      }

      let result;
      try {
        result = JSON.parse(stdout.trim());
      } catch {
        reject(
          new Error(
            `flip_compare did not produce valid JSON. stderr: ${stderr.trim()}`,
          ),
        );
        return;
      }

      if (code === 2) {
        reject(
          new Error(`flip_compare error (exit ${code}): ${stderr.trim()}`),
        );
        return;
      }

      resolve(result);
    });
  });
}
