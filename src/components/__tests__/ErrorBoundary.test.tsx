import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ErrorBoundary } from "../ErrorBoundary";

vi.mock("../../lib/runtimeLogging", () => ({
  logFrontendFatal: vi.fn(),
}));

vi.mock("../../lib/diagnostics", () => ({
  openAppLogDir: vi.fn(),
}));

function BrokenChild(): null {
  throw new Error("render exploded");
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders a recoverable fatal-error screen instead of a blank tree", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { getByRole, getByText } = render(
      <ErrorBoundary>
        <BrokenChild />
      </ErrorBoundary>,
    );

    expect(getByRole("alert")).toBeTruthy();
    expect(getByText("yw-look hit a render error.")).toBeTruthy();
    expect(getByText("render exploded", { exact: false })).toBeTruthy();
    expect(getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(getByRole("button", { name: "Copy Details" })).toBeTruthy();
    expect(getByRole("button", { name: "Open Logs" })).toBeTruthy();
  });
});
