import type { DirectoryListing, SelectedFile } from "../lib/files";
import type { RecentFilesPayload } from "../lib/recentFiles";
import type { StageInspection, StageSummary } from "../lib/usd";
import type { AssetMetadata } from "./assetMetadata";

const textureThumb = (label: string, a: string, b: string) =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop stop-color='${a.replace("#", "%23")}'/%3E%3Cstop offset='1' stop-color='${b.replace("#", "%23")}'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='96' height='96' fill='url(%23g)'/%3E%3Ctext x='48' y='53' text-anchor='middle' font-family='monospace' font-size='13' fill='white'%3E${label}%3C/text%3E%3C/svg%3E`;

export const debugPanelFile: SelectedFile = {
  path: "F:/Design/debug/yw-look-brushup-sample.glb",
  fileName: "yw-look-brushup-sample.glb",
  extension: "glb",
  kind: "model",
  parentDirectory: "F:/Design/debug",
};

export const debugPanelDirectoryListing: DirectoryListing = {
  currentIndex: 0,
  files: [
    debugPanelFile,
    {
      path: "F:/Design/debug/yw-look-brushup-v09.glb",
      fileName: "yw-look-brushup-v09.glb",
      extension: "glb",
      kind: "model",
      parentDirectory: "F:/Design/debug",
    },
    {
      path: "F:/Design/debug/yw-look-material-pass.usda",
      fileName: "yw-look-material-pass.usda",
      extension: "usda",
      kind: "model",
      parentDirectory: "F:/Design/debug",
    },
    {
      path: "F:/Design/debug/hero_basecolor.png",
      fileName: "hero_basecolor.png",
      extension: "png",
      kind: "texture",
      parentDirectory: "F:/Design/debug",
    },
    {
      path: "F:/Design/debug/studio_environment.hdr",
      fileName: "studio_environment.hdr",
      extension: "hdr",
      kind: "texture",
      parentDirectory: "F:/Design/debug",
    },
  ],
};

export const debugPanelRecentFiles: RecentFilesPayload = {
  recentFilesPath: "F:/Design/debug/.yw-look-recent.json",
  entries: [
    {
      path: "F:/Design/debug/yw-look-brushup-sample.glb",
      kind: "model",
      lastAccessedAt: "2026-05-01 14:22",
    },
    {
      path: "F:/Develop/yw-look/samples/private/usd/Kitchen_set/Kitchen_set.usd",
      kind: "model",
      lastAccessedAt: "2026-05-01 13:58",
    },
    {
      path: "F:/Design/debug/hero_basecolor.png",
      kind: "texture",
      lastAccessedAt: "2026-05-01 13:12",
    },
  ],
};

export const debugPanelMetadata: AssetMetadata = {
  formatLabel: "glTF Binary",
  formatVersion: "2.0",
  nodeCount: 42,
  meshCount: 12,
  materialCount: 4,
  textureCount: 5,
  hasAnimation: true,
  objectInfo: {},
  hierarchy: [
    {
      name: "World",
      kind: "Xform",
      primPath: "/World",
      children: [
        {
          name: "HeroAsset",
          kind: "Xform",
          primPath: "/World/HeroAsset",
          children: [
            {
              name: "Body_GEO",
              kind: "Mesh",
              primPath: "/World/HeroAsset/Body_GEO",
              children: [],
            },
            {
              name: "Trim_GEO",
              kind: "Mesh",
              primPath: "/World/HeroAsset/Trim_GEO",
              children: [],
            },
            {
              name: "Glass_GEO",
              kind: "Mesh",
              primPath: "/World/HeroAsset/Glass_GEO",
              children: [],
            },
          ],
        },
        {
          name: "Rig",
          kind: "Skeleton",
          primPath: "/World/Rig",
          children: [
            {
              name: "Root",
              kind: "Joint",
              primPath: "/World/Rig/Root",
              children: [
                {
                  name: "Arm_L",
                  kind: "Joint",
                  primPath: "/World/Rig/Root/Arm_L",
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  textures: [
    {
      id: "base-color",
      label: "hero_basecolor.png",
      channel: "Base Color",
      dimensions: "2048 x 2048",
      thumbnailUrl: textureThumb("ALB", "#4f6eea", "#d89947"),
      sourceKind: "external",
    },
    {
      id: "normal",
      label: "hero_normal.png",
      channel: "Normal",
      dimensions: "2048 x 2048",
      thumbnailUrl: textureThumb("NRM", "#5b7fff", "#b77cff"),
      sourceKind: "external",
    },
    {
      id: "roughness",
      label: "hero_roughness.png",
      channel: "Roughness",
      dimensions: "1024 x 1024",
      thumbnailUrl: textureThumb("RGH", "#60656f", "#c3c7cf"),
      sourceKind: "embedded",
    },
    {
      id: "emissive",
      label: "hero_emissive.png",
      channel: "Emissive",
      dimensions: "1024 x 1024",
      thumbnailUrl: textureThumb("EMS", "#112018", "#32d583"),
      sourceKind: "embedded",
    },
    {
      id: "missing-mask",
      label: "trim_opacity_mask.png",
      channel: "Opacity",
      dimensions: "unresolved",
      thumbnailUrl: null,
      sourceKind: "unresolved",
    },
  ],
  materials: [
    {
      id: "paint",
      name: "Painted Metal",
      type: "MeshStandardMaterial",
      color: "#4F6EEA",
      opacity: 1,
      transparent: false,
      textureCount: 3,
      boundMeshes: ["Body_GEO", "Trim_GEO"],
      baseColorFactor: [0.31, 0.43, 0.92, 1],
      metallicFactor: 0.72,
      roughnessFactor: 0.36,
      emissiveFactor: [0, 0, 0],
      baseColorTexture: { name: "hero_basecolor.png" },
      metallicRoughnessTexture: { name: "hero_roughness.png" },
      normalTexture: { name: "hero_normal.png" },
      emissiveTexture: null,
      alphaMode: "OPAQUE",
      usdPrimPath: "/World/Looks/PaintedMetal",
    },
    {
      id: "glass",
      name: "Smoked Glass",
      type: "MeshPhysicalMaterial",
      color: "#8FB7C8",
      opacity: 0.42,
      transparent: true,
      textureCount: 1,
      boundMeshes: ["Glass_GEO"],
      baseColorFactor: [0.56, 0.72, 0.78, 0.42],
      metallicFactor: 0,
      roughnessFactor: 0.08,
      emissiveFactor: [0, 0, 0],
      baseColorTexture: null,
      metallicRoughnessTexture: null,
      normalTexture: null,
      emissiveTexture: null,
      alphaMode: "BLEND",
      usdPrimPath: "/World/Looks/SmokedGlass",
    },
    {
      id: "emissive-strip",
      name: "Signal Emissive",
      type: "MeshStandardMaterial",
      color: "#32D583",
      opacity: 1,
      transparent: false,
      textureCount: 1,
      boundMeshes: ["Signal_GEO"],
      baseColorFactor: [0.2, 0.84, 0.51, 1],
      metallicFactor: 0,
      roughnessFactor: 0.45,
      emissiveFactor: [0.2, 0.84, 0.51],
      baseColorTexture: null,
      metallicRoughnessTexture: null,
      normalTexture: null,
      emissiveTexture: { name: "hero_emissive.png" },
      alphaMode: "OPAQUE",
      usdPrimPath: "/World/Looks/SignalEmissive",
    },
    {
      id: "rubber",
      name: "Soft Black Rubber",
      type: "MeshStandardMaterial",
      color: "#1D2026",
      opacity: 1,
      transparent: false,
      textureCount: 0,
      boundMeshes: ["Grip_GEO"],
      baseColorFactor: [0.11, 0.13, 0.15, 1],
      metallicFactor: 0,
      roughnessFactor: 0.82,
      emissiveFactor: [0, 0, 0],
      baseColorTexture: null,
      metallicRoughnessTexture: null,
      normalTexture: null,
      emissiveTexture: null,
      alphaMode: "OPAQUE",
      usdPrimPath: "/World/Looks/SoftBlackRubber",
    },
  ],
  lights: [
    {
      id: "key",
      name: "Key_Light",
      type: "DirectionalLight",
      color: "#FFE7C2",
      intensity: 3.2,
    },
    {
      id: "rim",
      name: "Rim_Light",
      type: "PointLight",
      color: "#8FB7FF",
      intensity: 1.6,
    },
  ],
  cameras: [
    {
      id: "shot-main",
      name: "Camera_Main",
      projection: "perspective",
      fov: 35,
      aspect: 1.778,
      near: 0.1,
      far: 500,
    },
    {
      id: "shot-detail",
      name: "Camera_Detail",
      projection: "perspective",
      fov: 55,
      aspect: 1.778,
      near: 0.05,
      far: 200,
    },
  ],
};

export const debugPanelWarnings = [
  "Texture reference is unresolved: trim_opacity_mask.png",
  "USD warning: authored displayColor differs from material binding (/World/HeroAsset/Trim_GEO)",
];

export const debugUsdSummary: StageSummary = {
  path: "F:/Design/debug/yw-look-brushup-sample.usda",
  layerCount: 3,
  rootPrimCount: 1,
  meshCount: 12,
  payloadCount: 2,
  unloadedPayloadCount: 1,
  hasVariants: true,
  primTypeCounts: [
    { typeName: "Xform", count: 8 },
    { typeName: "Mesh", count: 12 },
    { typeName: "Material", count: 4 },
  ],
  totalVertices: 48216,
  totalTriangles: 92340,
  variantSetCount: 2,
  durationSeconds: 4.2,
  resolvedReferenceCount: 5,
  unresolvedReferenceCount: 1,
  resolvedPayloadCount: 1,
  unresolvedPayloadCount: 0,
  warnings: ["Debug fixture: one payload is deferred."],
  loadPolicy: "noPayloads",
};

export const debugUsdInspection: StageInspection = {
  path: "F:/Develop/yw-look/samples/private/usd/Kitchen_set/Kitchen_set.usd",
  defaultPrim: "Kitchen_set",
  upAxis: "Y",
  metersPerUnit: 0.01,
  timeCodesPerSecond: 24,
  framesPerSecond: 24,
  startTimeCode: 1,
  endTimeCode: 101,
  comment: null,
  rootLayerIsBinary: false,
  rootPrims: ["Kitchen_set"],
  composedLayers: [],
  layers: [
    {
      identifier:
        "F:/Develop/yw-look/samples/private/usd/Kitchen_set/Kitchen_set.usd",
      depth: 0,
      muted: false,
      timeOffset: 0,
      timeScale: 1,
      comment: null,
    },
    {
      identifier:
        "F:/Develop/yw-look/samples/private/usd/Kitchen_set/assets/Props_grp/North_grp/NorthWall_grp/NailA_1.usda",
      depth: 1,
      muted: false,
      timeOffset: 0,
      timeScale: 1,
      comment: "Debug layer row with a long resolved path.",
    },
  ],
  references: [],
  payloads: [],
  inherits: [],
  specializes: [],
  variantSelectionArcs: [],
  missingAssets: [],
  variantSets: [
    {
      primPath: "/Kitchen_set/Props_grp/North_grp/NorthWall_grp/NailA_1",
      setName: "modelingVariant",
      selection: "NailA",
      variants: ["NailA", "NailB", "PanB"],
    },
    {
      primPath: "/Kitchen_set/Props_grp/North_grp/NorthWall_grp/PotBLight_1",
      setName: "shadingVariant",
      selection: "Light",
      variants: ["Light", "Dark"],
    },
    {
      primPath: "/Kitchen_set/Props_grp/North_grp/NorthWall_grp/PotBLight_2",
      setName: "modelingVariant",
      selection: "PotB",
      variants: ["PotA", "PotB"],
    },
  ],
  loadPolicy: "noPayloads",
};
