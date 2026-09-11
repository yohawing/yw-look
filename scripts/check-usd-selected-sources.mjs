import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 350, height: 800 } });
const origin = process.argv[2] ?? "http://127.0.0.1:1421";
try {
  await page.route("**/__selected-test.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><head><link rel="stylesheet" href="/src/styles/design-system.css"><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root" style="height:100vh;display:flex;flex-direction:column"></div></body></html>`,
    }),
  );
  await page.goto(`${origin}/__selected-test.html`);
  await page.evaluate(async () => {
    globalThis.localStorage.setItem(
      "yw-look:ui-layout",
      JSON.stringify({
        schemaVersion: 1,
        sidebar: { open: true, widthPx: 350 },
        hierarchy: { selectedPercent: 75 },
      }),
    );
    const { default: RefreshRuntime } = await import("/@react-refresh");
    RefreshRuntime.injectIntoGlobalHook(globalThis);
    globalThis.$RefreshReg$ = () => {};
    globalThis.$RefreshSig$ = () => (type) => type;
    globalThis.__vite_plugin_react_preamble_installed__ = true;
    const { default: React } =
      await import("/node_modules/.vite/deps/react.js");
    const { default: ReactDOM } =
      await import("/node_modules/.vite/deps/react-dom_client.js");
    const { HierarchySidebarPanel } =
      await import("/src/components/HierarchySidebarPanel.tsx");
    const { useFileStore } = await import("/src/stores/fileStore.ts");
    const { useViewerStore } = await import("/src/stores/viewerStore.ts");
    const file = {
      path: "F:/assets/scene.usda",
      fileName: "scene.usda",
      extension: "usda",
      kind: "model",
      parentDirectory: "F:/assets",
    };
    useFileStore.setState({
      currentFile: file,
      assetMetadata: {
        hierarchy: [
          {
            name: "Hero",
            kind: "Xform",
            primPath: "/World/Hero",
            children: [],
          },
          {
            name: "Props",
            kind: "Xform",
            primPath: "/World/Props",
            children: [],
          },
        ],
        objectInfo: {},
      },
    });
    useViewerStore.setState({ selectedMeshName: "/World/Hero" });
    const inspection = {
      path: file.path,
      references: [
        {
          sourcePrim: "/World/Hero",
          assetPath: "hero.usda",
          targetPrim: "/Hero",
          state: "loaded",
        },
        {
          sourcePrim: "/World/Props",
          assetPath: "props.usda",
          targetPrim: "/Props",
          state: "missing",
        },
      ],
      payloads: [
        {
          sourcePrim: "/World/Hero",
          assetPath: "hero-detail.usda",
          targetPrim: "/Detail",
          state: "loaded",
        },
      ],
    };
    ReactDOM.createRoot(globalThis.document.getElementById("root")).render(
      React.createElement(HierarchySidebarPanel, {
        inspection,
        stageSessionHandle: 42,
        payloadPrimPaths: new Set(["/World/Hero"]),
        unloadedPayloadPaths: new Set(["/World/Hero"]),
        onLoadPayload: async () => {},
        onUnloadPayload: async () => {},
      }),
    );
  });
  const selected = page.locator("#hierarchy-selected");
  await selected.getByText("hero.usda", { exact: true }).waitFor();
  assert.ok(await selected.getByText("unloaded", { exact: true }).isVisible());
  assert.equal(
    await page.getByText("Advanced: Composition Arcs", { exact: true }).count(),
    0,
  );
  await mkdir("artifacts/ui-selected-sources", { recursive: true });
  await selected
    .getByText("hero-detail.usda", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/ui-selected-sources/hero.png" });
  await page.locator(".tree-row").filter({ hasText: "Props" }).click();
  await selected.getByText("props.usda", { exact: true }).waitFor();
  assert.equal(
    await selected.getByText("hero.usda", { exact: true }).count(),
    0,
  );
  assert.ok(await selected.getByText("missing", { exact: true }).isVisible());
  await page.screenshot({ path: "artifacts/ui-selected-sources/props.png" });
  console.log(
    "Selected sources browser fixture: selected-only references/payloads, session state and selection switch passed",
  );
} finally {
  await browser.close();
}
