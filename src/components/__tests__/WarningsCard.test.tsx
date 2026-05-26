import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
