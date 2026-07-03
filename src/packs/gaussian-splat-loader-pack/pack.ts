import type { FormatPack } from "../../types/format-pack";
import { loadSparkPreviewObject } from "./loader";

const HAS_SPARK_LOADER =
  typeof __YW_HAS_SPARK_LOADER__ === "boolean" ? __YW_HAS_SPARK_LOADER__ : true;

export const gaussianSplatLoaderPack = {
  id: "gaussian-splat-loader-pack",
  name: "Gaussian Splat Loader Pack",
  extensions: ["splat", "spz", "ksplat", "sog"],
  optional: true,
  installed: HAS_SPARK_LOADER,
  loadPreviewObject: loadSparkPreviewObject,
} satisfies FormatPack;
