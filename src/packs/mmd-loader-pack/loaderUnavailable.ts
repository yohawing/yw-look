import "./locales";
import { LocalizedError } from "../../lib/localizedMessage";
import type { LoadedMmdMotion, LoadedPreview } from "../../types/viewer";

function missingMmdLoader(): never {
  throw new LocalizedError(
    "mmd-loader-pack:unavailable",
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

export async function syncMmdPreviewSpecularDirection() {
  return;
}
