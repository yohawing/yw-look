import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:1420/selftest.html";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on("console", (message) => {
  console.log(`[browser:${message.type()}] ${message.text()}`);
});

await page.goto(url, { waitUntil: "networkidle" });
await page.locator("#output").waitFor();
await page.waitForTimeout(500);

const content = await page.locator("#output").textContent();
console.log(content ?? "");

await browser.close();
