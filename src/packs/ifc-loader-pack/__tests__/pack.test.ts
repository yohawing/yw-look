import { describe, expect, it } from "vitest";
import { ifcLoaderPack } from "../pack";

describe("ifcLoaderPack", () => {
  it("claims IFC as an optional loader pack", () => {
    expect(ifcLoaderPack).toMatchObject({
      id: "ifc-loader-pack",
      name: "IFC Loader Pack",
      extensions: ["ifc"],
      optional: true,
    });
  });
});
