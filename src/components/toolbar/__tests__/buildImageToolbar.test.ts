import { describe, expect, it, vi } from "vitest";
import { buildImageToolbar } from "../buildImageToolbar";
import type { BuildImageToolbarOptions } from "../../../types/viewer";

function createOptions(
  overrides: Partial<BuildImageToolbarOptions> = {},
): BuildImageToolbarOptions {
  return {
    channelMode: "rgba",
    channelOptions: [{ id: "rgba", label: "RGBA" }],
    colorSpace: "srgb",
    exposure: 1.25,
    bgMode: "checker",
    onSelectBgMode: vi.fn(),
    tilingMode: "fit",
    onSelectTilingMode: vi.fn(),
    tileCount: 1,
    onSelectChannel: vi.fn(),
    onSelectColorSpace: vi.fn(),
    ...overrides,
  };
}

describe("buildImageToolbar", () => {
  it("renders exposure as read-only status instead of a disabled action", () => {
    const color = buildImageToolbar(createOptions()).find(
      (item) => item.kind !== "separator" && item.id === "color",
    );

    expect(color?.kind).toBe("popover");
    const exposure =
      color?.kind === "popover"
        ? color.children?.find(
            (item) => item.kind !== "separator" && item.id === "color-exposure",
          )
        : null;

    expect(exposure).toEqual({
      id: "color-exposure",
      mode: "image",
      group: "color",
      kind: "status",
      label: "Exposure: 1.3",
    });
  });
});
