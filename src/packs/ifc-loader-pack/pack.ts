import type { FormatPack } from "../../types/format-pack";
import { loadIfcPreviewObject } from "./loader";

const HAS_IFC_LOADER =
  typeof __YW_HAS_IFC_LOADER__ === "boolean" ? __YW_HAS_IFC_LOADER__ : true;

export const ifcLoaderPack = {
  id: "ifc-loader-pack",
  name: "IFC Loader Pack",
  extensions: ["ifc"],
  optional: true,
  installed: HAS_IFC_LOADER,
  loadPreviewObject: loadIfcPreviewObject,
} satisfies FormatPack;
