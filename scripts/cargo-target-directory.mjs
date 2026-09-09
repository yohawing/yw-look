import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * Resolve Cargo's effective target directory, including build.target-dir and
 * CARGO_TARGET_DIR overrides. The fallback keeps callers compatible with
 * Cargo's conventional layout when metadata is unavailable.
 */
export function resolveCargoTargetDirectory({
  cargo = "cargo",
  cwd,
  manifest,
  fallback,
  env = process.env,
  run = spawnSync,
} = {}) {
  if (!cwd || !manifest || !fallback) {
    throw new Error(
      "resolveCargoTargetDirectory requires cwd, manifest, and fallback",
    );
  }

  try {
    const result = run(
      cargo,
      [
        "metadata",
        "--manifest-path",
        manifest,
        "--no-deps",
        "--format-version",
        "1",
      ],
      {
        cwd,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      },
    );
    if (result?.status === 0) {
      const metadata = JSON.parse(result.stdout);
      if (
        typeof metadata.target_directory === "string" &&
        metadata.target_directory.trim().length > 0
      ) {
        return path.resolve(cwd, metadata.target_directory);
      }
    }
  } catch {
    // Keep the existing default path when Cargo cannot be queried.
  }
  return fallback;
}
