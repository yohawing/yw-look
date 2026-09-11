import { describe, expect, it } from "vitest";
import { clampSidebarWidth } from "../uiLayout";
describe("sidebar width", () => {
  it("keeps narrow windows usable without exceeding the viewport", () => {
    expect(clampSidebarWidth(350, 320)).toBe(300);
    expect(clampSidebarWidth(350, 200)).toBe(200);
    expect(clampSidebarWidth(350, 0)).toBe(0);
  });
  it("bounds dragged widths and handles non-finite input", () => {
    expect(clampSidebarWidth(-100, 1200)).toBe(300);
    expect(clampSidebarWidth(9999, 1200)).toBe(560);
    expect(clampSidebarWidth(NaN, 1200)).toBe(350);
  });
});
