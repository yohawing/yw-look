import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const url = process.argv[2] ?? "http://127.0.0.1:1421/?debugPanels=1";
const stored = () =>
  page.evaluate(() => JSON.parse(localStorage.getItem("yw-look:ui-layout")));
await mkdir("artifacts/ui-layout", { recursive: true });
try {
  await page.goto(url);
  await page.getByRole("tab", { name: "Outliner", exact: true }).click();
  const separator = page.getByRole("separator", {
    name: "Resize outliner details",
  });
  await separator.focus();
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(200);
  const selected = (await stored()).hierarchy.selectedPercent;
  assert.ok(selected > 38);
  const handle = await page.locator(".sidebar-resize-handle").boundingBox();
  await page.mouse.move(handle.x + 3, handle.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle.x - 47, handle.y + 100);
  await page.mouse.up();
  const saved = await stored();
  assert.equal(saved.sidebar.widthPx, 400);
  await page.reload();
  await page.getByRole("tab", { name: "Outliner", exact: true }).click();
  await page.waitForTimeout(300);
  assert.ok(
    Math.abs((await stored()).hierarchy.selectedPercent - selected) < 0.1,
  );
  assert.equal((await page.locator(".sidebar").boundingBox()).width, 400);
  for (const width of [1200, 720, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await page.getByText("0.3.3", { exact: true }).waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.locator(".app-version").count(), 0);
    assert.ok(await page.getByText("Version", { exact: true }).isVisible());
    const overflow = await page
      .locator(".sidebar")
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    assert.equal(overflow, false);
    await page.screenshot({
      path: `artifacts/ui-layout/settings-${width}.png`,
    });
  }
  await page.evaluate(async () => {
    const { useUiStore } = await import("/src/stores/uiStore.ts");
    useUiStore.getState().toggleSidebarOpen();
  });
  assert.equal((await stored()).sidebar.open, false);
  await page.reload();
  assert.equal(await page.locator(".sidebar.is-open").count(), 0);
  console.log(
    "UI layout: resize, reload, closed state, and Settings at 1200/720/320px passed",
  );
} finally {
  await browser.close();
}
