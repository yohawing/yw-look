import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:1420/selftest.html";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on("console", (message) => {
  console.log(`[browser:${message.type()}] ${message.text()}`);
});

await page.goto(url, { waitUntil: "networkidle" });
await page.locator("#output").waitFor();
await page.waitForFunction(() => {
  const content = globalThis.document?.getElementById("output")?.textContent ?? "";
  return content.includes('"failedCount"') || content.includes('"fatal"');
});

const content = await page.locator("#output").textContent();
const outputText = content ?? "";
console.log(outputText);

let parsedOutput;
try {
  parsedOutput = JSON.parse(outputText);
} catch {
  console.error("Selftest output is not valid JSON.");
  process.exitCode = 1;
}

if (parsedOutput && typeof parsedOutput === "object") {
  const hasFatal =
    "fatal" in parsedOutput &&
    typeof parsedOutput.fatal === "string" &&
    parsedOutput.fatal.length > 0;
  const failedCount =
    "failedCount" in parsedOutput && typeof parsedOutput.failedCount === "number"
      ? parsedOutput.failedCount
      : 0;

  if (hasFatal || failedCount > 0) {
    process.exitCode = 1;
  }
}

await browser.close();
