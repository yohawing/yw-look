import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const updateSnapshot = args.includes("--update-snapshot");
const positionalArgs = args.filter((arg) => arg !== "--update-snapshot");
const url = positionalArgs[0] ?? "http://127.0.0.1:1420/?entry=selftest";
const snapshotPath =
  positionalArgs[1] ??
  "tests/visual/snapshots/selftest-page-linux-chromium.png";
const actualPath =
  positionalArgs[2] ?? "artifacts/screenshots/selftest-page-current.png";

let screenshotBuffer;
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const outputText =
      globalThis.document?.getElementById("output")?.textContent ?? "";
    return (
      outputText.includes('"failedCount"') || outputText.includes('"fatal"')
    );
  });

  screenshotBuffer = await page.screenshot({ fullPage: true });
} catch (error) {
  console.error(
    `Failed to run visual regression: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
} finally {
  await browser?.close();
}

await mkdir(path.dirname(actualPath), { recursive: true });
await writeFile(actualPath, screenshotBuffer);

if (updateSnapshot) {
  await mkdir(path.dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, screenshotBuffer);
  console.log(`Updated snapshot: ${snapshotPath}`);
  process.exit(0);
}

let expectedBuffer;
try {
  expectedBuffer = await readFile(snapshotPath);
} catch {
  console.error(
    `Snapshot not found at ${snapshotPath}. Run with --update-snapshot first.`,
  );
  process.exit(1);
}

if (Buffer.compare(screenshotBuffer, expectedBuffer) !== 0) {
  const expectedHash = createHash("sha256")
    .update(expectedBuffer)
    .digest("hex");
  const currentHash = createHash("sha256")
    .update(screenshotBuffer)
    .digest("hex");
  console.error("Visual regression detected.");
  console.error(`expected sha256: ${expectedHash}`);
  console.error(`current  sha256: ${currentHash}`);
  console.error(`actual image: ${actualPath}`);
  process.exit(1);
}

console.log("Visual snapshot matched.");
