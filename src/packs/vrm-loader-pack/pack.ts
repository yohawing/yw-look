import type { FormatPack } from "../../types/format-pack";
import { loadVrmPreviewObject } from "./loader";

export const vrmLoaderPack = {
  id: "vrm-loader-pack",
  name: "VRM Loader Pack",
  extensions: ["vrm"],
  optional: true,
  installed: true,
  loadPreviewObject: loadVrmPreviewObject,
} satisfies FormatPack;
