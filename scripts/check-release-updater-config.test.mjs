import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  OFFICIAL_ENDPOINT,
  validateCompiledConfiguration,
  checkReleaseConfiguration,
} from "./check-release-updater-config.mjs";

const expected = { version: "0.3.3", publicKey: "public-key" };
const valid = {
  ...expected,
  debugBuild: false,
  source: "compile-time environment",
  endpoint: OFFICIAL_ENDPOINT,
};

test("only the expected release binary configuration passes", () => {
  assert.deepEqual(validateCompiledConfiguration(valid, expected), []);
  for (const mutation of [
    { version: "0.3.2" },
    { debugBuild: true },
    { source: "settings override" },
    { endpoint: null },
    { endpoint: "http://localhost/latest.json" },
    { endpoint: `${OFFICIAL_ENDPOINT}.invalid` },
    { publicKey: null },
    { publicKey: "wrong-key" },
  ]) {
    assert.ok(
      validateCompiledConfiguration({ ...valid, ...mutation }, expected)
        .length > 0,
    );
  }
  assert.ok(validateCompiledConfiguration(null, expected).length > 0);
});

test("manifest verification cannot be silently omitted or redirected", () => {
  for (const args of [
    [],
    ["--binary", "file"],
    ["--binary", "--config-only"],
    ["--binary", "file", "--config-only", "--manifest", "manifest.json"],
    ["--binary", "file", "--url", "https://example.org/latest.json"],
  ])
    assert.throws(() => checkReleaseConfiguration(args));
});

test("manifest gate accepts Windows-only releases but rejects a stale version", () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "yw-look-updater-manifest-"),
  );
  try {
    const file = path.join(temp, "latest.json");
    const entry = {
      url: "https://example.org/installer.exe",
      signature: "test",
    };
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: "0.3.2",
        platforms: {
          "windows-x86_64": entry,
          "windows-x86_64-nsis": entry,
        },
      }),
    );
    const args = [
      "scripts/check-release-updater-manifest.mjs",
      "--manifest",
      file,
      "--skip-url-check",
      "--expected-version",
    ];
    assert.throws(() =>
      execFileSync(process.execPath, [...args, "0.3.3"], { stdio: "pipe" }),
    );
    assert.match(
      execFileSync(process.execPath, [...args, "0.3.2"], { encoding: "utf8" }),
      /ok/,
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("release workflow publishes only after verification and manifest repair", () => {
  const workflow = fs.readFileSync(".github/workflows/release.yml", "utf8");
  const draft = workflow.indexOf("releaseDraft: true");
  const verify = workflow.indexOf(
    "Verify compiled official updater configuration",
  );
  const patch = workflow.indexOf("patch-updater-manifest:");
  const publish = workflow.indexOf("publish-release:");
  assert.ok(draft >= 0, "tauri-action must upload a draft release");
  assert.doesNotMatch(workflow, /releaseDraft:\s*false/);
  assert.ok(draft < verify && verify < patch && patch < publish);
  assert.match(
    workflow.slice(patch, publish),
    /gh release view "\$TAG" --json assets[\s\S]*artifact is missing from the draft release[\s\S]*--skip-url-check/,
  );
  assert.match(
    workflow.slice(publish),
    /needs:\s*patch-updater-manifest[\s\S]*gh release edit "\$TAG" --draft=false/,
  );
});
