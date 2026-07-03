import type { SelectedFile } from "../../lib/files";
import type { LoadedPreview, LoaderContext } from "../../types/viewer";

function missingSparkLoader(): never {
  throw new Error(
    "Gaussian Splat Loader Pack (@sparkjsdev/spark) is not installed. Install it to enable Gaussian Splat (.ply/.splat/.spz/.ksplat/.sog) preview.",
  );
}

export async function loadSparkPreviewObject(
  _file: SelectedFile,
  _context: LoaderContext,
  _fileBytes?: ArrayBuffer,
): Promise<LoadedPreview> {
  void _file;
  void _context;
  void _fileBytes;
  missingSparkLoader();
}
