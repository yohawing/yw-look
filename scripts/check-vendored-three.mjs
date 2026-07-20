#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function main() {
  const threePackage = JSON.parse(
    await readFile(
      path.join(repoRoot, "node_modules/three/package.json"),
      "utf8",
    ),
  );
  const vendoredLoader = await readFile(
    path.join(repoRoot, "src/vendor/FBXLoaderPatched.js"),
    "utf8",
  );
  const snapshotMatch = vendoredLoader.match(
    /^\/\/ Vendored from three\/examples\/jsm\/loaders\/FBXLoader\.js in three (\d+\.\d+\.\d+)\./m,
  );

  if (!snapshotMatch) {
    throw new Error(
      "FBXLoaderPatched.js is missing its vendored three version header.",
    );
  }

  const installedVersion = threePackage.version;
  const snapshotVersion = snapshotMatch[1];
  if (snapshotVersion !== installedVersion) {
    throw new Error(
      `Vendored FBXLoader drifted from installed three: snapshot=${snapshotVersion}, installed=${installedVersion}. ` +
        "Re-vendor node_modules/three/examples/jsm/loaders/FBXLoader.js and reapply the documented local patches.",
    );
  }

  console.log(`vendored FBXLoader matches three ${installedVersion}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
