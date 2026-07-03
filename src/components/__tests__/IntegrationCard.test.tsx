import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntegrationCard } from "../IntegrationCard";
import type { IntegrationPayload } from "../../lib/integrations";

function makePayload(
  overrides: Partial<IntegrationPayload> = {},
): IntegrationPayload {
  return {
    fileAssociationsEnabled: true,
    installStrategy: "user",
    supportedExtensions: [".usd", ".usda"],
    ...overrides,
  };
}

describe("IntegrationCard", () => {
  it("renders an error before loaded integration details", () => {
    render(
      <IntegrationCard
        integrationError="Failed to load integration details."
        integrationPayload={makePayload()}
      />,
    );

    expect(
      screen.getByText("Failed to load integration details."),
    ).toBeTruthy();
    expect(screen.queryByText("Install strategy")).toBeNull();
  });

  it("renders a loading state while payload is absent", () => {
    render(
      <IntegrationCard integrationError={null} integrationPayload={null} />,
    );

    expect(
      screen.getByText("Loading Windows integration details."),
    ).toBeTruthy();
  });

  it("renders loaded integration rows and supported extensions", () => {
    render(
      <IntegrationCard
        integrationError={null}
        integrationPayload={makePayload({
          fileAssociationsEnabled: false,
          installStrategy: "portable",
        })}
      />,
    );

    expect(screen.getByText("Install strategy")).toBeTruthy();
    expect(screen.getByText("portable")).toBeTruthy();
    expect(screen.getByText("File associations")).toBeTruthy();
    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.getByText(".usd")).toBeTruthy();
    expect(screen.getByText(".usda")).toBeTruthy();
  });
});
