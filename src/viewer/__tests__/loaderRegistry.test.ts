import { describe, expect, it } from "vitest";
import { LoaderRegistry, type FormatPack } from "../loaderRegistry";

function makePack(overrides: Partial<FormatPack> = {}): FormatPack {
  return {
    id: "test-pack",
    name: "Test Pack",
    extensions: ["one"],
    loadPreviewObject: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}

describe("LoaderRegistry", () => {
  it("registers a format pack by extension and id", () => {
    const registry = new LoaderRegistry();
    const pack = makePack({ extensions: ["ONE", "two"] });

    registry.register(pack);

    expect(registry.getByExtension("one")).toBe(pack);
    expect(registry.getByExtension("TWO")).toBe(pack);
    expect(registry.getById("test-pack")).toBe(pack);
  });

  it("lists packs once and loader entries per extension", () => {
    const registry = new LoaderRegistry();
    registry.register(makePack({ extensions: ["one", "two"] }));

    expect(registry.listPacks().map((pack) => pack.id)).toEqual(["test-pack"]);
    expect(registry.list().map((loader) => loader.extension)).toEqual([
      "one",
      "two",
    ]);
  });

  it("rejects duplicate extensions", () => {
    const registry = new LoaderRegistry();
    registry.register(makePack({ id: "one", extensions: ["usd"] }));

    expect(() =>
      registry.register(makePack({ id: "two", extensions: ["USD"] })),
    ).toThrow("Loader already registered for .usd");
  });

  it("rejects duplicate pack ids", () => {
    const registry = new LoaderRegistry();
    registry.register(makePack({ id: "pack", extensions: ["one"] }));

    expect(() =>
      registry.register(makePack({ id: "pack", extensions: ["two"] })),
    ).toThrow("Loader pack already registered: pack");
  });

  it("keeps optional hooks available on the registered pack", () => {
    const registry = new LoaderRegistry();
    const runtime = {
      dispose: () => {},
    };
    const pack = makePack({
      createRuntime: () => runtime,
    });

    registry.register(pack);

    expect(registry.getById("test-pack")?.createRuntime).toBe(
      pack.createRuntime,
    );
  });
});
