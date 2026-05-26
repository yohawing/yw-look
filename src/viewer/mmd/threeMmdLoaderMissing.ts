function missingMmdLoader(): never {
  throw new Error(
    "MMD Loader Pack is not installed. Install @yohawing/three-mmd-loader to enable PMX, PMD, and VMD support.",
  );
}

export class ThreeMmdLoader {
  constructor() {
    missingMmdLoader();
  }
}

export function parsePmdMetadata(): never {
  return missingMmdLoader();
}

export function parsePmdSectionInventory(): never {
  return missingMmdLoader();
}

export function parsePmxMetadata(): never {
  return missingMmdLoader();
}

export function parsePmxSectionInventory(): never {
  return missingMmdLoader();
}

export function parseVmd(): never {
  return missingMmdLoader();
}

export function createAmmoMmdPhysicsBackend(): never {
  return missingMmdLoader();
}

export function loadAmmoNamespace(): never {
  return missingMmdLoader();
}
