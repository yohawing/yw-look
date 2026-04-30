/**
 * Smoke tests for the USD source view (#39 — initial).
 *
 * The card is wired up against `loadUsdSource`, which goes through a
 * Tauri invoke that the global setup mocks to resolve to `null`. We
 * therefore verify shape (which assets show the card, what the
 * default closed state looks like) rather than the full async load
 * cycle — that path is exercised end-to-end by the manual viewer
 * once the fork-side `flatten_stage` API is in place.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { UsdSourceCard } from "../UsdSourceCard";
import type { SelectedFile } from "../../lib/files";

vi.mock("../../lib/usd", () => ({
  // The card consumes `loadUsdSource` only — the rest of `lib/usd`
  // is unused in this test file.
  loadUsdSource: vi.fn(async () => ({
    kind: "text" as const,
    source: 'string greeting = "class def" # comment',
  })),
}));

function makeFile(extension: string): SelectedFile {
  return {
    path: `/tmp/asset.${extension}`,
    fileName: `asset.${extension}`,
    extension,
    kind: "model",
    parentDirectory: "/tmp",
  };
}

describe("UsdSourceCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when no file is open", () => {
    const { container } = render(<UsdSourceCard currentFile={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for non-USD assets", () => {
    const { container } = render(
      <UsdSourceCard currentFile={makeFile("glb")} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it.each(["usda", "usd", "usdc", "usdz"] as const)(
    "exposes a Show button for .%s",
    (ext) => {
      const { container, getByRole } = render(
        <UsdSourceCard currentFile={makeFile(ext)} />,
      );
      expect(container.querySelector(".card-title")?.textContent).toBe(
        "USD Source",
      );
      expect(getByRole("button").textContent).toBe("Show");
    },
  );

  it("highlights string contents without re-tokenizing the span markup", async () => {
    // Codex P2 regression: an earlier highlighter ran the keyword pass
    // over its own `<span class="usd-string">...` output, so a line
    // like `string greeting = "class def"` corrupted the markup
    // because `class` would be re-wrapped as a keyword. With a
    // single-pass tokenizer the literal `class def` inside the quoted
    // string must stay verbatim, with no nested span attributes.
    const { container, getByRole } = render(
      <UsdSourceCard currentFile={makeFile("usda")} />,
    );
    await act(async () => {
      getByRole("button").click();
    });
    const pre = container.querySelector(".usd-source");
    expect(pre).not.toBeNull();
    const html = pre!.innerHTML;
    // The quoted body is wrapped in exactly one span (the
    // string-token wrapper). It must not contain nested
    // `usd-keyword` markup that would have come from a second pass.
    expect(html).toContain('<span class="usd-string">"class def"</span>');
    expect(html).not.toContain('"<span class="usd-keyword">class</span>');
    // The leading `string` token (a TYPE) and the trailing comment
    // are still highlighted — confirms the tokenizer dispatches
    // each branch correctly.
    expect(html).toContain('<span class="usd-type">string</span>');
    expect(html).toContain('<span class="usd-comment"># comment</span>');
  });
});
