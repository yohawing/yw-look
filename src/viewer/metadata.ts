import {
  AnimationClip,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  Object3D,
  Texture,
} from "three";
import type { SelectedFile } from "../lib/files";
import type {
  AssetMetadata,
  HierarchyNode,
  MaterialEntry,
} from "../components/assetMetadata";
import type { TextureSlotKey, TexturedMaterial } from "./types";
import { getMaterials } from "./scene";

export type MetadataCollection = {
  metadata: AssetMetadata;
  textureRegistry: Map<string, Texture>;
};

function getObjectKind(object: Object3D) {
  if (object instanceof Mesh) {
    return "mesh";
  }

  if (object instanceof Group) {
    return "group";
  }

  return object.type.toLowerCase();
}

function buildHierarchyNode(object: Object3D): HierarchyNode {
  return {
    name: object.name.trim() || "(unnamed)",
    kind: getObjectKind(object),
    children: object.children.map((child) => buildHierarchyNode(child)),
  };
}

function getMaterialColor(material: Material): string | null {
  if (
    material instanceof MeshStandardMaterial ||
    material instanceof MeshPhongMaterial ||
    material instanceof MeshBasicMaterial
  ) {
    return `#${material.color.getHexString()}`;
  }
  return null;
}

function countMaterialTextures(material: Material): number {
  const slots: TextureSlotKey[] = [
    "map",
    "normalMap",
    "metalnessMap",
    "roughnessMap",
    "emissiveMap",
    "alphaMap",
  ];
  let count = 0;
  for (const key of slots) {
    if ((material as TexturedMaterial)[key] instanceof Texture) {
      count += 1;
    }
  }
  return count;
}

function buildMaterialEntry(material: Material): MaterialEntry {
  const typeName = material.type
    .replace("Material", "")
    .replace(/([a-z])([A-Z])/g, "$1 $2");

  return {
    id: material.uuid,
    name: material.name.trim() || typeName,
    type: typeName,
    color: getMaterialColor(material),
    opacity: material.opacity,
    transparent: material.transparent,
    textureCount: countMaterialTextures(material),
  };
}

function getTextureDimensions(texture: Texture) {
  const image = texture.image as
    | { width?: number; height?: number }
    | undefined;

  if (
    image &&
    typeof image.width === "number" &&
    typeof image.height === "number"
  ) {
    return `${image.width}x${image.height}`;
  }

  return "unknown";
}

const THUMB_SIZE = 128;

function generateThumbnailUrl(texture: Texture): string | null {
  const image = texture.image as
    | HTMLImageElement
    | HTMLCanvasElement
    | ImageBitmap
    | undefined;

  if (!image) return null;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = THUMB_SIZE;
    canvas.height = THUMB_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(image as CanvasImageSource, 0, 0, THUMB_SIZE, THUMB_SIZE);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
}

function inferTextureSourceKind(
  texture: Texture,
  currentFile: SelectedFile,
): AssetMetadata["textures"][number]["sourceKind"] {
  const fromUserData = texture.userData.textureSourceKind;
  if (
    fromUserData === "embedded" ||
    fromUserData === "external" ||
    fromUserData === "standalone"
  ) {
    return fromUserData;
  }

  if (currentFile.kind === "texture") {
    return "standalone";
  }

  if (currentFile.extension === "glb") {
    return "embedded";
  }

  if (currentFile.extension === "obj") {
    return "external";
  }

  return "unknown";
}

export function collectAssetMetadata(
  object: Group | Mesh,
  currentFile: SelectedFile,
  clips: AnimationClip[],
  formatVersion: string | null,
): MetadataCollection {
  let nodeCount = 0;
  let meshCount = 0;
  const materials = new Set<Material>();
  const textures = new Map<string, AssetMetadata["textures"][number]>();
  const textureRegistry = new Map<string, Texture>();

  object.traverse((child: Object3D) => {
    nodeCount += 1;

    if (!(child instanceof Mesh)) {
      return;
    }

    meshCount += 1;

    for (const material of getMaterials(child.material)) {
      materials.add(material);

      const textureSlots = [
        ["Base Color", "map"],
        ["Normal", "normalMap"],
        ["Metalness", "metalnessMap"],
        ["Roughness", "roughnessMap"],
        ["Emissive", "emissiveMap"],
        ["Alpha", "alphaMap"],
      ] as const satisfies ReadonlyArray<readonly [string, TextureSlotKey]>;

      for (const [channel, key] of textureSlots) {
        const textureValue = (material as TexturedMaterial)[key];
        if (!(textureValue instanceof Texture)) {
          continue;
        }

        const textureId = String(textureValue.uuid);
        if (textures.has(textureId)) {
          continue;
        }

        textures.set(textureId, {
          id: textureId,
          label: textureValue.name.trim() || `${channel} Texture`,
          channel,
          dimensions: getTextureDimensions(textureValue),
          thumbnailUrl: generateThumbnailUrl(textureValue),
          sourceKind: inferTextureSourceKind(textureValue, currentFile),
        });
        textureRegistry.set(textureId, textureValue);
      }
    }
  });

  return {
    metadata: {
      formatLabel: currentFile.extension.toUpperCase(),
      formatVersion,
      nodeCount,
      meshCount,
      materialCount: materials.size,
      textureCount: textures.size,
      hasAnimation: clips.length > 0,
      hierarchy: [buildHierarchyNode(object)],
      textures: [...textures.values()],
      materials: [...materials].map(buildMaterialEntry),
    },
    textureRegistry,
  };
}

export function buildMissingReferenceMetadata(
  currentFile: SelectedFile,
  formatVersion: string | null,
  missingPaths: string[],
  unresolvedImages: string[],
): AssetMetadata {
  const textureEntries = unresolvedImages.map((path, index) => ({
    id: `unresolved:${path}:${index}`,
    label: path,
    channel: "Missing",
    dimensions: "unknown",
    thumbnailUrl: null,
    sourceKind: "unresolved" as const,
  }));

  return {
    formatLabel: currentFile.extension.toUpperCase(),
    formatVersion,
    nodeCount: 0,
    meshCount: 0,
    materialCount: 0,
    textureCount: textureEntries.length,
    hasAnimation: false,
    hierarchy: [],
    materials: [],
    textures:
      textureEntries.length > 0
        ? textureEntries
        : missingPaths.map((path, index) => ({
            id: `missing:${path}:${index}`,
            label: path,
            channel: "Missing Resource",
            dimensions: "unknown",
            thumbnailUrl: null,
            sourceKind: "unresolved" as const,
          })),
  };
}
