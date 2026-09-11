import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const url = process.argv[2] ?? "http://127.0.0.1:1421/?debugPanels=1";
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const panel = (id) => page.locator(`[data-sidebar-panel="${id}"]`);
const tab = async (name) => {
  await page.getByRole("tab", { name, exact: true }).click();
};
const roundTrip = async (name) => {
  await tab("Settings");
  await tab(name);
};
const scrollAndReturn = async (name, locator) => {
  const before = await locator.evaluate((element) => {
    element.scrollTop = 120;
    element.dispatchEvent(new Event("scroll"));
    return element.scrollTop;
  });
  assert.ok(before > 0, `${name}: fixture must scroll`);
  await roundTrip(name);
  assert.equal(await locator.evaluate((el) => el.scrollTop), before);
};

try {
  await page.goto(url);
  await tab("Outliner");
  const hierarchy = panel("hierarchy");
  const collapse = hierarchy
    .getByRole("button", { name: "Collapse", exact: true })
    .first();
  await collapse.click();
  const rows = await hierarchy.getByRole("treeitem").count();
  await roundTrip("Outliner");
  assert.equal(await hierarchy.getByRole("treeitem").count(), rows);
  await hierarchy
    .getByRole("button", { name: "Search hierarchy", exact: true })
    .click();
  await roundTrip("Outliner");
  const query = hierarchy.getByRole("textbox", { name: "Filter hierarchy" });
  assert.ok(await query.isVisible());
  await query.fill("Hero");
  await roundTrip("Outliner");
  assert.equal(await query.inputValue(), "Hero");

  await tab("Materials");
  const materials = panel("materials");
  await materials.locator(".material-row").nth(1).click();
  const selected = await materials
    .locator(".material-row.is-selected")
    .textContent();
  await roundTrip("Materials");
  assert.equal(
    await materials.locator(".material-row.is-selected").textContent(),
    selected,
  );
  await materials.locator(".material-row").first().click();
  await materials
    .locator("summary")
    .filter({ hasText: "shader inputs" })
    .click();
  const shader = materials
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "shader inputs" }) });
  await roundTrip("Materials");
  assert.ok(await shader.evaluate((el) => el.open));
  await materials
    .getByRole("button", { name: "Search materials", exact: true })
    .click();
  const materialName = await materials
    .locator(".material-name")
    .first()
    .textContent();
  await materials
    .getByRole("textbox", { name: "Filter materials" })
    .fill(materialName);
  await roundTrip("Materials");
  assert.equal(
    await materials
      .getByRole("textbox", { name: "Filter materials" })
      .inputValue(),
    materialName,
  );
  await scrollAndReturn(
    "Materials",
    materials.locator(".material-selected-panel"),
  );

  await tab("Textures");
  const textures = panel("textures");
  const channel = textures.locator(".texture-channel-filter").nth(1);
  await channel.click();
  const channelClass = await channel.getAttribute("class");
  const textureRows = await textures.locator(".texture-row").count();
  await roundTrip("Textures");
  assert.equal(await channel.getAttribute("class"), channelClass);
  assert.equal(await textures.locator(".texture-row").count(), textureRows);
  await textures
    .getByRole("button", { name: "Search textures", exact: true })
    .click();
  const textureName = await textures
    .locator(".texture-row-label")
    .first()
    .textContent();
  await textures
    .getByRole("textbox", { name: "Filter textures" })
    .fill(textureName);
  await roundTrip("Textures");
  assert.equal(
    await textures
      .getByRole("textbox", { name: "Filter textures" })
      .inputValue(),
    textureName,
  );

  await tab("Properties");
  const properties = panel("properties");
  const usd = properties
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: /^USD Details$/ }) })
    .first();
  await usd.locator(":scope > summary").click();
  await roundTrip("Properties");
  assert.ok(await usd.evaluate((el) => el.open));
  await scrollAndReturn("Properties", properties);
  await page.locator(".viewport-sidebar-toggle").click();
  await page.locator(".viewport-sidebar-toggle").click();
  await page.waitForTimeout(300);
  assert.equal((await page.locator(".sidebar").boundingBox()).width, 350);
  assert.ok(await usd.evaluate((el) => el.open));
  assert.deepEqual(errors, []);
  await mkdir("artifacts/ui-state", { recursive: true });
  await page.screenshot({ path: "artifacts/ui-state/sidebar.png" });
  await writeFile(
    "artifacts/ui-state/result.json",
    JSON.stringify(
      {
        passed: true,
        errors,
        checks: [
          "outliner expansion and search",
          "materials selection, search, expansion and scroll",
          "texture channel and search",
          "properties expansion and scroll",
          "sidebar close and reopen",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    "Sidebar state: tab round trips preserve expansion, search, selection, channel and scroll",
  );
} finally {
  await browser.close();
}
