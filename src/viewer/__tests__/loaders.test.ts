/**
 * Unit tests for pure helper functions in src/viewer/loaders.ts.
 *
 * The full `loadPreviewObject` function is NOT tested here because it
 * requires Three.js WebGL context, Tauri IPC, and real binary assets —
 * none of which are available in jsdom. Instead we test the pure
 * utilities that are exported with the @internal tag.
 */

import { describe, it, expect } from "vitest";
import {
  loaderRegistry,
  listOptionalLoaderPacks,
  listRegisteredLoaders,
  summarizeOptionalLoaderPacks,
  getPreviewSupportState,
  incompatibleOptionalLoaderPackIds,
} from "../loaders";
import {
  formatDisabledOptionalLoaderMessage,
  formatIncompatibleOptionalLoaderMessage,
  formatMissingOptionalLoaderMessage,
  formatUnsupportedFormatMessage,
} from "../types";

// ---------------------------------------------------------------------------
// preview support classification
// ---------------------------------------------------------------------------

describe("preview support classification", () => {
  it("registers existing core preview formats through the loader registry", () => {
    const extensions = new Set(
      listRegisteredLoaders().map((loader) => loader.extension),
    );

    expect(extensions.has("glb")).toBe(true);
    expect(extensions.has("gltf")).toBe(true);
    expect(extensions.has("vrm")).toBe(true);
    expect(extensions.has("obj")).toBe(true);
    expect(extensions.has("usdz")).toBe(true);
    expect(extensions.has("abc")).toBe(true);
    expect(extensions.has("ktx2")).toBe(true);
  });

  it("exposes registered format packs by id", () => {
    expect(loaderRegistry.getById("core-preview-loader")?.extensions).toEqual(
      expect.arrayContaining(["glb", "gltf"]),
    );
    expect(loaderRegistry.getById("mmd-loader-pack")?.extensions).toEqual([
      "pmx",
      "pmd",
      "vmd",
    ]);
    expect(loaderRegistry.listPacks().map((pack) => pack.id)).toEqual([
      "core-preview-loader",
      "gaussian-splat-loader-pack",
      "ifc-loader-pack",
      "mmd-loader-pack",
      "vrm-loader-pack",
    ]);
  });

  it("classifies implemented core loaders separately from optional packs", () => {
    expect(getPreviewSupportState("glb")).toBe("implemented");
    expect(getPreviewSupportState("vrm")).toBe("implemented");
    expect(getPreviewSupportState("abc")).toBe("implemented");
    expect(getPreviewSupportState("vrma")).toBe("missingOptionalLoader");
  });

  it("marks MMD model and motion formats as implemented", () => {
    expect(getPreviewSupportState("pmx")).toBe("implemented");
    expect(getPreviewSupportState("pmd")).toBe("implemented");
    expect(getPreviewSupportState("vmd")).toBe("implemented");
  });

  it("marks IFC as implemented only while its optional pack is available", () => {
    expect(getPreviewSupportState("ifc")).toBe("implemented");
    expect(
      getPreviewSupportState("ifc", { optionalLoaderInstalled: false }),
    ).toBe("missingOptionalLoader");
    expect(
      getPreviewSupportState("ifc", {
        disabledOptionalLoaderPackIds: ["ifc-loader-pack"],
      }),
    ).toBe("disabledOptionalLoader");
  });

  it("marks optional MMD formats as missing when the pack is absent", () => {
    expect(
      getPreviewSupportState("pmx", { optionalLoaderInstalled: false }),
    ).toBe("missingOptionalLoader");
    expect(
      getPreviewSupportState("pmd", { optionalLoaderInstalled: false }),
    ).toBe("missingOptionalLoader");
    expect(
      getPreviewSupportState("vmd", { optionalLoaderInstalled: false }),
    ).toBe("missingOptionalLoader");
  });

  it("marks optional formats as disabled when their pack is disabled", () => {
    expect(
      getPreviewSupportState("pmx", {
        disabledOptionalLoaderPackIds: ["mmd-loader-pack"],
      }),
    ).toBe("disabledOptionalLoader");
    expect(
      getPreviewSupportState("glb", {
        disabledOptionalLoaderPackIds: ["core-preview-loader"],
      }),
    ).toBe("implemented");
  });

  it("marks optional formats as incompatible when their pack manifest is incompatible", () => {
    expect(
      getPreviewSupportState("pmx", {
        incompatibleOptionalLoaderPackIds: ["mmd-loader-pack"],
      }),
    ).toBe("incompatibleOptionalLoader");
  });

  it("prioritizes missing optional packs over stale disabled settings", () => {
    expect(
      getPreviewSupportState("pmx", {
        disabledOptionalLoaderPackIds: ["mmd-loader-pack"],
        optionalLoaderInstalled: false,
      }),
    ).toBe("missingOptionalLoader");
  });

  it("marks the bundled VRM loader pack as optional but installed", () => {
    expect(
      listRegisteredLoaders().find((loader) => loader.extension === "vrm"),
    ).toMatchObject({
      id: "vrm-loader-pack",
      name: "VRM Loader Pack",
      optional: true,
      installed: true,
    });
  });

  it("registers the bundled MMD loader pack for static model preview", () => {
    expect(
      listRegisteredLoaders().find((loader) => loader.extension === "pmx"),
    ).toMatchObject({
      id: "mmd-loader-pack",
      name: "MMD Loader Pack",
      optional: true,
      installed: true,
    });
    expect(
      listRegisteredLoaders().find((loader) => loader.extension === "pmd"),
    ).toMatchObject({
      id: "mmd-loader-pack",
      name: "MMD Loader Pack",
      optional: true,
      installed: true,
    });
  });

  it("registers the bundled Gaussian splat loader pack formats", () => {
    const splatLoaders = listRegisteredLoaders().filter(
      (loader) => loader.id === "gaussian-splat-loader-pack",
    );

    expect(splatLoaders.map((loader) => loader.extension).sort()).toEqual([
      "ksplat",
      "sog",
      "splat",
      "spz",
    ]);
    expect(getPreviewSupportState("sog")).toBe("implemented");
    expect(
      getPreviewSupportState("sog", { optionalLoaderInstalled: false }),
    ).toBe("missingOptionalLoader");
  });

  it("summarizes optional loader packs for Settings reporting", () => {
    expect(listOptionalLoaderPacks()).toEqual([
      {
        id: "gaussian-splat-loader-pack",
        name: "Gaussian Splat Loader Pack",
        extensions: ["ksplat", "sog", "splat", "spz"],
        installed: true,
        enabled: true,
        manifestInstalled: false,
        runtimeAvailable: true,
        version: undefined,
        compatibility: {
          state: "bundled",
          label: "Bundled runtime",
          detail:
            "The loader is bundled with this build but has no managed manifest.",
        },
      },
      {
        id: "ifc-loader-pack",
        name: "IFC Loader Pack",
        extensions: ["ifc"],
        installed: true,
        enabled: true,
        manifestInstalled: false,
        runtimeAvailable: true,
        version: undefined,
        compatibility: {
          state: "bundled",
          label: "Bundled runtime",
          detail:
            "The loader is bundled with this build but has no managed manifest.",
        },
      },
      {
        id: "mmd-loader-pack",
        name: "MMD Loader Pack",
        extensions: ["pmd", "pmx", "vmd"],
        installed: true,
        enabled: true,
        manifestInstalled: false,
        runtimeAvailable: true,
        version: undefined,
        compatibility: {
          state: "bundled",
          label: "Bundled runtime",
          detail:
            "The loader is bundled with this build but has no managed manifest.",
        },
      },
      {
        id: "vrm-loader-pack",
        name: "VRM Loader Pack",
        extensions: ["vrm"],
        installed: true,
        enabled: true,
        manifestInstalled: false,
        runtimeAvailable: true,
        version: undefined,
        compatibility: {
          state: "bundled",
          label: "Bundled runtime",
          detail:
            "The loader is bundled with this build but has no managed manifest.",
        },
      },
    ]);
  });

  it("applies optional loader pack settings to Settings reporting", () => {
    expect(
      listOptionalLoaderPacks({
        "mmd-loader-pack": { enabled: false },
      }).find((pack) => pack.id === "mmd-loader-pack"),
    ).toMatchObject({
      id: "mmd-loader-pack",
      enabled: false,
      installed: true,
      manifestInstalled: false,
      runtimeAvailable: true,
    });
  });

  it("merges optional loader manifests into Settings reporting without changing runtime extensions", () => {
    expect(
      listOptionalLoaderPacks({}, [
        {
          id: "mmd-loader-pack",
          name: "MMD Loader Pack",
          version: "0.2.0",
          minimumAppVersion: "0.1.0",
          maximumAppVersion: null,
          compatibility: {
            state: "compatible",
            message: null,
          },
          extensions: ["pmx", "pmd"],
          entry: "loader.js",
          packPath: "optional-loaders/mmd",
          entryPath: "optional-loaders/mmd/loader.js",
        },
      ]).find((pack) => pack.id === "mmd-loader-pack"),
    ).toMatchObject({
      id: "mmd-loader-pack",
      extensions: ["pmd", "pmx", "vmd"],
      installed: true,
      enabled: true,
      manifestInstalled: true,
      runtimeAvailable: true,
      version: "0.2.0",
      compatibility: {
        state: "compatible",
        label: "Compatible",
        detail: undefined,
      },
    });
  });

  it("does not treat manifest-only packs or extensions as runtime installed", () => {
    expect(
      summarizeOptionalLoaderPacks(
        [
          {
            id: "vrm-loader-pack",
            name: "VRM Loader Pack",
            extension: "vrm",
            optional: true,
            installed: true,
          },
        ],
        {},
        [
          {
            id: "vrm-loader-pack",
            name: "VRM Loader Pack",
            version: "0.2.0",
            minimumAppVersion: "0.1.0",
            maximumAppVersion: null,
            compatibility: {
              state: "compatible",
              message: null,
            },
            extensions: ["vrm", "vrma"],
            entry: "loader.js",
            packPath: "optional-loaders/vrm",
            entryPath: "optional-loaders/vrm/loader.js",
          },
        ],
      ),
    ).toEqual([
      {
        id: "vrm-loader-pack",
        name: "VRM Loader Pack",
        extensions: ["vrm"],
        installed: true,
        enabled: true,
        manifestInstalled: true,
        runtimeAvailable: true,
        version: "0.2.0",
        compatibility: {
          state: "compatible",
          label: "Compatible",
          detail: undefined,
        },
      },
    ]);
  });

  it("reports optional pack compatibility issues for Settings", () => {
    const manifests = [
      {
        id: "mmd-loader-pack",
        name: "MMD Loader Pack",
        version: "9.0.0",
        minimumAppVersion: "9.0.0",
        maximumAppVersion: null,
        compatibility: {
          state: "requiresNewerApp",
          message: "Requires yw-look 9.0.0 or newer. Current version is 0.2.2.",
        },
        extensions: ["pmx"],
        entry: "loader.js",
        packPath: "optional-loaders/mmd",
        entryPath: "optional-loaders/mmd/loader.js",
      },
    ];

    expect(
      summarizeOptionalLoaderPacks(
        [
          {
            id: "mmd-loader-pack",
            name: "MMD Loader Pack",
            extension: "pmx",
            optional: true,
            installed: true,
          },
        ],
        {},
        manifests,
      )[0].compatibility,
    ).toEqual({
      state: "requiresNewerApp",
      label: "App update required",
      detail: "Requires yw-look 9.0.0 or newer. Current version is 0.2.2.",
    });
    expect(
      summarizeOptionalLoaderPacks(
        [
          {
            id: "mmd-loader-pack",
            name: "MMD Loader Pack",
            extension: "pmx",
            optional: true,
            installed: true,
          },
        ],
        {},
        manifests,
      )[0].enabled,
    ).toBe(false);
    expect(incompatibleOptionalLoaderPackIds(manifests)).toEqual([
      "mmd-loader-pack",
    ]);
  });

  it("marks a pack missing when any registered pack extension is missing", () => {
    expect(
      summarizeOptionalLoaderPacks([
        {
          id: "mixed-loader-pack",
          name: "Mixed Loader Pack",
          extension: "one",
          optional: true,
          installed: true,
        },
        {
          id: "mixed-loader-pack",
          name: "Mixed Loader Pack",
          extension: "two",
          optional: true,
          installed: false,
        },
      ]),
    ).toEqual([
      {
        id: "mixed-loader-pack",
        name: "Mixed Loader Pack",
        extensions: ["one", "two"],
        installed: false,
        manifestInstalled: false,
        runtimeAvailable: false,
        enabled: true,
        version: undefined,
        compatibility: {
          state: "runtimeMissing",
          label: "Runtime missing",
          detail:
            "This build does not include the loader runtime for this pack.",
        },
      },
    ]);
  });

  it("keeps unknown extensions in the generic unsupported bucket", () => {
    expect(getPreviewSupportState("assetbundle")).toBe("unsupported");
  });

  it("formats missing optional loader copy without exposing technical details", () => {
    expect(formatMissingOptionalLoaderMessage("vrm")).toEqual({
      title: "VRM Loader Pack is not installed.",
      body: "Install VRM Loader Pack to preview VRM files.",
    });
    expect(formatMissingOptionalLoaderMessage("pmx")).toEqual({
      title: "MMD Loader Pack is not installed.",
      body: "Install MMD Loader Pack to preview PMX files.",
    });
  });

  it("formats disabled optional loader copy without install guidance", () => {
    expect(formatDisabledOptionalLoaderMessage("vrm")).toEqual({
      title: "VRM Loader Pack is disabled.",
      body: "Enable VRM Loader Pack in Settings to preview VRM files.",
    });
  });

  it("formats incompatible optional loader copy without settings guidance", () => {
    expect(formatIncompatibleOptionalLoaderMessage("vrm")).toEqual({
      title: "VRM Loader Pack is not compatible with this app version.",
      body: "Update yw-look or reinstall VRM Loader Pack to preview VRM files.",
    });
  });

  it("formats unsupported extension copy with the attempted extension", () => {
    expect(formatUnsupportedFormatMessage("assetbundle").body).toContain(
      ".assetbundle",
    );
  });

  it("formats unsupported extension copy from registered loader extensions", () => {
    const registeredExtensions = listRegisteredLoaders().map(
      (loader) => loader.extension,
    );
    const message = formatUnsupportedFormatMessage(
      "assetbundle",
      registeredExtensions,
    );

    expect(message.body).toContain("Supported formats include");
    for (const extension of registeredExtensions) {
      expect(message.body).toContain(extension.toUpperCase());
    }
  });
});
