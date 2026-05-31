import { describe, expect, it } from "vitest";
import {
  getSplatFileTypeForExtension,
  shouldApplySplatYDownCorrection,
} from "../loaderInstalled";

describe("Spark loader helpers", () => {
  it.each([
    ["ply", "ply"],
    ["spz", "spz"],
    ["splat", "splat"],
    ["ksplat", "ksplat"],
    ["sog", "pcsogszip"],
  ])("maps .%s to Spark file type %s", (extension, fileType) => {
    expect(getSplatFileTypeForExtension(extension)).toBe(fileType);
  });

  it("keeps SPZ in its native Y-axis orientation", () => {
    expect(shouldApplySplatYDownCorrection("spz")).toBe(false);
    expect(shouldApplySplatYDownCorrection("SPZ")).toBe(false);
  });

  it.each(["ply", "splat", "ksplat", "sog"])(
    "keeps the existing Y-down correction for .%s",
    (extension) => {
      expect(shouldApplySplatYDownCorrection(extension)).toBe(true);
    },
  );
});
