import { beforeEach, describe, expect, it, vi } from "vitest";
import { clampSidebarWidth, loadUiLayout, saveUiLayout } from "../uiLayout";
beforeEach(() => localStorage.clear());
describe("UI layout persistence", () => {
  it("round trips only layout state", () => {
    saveUiLayout({
      sidebarOpen: false,
      sidebarWidth: 320,
      selectedPercent: 55,
    });
    expect(loadUiLayout()).toMatchObject({
      sidebarOpen: false,
      sidebarWidth: 320,
      selectedPercent: 55,
    });
    expect(
      Object.keys(JSON.parse(localStorage.getItem("yw-look:ui-layout")!)),
    ).toEqual(["schemaVersion", "sidebar", "hierarchy"]);
  });
  it.each(["broken", '{"schemaVersion":0}', '{"schemaVersion":1}'])(
    "discards invalid storage %s",
    (value) => {
      localStorage.setItem("yw-look:ui-layout", value);
      expect(loadUiLayout().selectedPercent).toBe(38);
      expect(localStorage.getItem("yw-look:ui-layout")).toBeNull();
    },
  );
  it("clamps restored values and narrow widths", () => {
    saveUiLayout({
      sidebarOpen: true,
      sidebarWidth: 9999,
      selectedPercent: 99,
    });
    expect(loadUiLayout().selectedPercent).toBe(75);
    expect(clampSidebarWidth(350, 320)).toBe(300);
  });
  it("survives denied storage", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    expect(() =>
      saveUiLayout({
        sidebarOpen: true,
        sidebarWidth: 350,
        selectedPercent: 38,
      }),
    ).not.toThrow();
    spy.mockRestore();
  });
});
