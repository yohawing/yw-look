import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

// Hash content, not HEAD: committing the generated image must not invalidate it.
// Normalize Git text files for Windows capture / Linux release checks.
export function sourceFingerprint(root) {
  const files = execFileSync(
    "git",
    ["ls-files", "-co", "--exclude-standard", "-z"],
    {
      cwd: root,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean);
  const inputs = [...new Set(files)]
    .filter((file) =>
      /^(src\/|src-tauri\/|public\/|scripts\/readme-screenshot|package(?:-lock)?\.json$|vite\.config\.ts$|index\.html$)/.test(
        file,
      ),
    )
    .sort();
  const hash = createHash("sha256");
  for (const file of inputs) {
    let bytes = fs.readFileSync(path.join(root, file));
    if (
      /\.(?:tsx?|m?js|json|css|html|rs|toml|lock|md|txt|svg|yml|yaml)$/.test(
        file,
      )
    ) {
      bytes = Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n"));
    }
    hash.update(file).update("\0").update(bytes).update("\0");
  }
  return hash.digest("hex");
}

export function validateCapture({
  manifest,
  config,
  fingerprint,
  png,
  version,
}) {
  if (manifest.schemaVersion !== 1 || manifest.sourceSha256 !== fingerprint) {
    throw new Error(
      "README screenshot is stale. Run npm run readme:screenshot and commit hero.png + hero.capture.json.",
    );
  }
  if (
    manifest.version !== version ||
    manifest.modelSha256 !== config.modelSha256 ||
    manifest.configSha256 !== sha256(JSON.stringify(config))
  ) {
    throw new Error("README screenshot version/model/config does not match.");
  }
  if (
    manifest.imageSha256 !== sha256(png) ||
    !png
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    png.length < 50_000 ||
    png.readUInt32BE(16) !== config.width ||
    png.readUInt32BE(20) !== config.height
  ) {
    throw new Error(
      `README screenshot is missing, corrupted, or has incorrect dimensions (${png.readUInt32BE(16)}x${png.readUInt32BE(20)}; expected ${config.width}x${config.height}).`,
    );
  }
  if (
    manifest.surface !== "tauri-production-ui" ||
    !manifest.loadedModel ||
    manifest.errors?.length !== 0 ||
    !manifest.viewportSha256
  ) {
    throw new Error(
      "README screenshot has no successful native capture evidence.",
    );
  }
}
