import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  binaryCandidates,
  findBinary,
  resolveCargoTargetDirectory,
} from "./flip-compare.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("resolves Cargo's configured target directory from metadata", () => {
  const targetDirectory = path.join(os.tmpdir(), "cargo target with spaces");
  let command;
  const resolved = resolveCargoTargetDirectory({
    fallback: path.join(os.tmpdir(), "fallback-target"),
    run: (...args) => {
      command = args;
      return {
        status: 0,
        stdout: JSON.stringify({ target_directory: targetDirectory }),
      };
    },
  });

  assert.equal(resolved, targetDirectory);
  assert.deepEqual(command[1], [
    "metadata",
    "--manifest-path",
    path.join(repoRoot, "src-tauri", "Cargo.toml"),
    "--no-deps",
    "--format-version",
    "1",
  ]);
  assert.equal(command[2].shell, false);
});

test("falls back to the conventional target directory when metadata is unavailable", () => {
  const fallback = path.join(os.tmpdir(), "fallback target");
  assert.equal(
    resolveCargoTargetDirectory({
      fallback,
      run: () => ({ status: 1, stdout: "" }),
    }),
    fallback,
  );
  assert.equal(
    resolveCargoTargetDirectory({
      fallback,
      run: () => ({ status: 0, stdout: "not json" }),
    }),
    fallback,
  );
});

test("keeps Windows executable names and paths containing spaces", () => {
  const targetDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "flip compare target "),
  );
  try {
    const binary = path.join(targetDirectory, "debug", "flip_compare.exe");
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.writeFileSync(binary, "placeholder", { mode: 0o755 });

    assert.deepEqual(binaryCandidates(targetDirectory, "win32"), [
      path.join(targetDirectory, "debug", "flip_compare.exe"),
      path.join(targetDirectory, "release", "flip_compare.exe"),
    ]);
    assert.equal(findBinary(targetDirectory, "win32"), binary);
  } finally {
    fs.rmSync(targetDirectory, { recursive: true, force: true });
  }
});
