import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  sha256,
  sourceFingerprint,
  validateCapture,
} from "./readme-screenshot-contract.mjs";

test("source edits and additions invalidate capture, checkout line endings do not", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "yw-look-capture-contract-"),
  );
  try {
    execFileSync("git", ["init", "--quiet", root]);
    fs.mkdirSync(path.join(root, "src"));
    const file = path.join(root, "src/main.ts");
    fs.writeFileSync(file, "first\nsecond\n");
    const original = sourceFingerprint(root);
    fs.writeFileSync(file, "first\r\nsecond\r\n");
    assert.equal(sourceFingerprint(root), original);
    fs.writeFileSync(file, "changed\n");
    assert.notEqual(sourceFingerprint(root), original);
    const changed = sourceFingerprint(root);
    fs.writeFileSync(path.join(root, "src/new.ts"), "new");
    assert.notEqual(sourceFingerprint(root), changed);
    fs.unlinkSync(path.join(root, "src/new.ts"));
    assert.equal(sourceFingerprint(root), changed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function evidence() {
  const config = { width: 1440, height: 900, modelSha256: "model" };
  const png = Buffer.alloc(60_000);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(config.width, 16);
  png.writeUInt32BE(config.height, 20);
  return {
    config,
    png,
    version: "0.3.3",
    fingerprint: "current",
    manifest: {
      schemaVersion: 1,
      version: "0.3.3",
      modelSha256: "model",
      configSha256: sha256(JSON.stringify(config)),
      imageSha256: sha256(png),
      sourceSha256: "current",
      surface: "tauri-production-ui",
      loadedModel: "ABeautifulGame.glb",
      viewportSha256: "rendered",
      errors: [],
    },
  };
}

test("release gate rejects stale source and modified images", () => {
  const input = evidence();
  assert.doesNotThrow(() => validateCapture(input));
  assert.throws(
    () => validateCapture({ ...input, fingerprint: "edited" }),
    /stale/,
  );
  input.png[100] = 1;
  assert.throws(() => validateCapture(input), /corrupted/);
});

test("release gate rejects different model, dimensions and failed native evidence", () => {
  const input = evidence();
  assert.throws(
    () =>
      validateCapture({
        ...input,
        config: { ...input.config, modelSha256: "replacement" },
      }),
    /model/,
  );
  input.manifest.errors.push("Model load failed");
  assert.throws(() => validateCapture(input), /evidence/);
  input.manifest.errors = [];
  input.png.writeUInt32BE(800, 16);
  input.manifest.imageSha256 = sha256(input.png);
  assert.throws(() => validateCapture(input), /dimensions/);
});
