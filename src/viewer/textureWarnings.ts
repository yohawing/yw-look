export function formatMissingTextureWarnings(paths: string[]) {
  if (paths.length === 0) {
    return [];
  }

  const uniquePaths = [...new Set(paths)];
  const listedPaths = uniquePaths.slice(0, 5).join(", ");
  const suffix =
    uniquePaths.length > 5 ? `, +${uniquePaths.length - 5} more` : "";
  return [
    `Missing texture reference${uniquePaths.length === 1 ? "" : "s"}: ${listedPaths}${suffix}. Fallback material was used.`,
  ];
}
