function decodeDisplayPath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Display-only decomposition. Never use decoded names as resource keys. */
export function texturePackageSource(value: string): {
  containerPath: string;
  internalPath: string;
} | null {
  const rawMatch = /^(.*\.usdz)\[(.+)\]$/i.exec(value.trim());
  const match =
    rawMatch ?? /^(.*\.usdz)\[(.+)\]$/i.exec(decodeDisplayPath(value.trim()));
  if (!match) return null;
  return {
    containerPath: rawMatch ? decodeDisplayPath(match[1]) : match[1],
    internalPath: rawMatch ? decodeDisplayPath(match[2]) : match[2],
  };
}

export function textureSourceIdentity(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  // A Windows extended path or an archive member may contain '?' or '#'.
  // Only actual web URLs have query/fragment components to strip.
  return /^https?:\/\//i.test(normalized) && !texturePackageSource(value)
    ? normalized.split(/[?#]/, 1)[0]
    : normalized;
}

export function textureSourceFileName(value: string): string {
  const member = texturePackageSource(value)?.internalPath;
  const normalized = (member ?? textureSourceIdentity(value)).replace(
    /\\/g,
    "/",
  );
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  return member ? basename : decodeDisplayPath(basename || value.trim());
}
