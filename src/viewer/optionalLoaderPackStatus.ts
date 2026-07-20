import type { OptionalLoaderPackManifest } from "../types/ipc";
import type { OptionalLoaderPackStatus, RegisteredLoaderInfo } from "./types";

export function summarizeOptionalLoaderPacks(
  loaders: readonly RegisteredLoaderInfo[],
  settings: Record<string, { enabled?: boolean } | undefined> = {},
  manifests: readonly OptionalLoaderPackManifest[] = [],
): OptionalLoaderPackStatus[] {
  const packs = new Map<string, OptionalLoaderPackStatus>();
  const manifestsById = new Map(
    manifests.map((manifest) => [manifest.id, manifest] as const),
  );

  for (const loader of loaders) {
    if (!loader.optional) {
      continue;
    }

    const manifest = manifestsById.get(loader.id);
    const manifestInstalled = manifest !== undefined;
    const enabled =
      optionalLoaderPackEnabled(loader.id, settings) &&
      optionalLoaderPackCompatible(manifest);
    const existing = packs.get(loader.id);
    if (existing) {
      const nextManifestInstalled =
        existing.manifestInstalled || manifestInstalled;
      const nextRuntimeAvailable =
        existing.runtimeAvailable && loader.installed;
      const nextEnabled = existing.enabled && enabled;
      packs.set(loader.id, {
        ...existing,
        extensions: [
          ...new Set([...existing.extensions, loader.extension]),
        ].sort(),
        installed: nextRuntimeAvailable,
        manifestInstalled: nextManifestInstalled,
        runtimeAvailable: nextRuntimeAvailable,
        enabled: nextEnabled,
        version: existing.version ?? manifest?.version,
        compatibility: describeOptionalLoaderPackCompatibility({
          enabled: nextEnabled,
          manifest,
          manifestInstalled: nextManifestInstalled,
          runtimeAvailable: nextRuntimeAvailable,
        }),
      });
      continue;
    }

    const runtimeAvailable = loader.installed;
    packs.set(loader.id, {
      id: loader.id,
      name: loader.name,
      extensions: [loader.extension],
      installed: runtimeAvailable,
      enabled,
      manifestInstalled,
      runtimeAvailable,
      version: manifest?.version,
      compatibility: describeOptionalLoaderPackCompatibility({
        enabled,
        manifest,
        manifestInstalled,
        runtimeAvailable,
      }),
    });
  }

  return [...packs.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function disabledOptionalLoaderPackIds(
  settings:
    | Record<string, { enabled?: boolean } | undefined>
    | null
    | undefined,
): string[] {
  if (!settings) {
    return [];
  }

  return Object.entries(settings)
    .filter(([, value]) => value?.enabled === false)
    .map(([id]) => id)
    .sort();
}

export function incompatibleOptionalLoaderPackIds(
  manifests: readonly OptionalLoaderPackManifest[],
): string[] {
  return manifests
    .filter((manifest) => !optionalLoaderPackCompatible(manifest))
    .map((manifest) => manifest.id)
    .sort();
}

function optionalLoaderPackEnabled(
  id: string,
  settings: Record<string, { enabled?: boolean } | undefined>,
): boolean {
  return settings[id]?.enabled !== false;
}

function optionalLoaderPackCompatible(
  manifest: OptionalLoaderPackManifest | undefined,
): boolean {
  return !manifest || manifest.compatibility.state === "compatible";
}

function describeOptionalLoaderPackCompatibility({
  enabled,
  manifest,
  manifestInstalled,
  runtimeAvailable,
}: {
  enabled: boolean;
  manifest: OptionalLoaderPackManifest | undefined;
  manifestInstalled: boolean;
  runtimeAvailable: boolean;
}): OptionalLoaderPackStatus["compatibility"] {
  if (!runtimeAvailable) {
    return {
      state: "runtimeMissing",
      label: "Runtime missing",
      detail: "This build does not include the loader runtime for this pack.",
    };
  }

  const manifestState = manifest?.compatibility.state;
  if (manifestState === "requiresNewerApp") {
    return {
      state: "requiresNewerApp",
      label: "App update required",
      detail: manifest?.compatibility.message ?? undefined,
    };
  }
  if (manifestState === "requiresOlderApp") {
    return {
      state: "requiresOlderApp",
      label: "Older app required",
      detail: manifest?.compatibility.message ?? undefined,
    };
  }
  if (manifestState && manifestState !== "compatible") {
    return {
      state: "unknown",
      label: "Compatibility unknown",
      detail: manifest?.compatibility.message ?? undefined,
    };
  }

  if (!enabled) {
    return {
      state: "disabled",
      label: "Disabled",
      detail: "The pack is installed but not registered for preview loading.",
    };
  }

  if (manifestInstalled) {
    return {
      state: "compatible",
      label: "Compatible",
      detail: manifest?.compatibility.message ?? undefined,
    };
  }

  return {
    state: "bundled",
    label: "Bundled runtime",
    detail:
      "The loader is bundled with this build but has no managed manifest.",
  };
}

export function isOptionalLoaderPackDisabled(
  id: string,
  disabledIds: readonly string[] | ReadonlySet<string> | undefined,
): boolean {
  if (!disabledIds) {
    return false;
  }
  return "has" in disabledIds ? disabledIds.has(id) : disabledIds.includes(id);
}
