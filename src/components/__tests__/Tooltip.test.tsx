import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Tooltip } from "../ui/Tooltip";

describe("Tooltip", () => {
  afterEach(() => {
    cleanup();
  });

  it("links the trigger to the tooltip content", () => {
    const { getByRole } = render(
      <Tooltip content="Show details">
        <button type="button">Details</button>
      </Tooltip>,
    );

    const trigger = getByRole("button", { name: "Details" });
    const tooltip = getByRole("tooltip");

    expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(tooltip.textContent).toBe("Show details");
  });

  it("preserves an existing aria-describedby value", () => {
    const { getByRole } = render(
      <Tooltip content="Show details">
        <button aria-describedby="existing-help" type="button">
          Details
        </button>
      </Tooltip>,
    );

    const trigger = getByRole("button", { name: "Details" });
    const tooltip = getByRole("tooltip");

    expect(trigger.getAttribute("aria-describedby")).toBe(
      `existing-help ${tooltip.id}`,
    );
  });

  it("omits content and trigger wiring when disabled", () => {
    const { getByRole, queryByRole } = render(
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
