import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDebugPanelFixtures } from "../useDebugPanelFixtures";

describe("useDebugPanelFixtures", () => {
  it("stays inactive when debug panels are disabled", () => {
    const { result } = renderHook(() => useDebugPanelFixtures(false));

    expect(result.current.useDebugFixtures).toBe(false);
    expect(result.current.debugFixtures).toBeNull();
  });

  it("loads debug panel fixtures when enabled in dev", async () => {
    const { result } = renderHook(() => useDebugPanelFixtures(true));

    await waitFor(() => {
      expect(result.current.useDebugFixtures).toBe(true);
    });
    expect(result.current.debugFixtures?.debugPanelFile.fileName).toBe(
      "yw-look-brushup-sample.glb",
    );
  });
});
