import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AsyncSidebarSection } from "../../lib/sidebarPrimitives";

describe("AsyncSidebarSection", () => {
  it("renders errors before loading or loaded content", () => {
    render(
      <AsyncSidebarSection
        title="Async"
        error="Failed to load."
        data={{ count: 2 }}
        loadingLabel="Loading."
      >
        {(data) => <p>Loaded {data.count}</p>}
      </AsyncSidebarSection>,
    );

    expect(screen.getByText("Failed to load.")).toBeTruthy();
    expect(screen.queryByText("Loaded 2")).toBeNull();
  });

  it("renders loading content while data is absent", () => {
    render(
      <AsyncSidebarSection title="Async" data={null} loadingLabel="Loading.">
        {() => <p>Loaded</p>}
      </AsyncSidebarSection>,
    );

    expect(screen.getByText("Loading.")).toBeTruthy();
    expect(screen.queryByText("Loaded")).toBeNull();
  });

  it("renders loaded content and resolves a count callback", () => {
    render(
      <AsyncSidebarSection
        title="Async"
        data={{ entries: ["one", "two"] }}
        loadingLabel="Loading."
        count={(data) => data.entries.length}
      >
        {(data) => <p>Loaded {data.entries.join(", ")}</p>}
      </AsyncSidebarSection>,
    );

    expect(screen.getByText("Loaded one, two")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });
});
