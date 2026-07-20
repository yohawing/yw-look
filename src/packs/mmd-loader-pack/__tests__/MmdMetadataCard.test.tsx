import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MmdMetadataCard } from "../ui/MmdMetadataCard";
import type { MmdAssetMetadata } from "../../../types/viewer";

const mmdMetadata: MmdAssetMetadata = {
  format: "pmx",
  version: 2.1,
  encoding: "utf-8",
  name: "初音ミク",
  englishName: "Hatsune Miku",
  comment: "model comment",
  englishComment: "english comment",
  counts: {},
  additionalUvCount: 1,
  indexSizes: null,
  trailingBytes: 0,
  sections: [],
  diagnostics: [],
};

describe("MmdMetadataCard", () => {
  it("renders provided MMD metadata", () => {
    render(<MmdMetadataCard metadata={mmdMetadata} />);

    expect(screen.queryByText("MMD Model")).not.toBeNull();
    expect(screen.queryByText("Hatsune Miku")).not.toBeNull();
    expect(screen.queryByText("PMX 2.1")).not.toBeNull();
  });
});
