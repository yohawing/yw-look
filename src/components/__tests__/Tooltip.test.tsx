import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Tooltip, TooltipProvider } from "../ui/Tooltip";

function renderWithTooltipProvider(ui: ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("Tooltip", () => {
  afterEach(() => {
    cleanup();
  });

  it("links the trigger to the tooltip content", async () => {
    const { findByRole, getByRole } = renderWithTooltipProvider(
      <Tooltip content="Show details">
        <button type="button">Details</button>
      </Tooltip>,
    );

    const trigger = getByRole("button", { name: "Details" });
    fireEvent.pointerMove(trigger, { pointerType: "mouse" });
    const tooltip = await findByRole("tooltip");

    expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(tooltip.textContent).toBe("Show details");
  });

  it("preserves an existing aria-describedby value", async () => {
    const { findByRole, getByRole } = renderWithTooltipProvider(
      <Tooltip content="Show details">
        <button aria-describedby="existing-help" type="button">
          Details
        </button>
      </Tooltip>,
    );

    const trigger = getByRole("button", { name: "Details" });
    fireEvent.pointerMove(trigger, { pointerType: "mouse" });
    const tooltip = await findByRole("tooltip");

    expect(trigger.getAttribute("aria-describedby")).toBe("existing-help");
    expect(tooltip.textContent).toBe("Show details");
  });

  it("omits content and trigger wiring when disabled", () => {
    const { getByRole, queryByRole } = renderWithTooltipProvider(
      <Tooltip content="Show details" disabled>
        <button type="button">Details</button>
      </Tooltip>,
    );

    expect(
      getByRole("button", { name: "Details" }).getAttribute("aria-describedby"),
    ).toBeNull();
    expect(queryByRole("tooltip")).toBeNull();
  });
});
