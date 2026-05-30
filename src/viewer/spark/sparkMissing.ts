/**
 * Runtime shim for `@sparkjsdev/spark` used when the optional Gaussian Splat
 * Loader Pack is not installed. Vite aliases the bare `@sparkjsdev/spark`
 * import to this module (see vite.config.ts) so that builds without the
 * dependency still resolve, throwing a descriptive error only when a splat is
 * actually opened.
 */

function missingSparkLoader(): never {
  throw new Error(
    "Gaussian Splat Loader Pack (@sparkjsdev/spark) is not installed. Install it to enable Gaussian Splat (.ply/.splat/.spz/.ksplat) preview.",
  );
}

export class SplatMesh {
  constructor() {
    missingSparkLoader();
  }
}

export class SparkRenderer {
  constructor() {
    missingSparkLoader();
  }
}

export class PackedSplats {
  constructor() {
    missingSparkLoader();
  }
}
