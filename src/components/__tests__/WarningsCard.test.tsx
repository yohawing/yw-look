import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WarningsCard } from "../WarningsCard";

describe("WarningsCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders MMD diagnostics as ordinary warnings", () => {
    const { getByText, queryByText } = render(
      <WarningsCard
        warnings={[
          "MMD warning: Unsupported morph types are present. (UNSUPPORTED_MORPH)",
        ]}
      />,
    );

    expect(getByText("Warnings")).toBeTruthy();
    expect(
      getByText(
        "MMD warning: Unsupported morph types are present. (UNSUPPORTED_MORPH)",
      ),
    ).toBeTruthy();
    expect(queryByText("MMD Diagnostics")).toBeNull();
  });

  it("moves scale normalization cancellation into the warning header", () => {
    const onCancel = vi.fn();
    const { container, getByRole } = render(
      <WarningsCard
        warnings={[]}
        scaleNormalizationApplied
        onCancelScaleNormalization={onCancel}
      />,
    );

    fireEvent.click(getByRole("button", { name: "Cancel Scale Normalize" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(container.querySelector("details")?.open).toBe(true);
  });

  it("hides scale normalization cancellation when it is not applicable", () => {
    const { queryByRole } = render(
      <WarningsCard
        warnings={[]}
        scaleNormalizationApplied={false}
        onCancelScaleNormalization={() => undefined}
      />,
    );

    expect(
      queryByRole("button", { name: "Cancel Scale Normalize" }),
    ).toBeNull();
  });
});
