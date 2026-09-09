import type { FormatPack } from "../../types/format-pack";
import { loadRhino3dmPreviewObject } from "./loader";

export const rhino3dmLoaderPack = {
  id: "rhino3dm-loader-pack",
  name: "Rhino 3DM Loader Pack",
  extensions: ["3dm"],
  loadPreviewObject: loadRhino3dmPreviewObject,
} satisfies FormatPack;
