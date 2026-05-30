import type { LoadedPreview } from "../types";

function missingSparkLoader(): never {
  throw new Error(
    "Gaussian Splat Loader Pack (@sparkjsdev/spark) is not installed. Install it to enable Gaussian Splat (.ply/.splat/.spz/.ksplat) preview.",
  );
}

export async function loadSparkPreviewObject(): Promise<LoadedPreview> {
  missingSparkLoader();
}
