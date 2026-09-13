import "./locales";
import { LocalizedError } from "../../lib/localizedMessage";
import type { SelectedFile } from "../../lib/files";
import type { LoadedPreview, LoaderContext } from "../../types/viewer";

export async function loadIfcPreviewObject(
  _file: SelectedFile,
  _context: LoaderContext,
): Promise<LoadedPreview> {
  void _file;
  void _context;
  throw new LocalizedError(
    "ifc-loader-pack:unavailable",
    "CAD Loader Pack (@thatopen/fragments + web-ifc) is not installed. Install it to enable IFC (.ifc) preview.",
  );
}
