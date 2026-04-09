/**
 * Smoke tests for the KTX2Loader dynamic import path used by
 * `loadPreviewObject` in src/viewer/loaders.ts.
 *
 * These tests deliberately avoid decoding a real .ktx2 texture because
 * that requires a WebGLRenderer + the Basis transcoder workers, neither
 * of which are available under jsdom. Instead we verify:
 *
 *   1. The dynamic import resolves (proves the loader module and its
 *      dependency graph — ktx-parse, zstddec, etc. — are all reachable
 *      from the bundled `three` package).
 *   2. Constructing KTX2Loader does not throw.
 *   3. `setTranscoderPath` accepts the `/basis/` path we ship under
 *      `public/basis/` and returns the loader instance (fluent API).
 *   4. `dispose` can be called safely on a freshly constructed loader
 *      (this is the same teardown path loaders.ts uses after a load).
 *
 * If any of the above regress (e.g. three.js renames the export, moves
 * the transcoder, or drops the fluent return), this suite catches it
 * before the code path hits real users.
 */

import { describe, it, expect } from "vitest";

describe("KTX2Loader dynamic import smoke", () => {
  it("resolves the dynamic import and exposes KTX2Loader", async () => {
    const mod = await import("three/examples/jsm/loaders/KTX2Loader.js");
    expect(mod.KTX2Loader).toBeDefined();
    expect(typeof mod.KTX2Loader).toBe("function");
  });

  it("constructs without throwing", async () => {
    const { KTX2Loader } = await import(
      "three/examples/jsm/loaders/KTX2Loader.js"
    );
    expect(() => new KTX2Loader()).not.toThrow();
  });

  it("accepts setTranscoderPath('/basis/') and returns itself", async () => {
    const { KTX2Loader } = await import(
      "three/examples/jsm/loaders/KTX2Loader.js"
    );
    const loader = new KTX2Loader();
    const returned = loader.setTranscoderPath("/basis/");
    expect(returned).toBe(loader);
  });

  it("dispose is callable on a freshly constructed loader", async () => {
    const { KTX2Loader } = await import(
      "three/examples/jsm/loaders/KTX2Loader.js"
    );
    const loader = new KTX2Loader();
    loader.setTranscoderPath("/basis/");
    expect(() => loader.dispose()).not.toThrow();
  });
});
