export function formatFileKindLabel(kind: string) {
  switch (kind.toLowerCase()) {
    case "model":
      return "Model";
    case "texture":
      return "Texture";
    case "motion":
      return "Motion";
    default:
      return kind;
  }
}
