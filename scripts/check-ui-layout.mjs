import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const url = process.argv[2] ?? "http://127.0.0.1:1421/?debugPanels=1";
await mkdir("artifacts/ui-layout", { recursive: true });
try {
  await page.goto(url);
  const layouts = [];
  for (const [tab, label] of [
    ["Outliner", "Resize outliner details"],
    ["Materials", "Resize material details"],
    ["Textures", "Resize texture details"],
  ]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    const separator = page.getByRole("separator", { name: label });
    const box = await separator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 5; step++) {
      await page.mouse.move(
        box.x + box.width / 2,
        box.y + box.height / 2 - step * 15,
      );
      await page.waitForTimeout(30);
      assert.ok(
        Math.abs((await separator.boundingBox()).y - (box.y - step * 15)) < 2,
        `${tab}: continuous drag step ${step}`,
      );
    }
    await page.mouse.up();
    await separator.focus();
    await page.keyboard.press("ArrowDown");
    layouts.push([tab, label, await separator.getAttribute("aria-valuenow")]);
  }
  for (const [tab, label, expected] of layouts) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    assert.equal(
      await page
        .getByRole("separator", { name: label })
        .getAttribute("aria-valuenow"),
      expected,
    );
  }
  const handle = await page.locator(".sidebar-resize-handle").boundingBox();
  await page.mouse.move(handle.x + 3, handle.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle.x - 47, handle.y + 100);
  await page.mouse.up();
  await page.waitForTimeout(300);
  assert.equal((await page.locator(".sidebar").boundingBox()).width, 400);
  for (const width of [1200, 720, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await page.getByText("0.3.3", { exact: true }).waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.locator(".app-version").count(), 0);
    assert.equal(await page.locator(".app-topbar").count(), 0);
    const viewport = await page.locator(".main-content").boundingBox();
    const sidebar = await page.locator(".sidebar").boundingBox();
    const statusbar = await page.locator(".statusbar").boundingBox();
    assert.equal(viewport.y, 0);
    assert.equal(sidebar.y, 0);
    assert.equal(viewport.height, 774);
    assert.equal(statusbar.y, 774);
    assert.equal(statusbar.height, 26);
    assert.ok(await page.getByText("Version", { exact: true }).isVisible());
    const overflow = await page
      .locator(".sidebar")
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    assert.equal(overflow, false);
    await page.screenshot({
      path: `artifacts/ui-layout/settings-${width}.png`,
    });
  }
  await page.locator(".viewport-sidebar-toggle").click();
  await page.locator(".sidebar.is-open").waitFor({ state: "detached" });
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.reload();
  await page.getByRole("tab", { name: "Outliner", exact: true }).click();
  assert.equal((await page.locator(".sidebar").boundingBox()).width, 350);
  assert.equal(
    await page
      .getByRole("separator", { name: "Resize outliner details" })
      .getAttribute("aria-valuenow"),
    "62",
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("yw-look:ui-layout")),
    null,
  );
  console.log(
    "UI layout: continuous drag, tab restoration, restart defaults, and Settings at 1200/720/320px passed",
  );
} finally {
  await browser.close();
}
