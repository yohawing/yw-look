import type { LoadedMmdMotion, LoadedPreview } from "../types";

function missingMmdLoader(): never {
  throw new Error(
    "MMD Loader Pack is not installed. Install @yohawing/three-mmd-loader to enable PMX, PMD, and VMD support.",
  );
}

export async function loadMmdPreviewObject(): Promise<LoadedPreview> {
  missingMmdLoader();
}

export async function loadMmdMotionPreviewObject(): Promise<LoadedPreview> {
  missingMmdLoader();
}

export async function loadMmdMotion(): Promise<LoadedMmdMotion> {
  missingMmdLoader();
}
