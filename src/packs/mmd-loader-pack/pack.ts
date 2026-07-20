import { createElement } from "react";
import type { FormatPack } from "../../types/format-pack";
import { loadMmdMotionPreviewObject, loadMmdPreviewObject } from "./loader";
import { collectMmdMetadata } from "./metadata";
import { createMmdRuntime } from "./runtime";
import { MmdMetadataCard } from "./ui/MmdMetadataCard";

const HAS_THREE_MMD_LOADER =
  typeof __YW_HAS_THREE_MMD_LOADER__ === "boolean"
    ? __YW_HAS_THREE_MMD_LOADER__
    : true;
const MMD_MODEL_EXTENSIONS = new Set(["pmx", "pmd"]);

export const mmdLoaderPack = {
  id: "mmd-loader-pack",
  name: "MMD Loader Pack",
  extensions: ["pmx", "pmd", "vmd"],
  optional: true,
  installed: HAS_THREE_MMD_LOADER,
  collectMetadata: collectMmdMetadata,
  createRuntime: createMmdRuntime,
  MetadataCard: ({ metadata }) =>
    metadata.kind === "mmd"
      ? createElement(MmdMetadataCard, { metadata: metadata.asset })
      : null,
  loadPreviewObject: async (file, context) => {
    if (file.extension === "vmd") {
      return loadMmdMotionPreviewObject(file, context);
    }
    return loadMmdPreviewObject(file, context);
  },
  createFileRequest: (file, context) => {
    if (
      file.extension !== "vmd" ||
      !context.currentFile ||
      !MMD_MODEL_EXTENSIONS.has(context.currentFile.extension)
    ) {
      return null;
    }

    return {
      packId: "mmd-loader-pack",
      action: "apply-motion",
      file,
      version: context.version,
    };
  },
} satisfies FormatPack;
