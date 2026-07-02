import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsdPrimPropertyPanel } from "../UsdPrimPropertyPanel";
import { inspectPrim } from "../../lib/usd";
import { useViewerStore } from "../../stores/viewerStore";

vi.mock("../../lib/usd", () => ({
  inspectAttributeTimeSamples: vi.fn(),
  inspectPrim: vi.fn(),
}));

describe("UsdPrimPropertyPanel", () => {
  afterEach(() => {
    cleanup();
    useViewerStore.setState({ selectedUsdPrimPath: null });
    vi.mocked(inspectPrim).mockReset();
  });

  it("shows prim inspection error details inline", async () => {
    vi.mocked(inspectPrim).mockRejectedValue(
      new Error("Backend failed to inspect /World/Hero."),
    );
    useViewerStore.setState({ selectedUsdPrimPath: "/World/Hero" });

    const { getByText } = render(
      <UsdPrimPropertyPanel path="F:\\assets\\scene.usda" />,
    );

    await waitFor(() => {
      expect(
        getByText(
          "Prim inspection failed: Backend failed to inspect /World/Hero.",
        ),
      ).toBeTruthy();
    });
  });
});
