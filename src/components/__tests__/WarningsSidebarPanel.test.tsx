import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { WarningsSidebarPanel } from "../WarningsSidebarPanel";
import { useViewerStore } from "../../stores/viewerStore";

beforeEach(() => {
  useViewerStore.setState({
    cancelScaleNormalizeVersion: 0,
    resourceDiagnostics: null,
    scaleNormalization: { applied: true, factor: 2 },
  });
});

afterEach(() => {
  cleanup();
});

describe("WarningsSidebarPanel", () => {
  it("increments the scale-normalization cancel command", () => {
    const { getByRole } = render(<WarningsSidebarPanel warnings={[]} />);

    fireEvent.click(getByRole("button", { name: /cancel scale normalize/i }));

    expect(useViewerStore.getState().cancelScaleNormalizeVersion).toBe(1);
  });

  it("hides the scale-normalization action when normalization is inactive", () => {
    useViewerStore.setState({
      scaleNormalization: null,
    });

    const { queryByRole } = render(<WarningsSidebarPanel warnings={[]} />);

    expect(
      queryByRole("button", { name: /cancel scale normalize/i }),
    ).toBeNull();
  });
});
