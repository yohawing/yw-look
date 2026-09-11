import { describe, expect, it } from "vitest";
import { loadIfcPreviewObject } from "../loaderUnavailable";

describe("unavailable IFC loader", () => {
  it("reports an actionable optional dependency message", async () => {
    await expect(
      loadIfcPreviewObject({} as never, {} as never),
    ).rejects.toThrow(
      "CAD Loader Pack (@thatopen/fragments + web-ifc) is not installed",
    );
  });
});
