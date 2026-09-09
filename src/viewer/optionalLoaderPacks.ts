export const optionalLoaderPackDefinitions = [
  {
    id: "vrm-loader-pack",
    name: "VRM Loader Pack",
    extensions: [
      { extension: "vrm", formatLabel: "VRM" },
      { extension: "vrma", formatLabel: "VRMA" },
    ],
  },
  {
    id: "mmd-loader-pack",
    name: "MMD Loader Pack",
    extensions: [
      { extension: "pmx", formatLabel: "PMX" },
      { extension: "pmd", formatLabel: "PMD" },
      { extension: "vmd", formatLabel: "VMD" },
    ],
  },
  {
    id: "gaussian-splat-loader-pack",
    name: "Gaussian Splat Loader Pack",
    extensions: [
      { extension: "splat", formatLabel: "Gaussian Splat" },
      { extension: "spz", formatLabel: "SPZ Gaussian Splat" },
      { extension: "ksplat", formatLabel: "KSPLAT Gaussian Splat" },
      { extension: "sog", formatLabel: "SOG Gaussian Splat" },
    ],
  },
  {
    id: "cad-loader-pack",
    name: "CAD Loader Pack",
    extensions: [
      { extension: "ifc", formatLabel: "IFC / BIM" },
      { extension: "3dm", formatLabel: "Rhino 3DM" },
      { extension: "3mf", formatLabel: "3MF" },
    ],
  },
] as const;

export function getOptionalLoaderPackDefinition(id: string) {
  return (
    optionalLoaderPackDefinitions.find((definition) => definition.id === id) ??
    null
  );
}

export function getOptionalLoaderDefinitionByExtension(extension: string) {
  const normalizedExtension = extension.toLowerCase();
  for (const pack of optionalLoaderPackDefinitions) {
    const entry = pack.extensions.find(
      (packExtension) => packExtension.extension === normalizedExtension,
    );
    if (entry) {
      return {
        ...entry,
        loaderPackId: pack.id,
        loaderPackName: pack.name,
      };
    }
  }
  return null;
}

export function getOptionalLoaderMessageInfo(extension: string) {
  const definition = getOptionalLoaderDefinitionByExtension(extension);
  if (!definition) {
    return null;
  }

  return {
    formatLabel: definition.formatLabel,
    loaderPackName: definition.loaderPackName,
  };
}
