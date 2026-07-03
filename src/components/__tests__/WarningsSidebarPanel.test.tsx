import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { WarningsSidebarPanel } from "../WarningsSidebarPanel";
import { useViewerStore } from "../../stores/viewerStore";
import { requestViewportScaleNormalizationCancel } from "../../viewport/viewportCommands";

vi.mock("../../viewport/viewportCommands", () => ({
  requestViewportScaleNormalizationCancel: vi.fn(() => true),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useViewerStore.setState({
    resourceDiagnostics: null,
    scaleNormalization: { applied: true, factor: 2 },
  });
});

afterEach(() => {
  cleanup();
});

describe("WarningsSidebarPanel", () => {
  it("requests scale-normalization cancellation", () => {
    const { getByRole } = render(<WarningsSidebarPanel warnings={[]} />);

    fireEvent.click(getByRole("button", { name: /cancel scale normalize/i }));

    expect(requestViewportScaleNormalizationCancel).toHaveBeenCalledTimes(1);
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
