import { t, useLocale } from "../lib/i18n";
import { MaterialBrowser } from "./MaterialBrowser";
import { IfcMaterialsPanel } from "./IfcMaterialsPanel";
import { useMemo, useState } from "react";
import { useDebugPanelFixtures } from "../hooks/useDebugPanelFixtures";
import { rgbToHex } from "../lib/format";
import { useFileStore } from "../stores/fileStore";
import type {
  MaterialEntry,
  MaterialTextureSlot,
  MmdMaterialEntry,
} from "./assetMetadata";
import { SidebarEmpty } from "../lib/sidebarPrimitives";
import { Badge } from "./ui/Badge";
import { Disclosure } from "./ui/Disclosure";
import { KeyValueRows, type KeyValueRow } from "./ui/KeyValueRows";
import "../styles/material-list.css";

type MaterialListCardProps = {
  debugPanelsEnabled?: boolean;
};

const EMPTY_MATERIALS: MaterialEntry[] = [];

/** Format a 0-1 float as a 0-255 decimal integer string for display. */
function fmt255(v: number): string {
  return String(Math.round(v * 255));
}

function fmtFloat(v: number): string {
  return v.toFixed(3).replace(/\.?0+$/, "");
}

function fmtVec(values: readonly number[]): string {
  return values.map(fmtFloat).join(", ");
}

function fmtTexturePath(path: string | null): string {
  return path ?? "none";
}

function fmtFlags(flags: Record<string, boolean> | null): string {
  if (!flags) return "none";
  const enabled = Object.entries(flags)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
  return enabled.length > 0 ? enabled.join(", ") : "none";
}

function textureSlotRow(
  id: string,
  label: string,
  slot: MaterialTextureSlot | null,
): KeyValueRow | null {
  return slot
    ? {
        id,
        label,
        mono: true,
        value: (
          <span
            className="mat-slot-texture"
            title={slot.sourcePath ?? slot.name}
          >
            {slot.name}
          </span>
        ),
      }
    : null;
}

function MmdColorValue({
  value,
}: {
  value: [number, number, number] | [number, number, number, number] | null;
}) {
  useLocale();
  if (!value) return "none";
  const color = rgbToHex(value[0], value[1], value[2]);
  return (
    <span
      className="material-detail-value material-detail-color"
      title={`${color} (${fmtVec(value)})`}
    >
      <span className="mat-inline-swatch" style={{ background: color }} />
      <span>{color}</span>
      <span>({fmtVec(value)})</span>
    </span>
  );
}

function MmdMaterialDetails({ mmd }: { mmd: MmdMaterialEntry | null }) {
  useLocale();
  if (!mmd) return null;
  const flags = fmtFlags(mmd.flags);
  const rows: KeyValueRow[] = [
    mmd.materialIndex !== null && {
      id: "index",
      label: t("index"),
      value: mmd.materialIndex,
      mono: true,
    },
    mmd.englishName &&
      mmd.englishName !== mmd.name && {
        id: "english",
        label: "English",
        value: mmd.englishName,
      },
    mmd.diffuse && {
      id: "diffuse",
      label: t("diffuse"),
      value: <MmdColorValue value={mmd.diffuse} />,
      mono: true,
    },
    mmd.specular && {
      id: "specular",
      label: t("specular"),
      value: <MmdColorValue value={mmd.specular} />,
      mono: true,
    },
    mmd.specularPower !== null && {
      id: "specular-power",
      label: t("spec_power"),
      value: fmtFloat(mmd.specularPower),
      mono: true,
    },
    mmd.ambient && {
      id: "ambient",
      label: t("ambient"),
      value: <MmdColorValue value={mmd.ambient} />,
      mono: true,
    },
    mmd.edgeColor && {
      id: "edge",
      label: t("edge"),
      value: <MmdColorValue value={mmd.edgeColor} />,
      mono: true,
    },
    mmd.edgeSize !== null && {
      id: "edge-size",
      label: t("edge_size"),
      value: fmtFloat(mmd.edgeSize),
      mono: true,
    },
    {
      id: "texture",
      label: t("texture"),
      value: fmtTexturePath(mmd.texturePath),
      mono: true,
    },
    {
      id: "sphere",
      label: t("sphere"),
      value: `${fmtTexturePath(mmd.sphereTexturePath)}${mmd.sphereMode ? ` (${mmd.sphereMode})` : ""}`,
      mono: true,
    },
    {
      id: "toon",
      label: t("toon"),
      value: `${fmtTexturePath(mmd.toonTexturePath)}${mmd.sharedToonIndex !== null ? ` shared:${mmd.sharedToonIndex}` : ""}`,
      mono: true,
    },
    mmd.transparencyMode && {
      id: "transparency",
      label: t("transparency"),
      value: <Badge size="sm">{mmd.transparencyMode}</Badge>,
    },
    mmd.renderOrderBucket && {
      id: "render-order",
      label: t("render_order"),
      value: mmd.renderOrderBucket,
      mono: true,
    },
    mmd.faceCount !== null && {
      id: "faces",
      label: t("faces"),
      value: mmd.faceCount,
      mono: true,
    },
    {
      id: "flags",
      label: t("flags"),
      value: <span title={flags}>{flags}</span>,
      mono: true,
    },
    mmd.unsupportedDrawFlags.length > 0 && {
      id: "unsupported",
      label: t("unsupported"),
      value: mmd.unsupportedDrawFlags.join(", "),
      tone: "warn",
      mono: true,
    },
  ].filter(Boolean) as KeyValueRow[];

  return (
    <Disclosure variant="inline" title={t("mmd_material")} defaultOpen>
      <KeyValueRows className="selected-kv" density="regular" rows={rows} />
    </Disclosure>
  );
}

function ShaderDetails({ mat }: { mat: MaterialEntry }) {
  useLocale();
  const rows = [
    mat.baseColorFactor !== null && {
      id: "base-color",
      label: t("base_color"),
      value: (
        <>
          <MaterialBaseColor mat={mat} />
          {mat.baseColorFactor[3] < 1 ? (
            <span> a:{fmt255(mat.baseColorFactor[3])}</span>
          ) : null}
        </>
      ),
    },
    mat.metallicFactor !== null && {
      id: "metallic",
      label: t("metallic"),
      value: mat.metallicFactor.toFixed(3),
      mono: true,
    },
    mat.roughnessFactor !== null && {
      id: "roughness",
      label: t("roughness"),
      value: mat.roughnessFactor.toFixed(3),
      mono: true,
    },
    mat.emissiveFactor?.some((value) => value > 0) && {
      id: "emissive",
      label: t("emissive"),
      value: (
        <span>
          <span
            className="mat-inline-swatch"
            style={{ background: rgbToHex(...mat.emissiveFactor) }}
          />
          {rgbToHex(...mat.emissiveFactor)}
        </span>
      ),
      mono: true,
    },
    textureSlotRow("color-texture", "Color Tex", mat.baseColorTexture),
    textureSlotRow(
      "metal-rough-texture",
      "Metal/Rough Tex",
      mat.metallicRoughnessTexture,
    ),
    textureSlotRow("normal-texture", "Normal Tex", mat.normalTexture),
    textureSlotRow("emissive-texture", "Emissive Tex", mat.emissiveTexture),
    mat.alphaMode !== "OPAQUE" &&
      mat.alphaMode !== "unknown" && {
        id: "alpha",
        label: t("alpha"),
        value: <Badge size="sm">{mat.alphaMode}</Badge>,
      },
    mat.usdPrimPath !== null && {
      id: "usd-path",
      label: t("usd_path"),
      value: <span title={mat.usdPrimPath}>{mat.usdPrimPath}</span>,
      mono: true,
    },
  ].filter(Boolean) as KeyValueRow[];
  if (rows.length === 0) return null;
  return (
    <Disclosure variant="inline" title={t("shader_inputs")} defaultOpen={false}>
      <KeyValueRows className="selected-kv" density="regular" rows={rows} />
    </Disclosure>
  );
}

function MaterialBaseColor({ mat }: { mat: MaterialEntry }) {
  useLocale();
  const color =
    mat.baseColorFactor !== null
      ? rgbToHex(
          mat.baseColorFactor[0],
          mat.baseColorFactor[1],
          mat.baseColorFactor[2],
        )
      : mat.color;

  return (
    <span className="material-detail-value material-detail-color">
      {color ? (
        <>
          <span className="mat-inline-swatch" style={{ background: color }} />
          {color}
        </>
      ) : (
        "unknown"
      )}
    </span>
  );
}

function MaterialDetailPanel({ mat }: { mat: MaterialEntry }) {
  useLocale();
  const rows: KeyValueRow[] = [
    { id: "shader", label: t("shader"), value: mat.type },
    {
      id: "base-color",
      label: t("base_color_2"),
      value: <MaterialBaseColor mat={mat} />,
    },
    mat.metallicFactor !== null && {
      id: "metallic",
      label: t("metallic"),
      value: mat.metallicFactor.toFixed(2),
      mono: true,
    },
    mat.roughnessFactor !== null && {
      id: "roughness",
      label: t("roughness"),
      value: mat.roughnessFactor.toFixed(2),
      mono: true,
    },
    {
      id: "alpha-mode",
      label: t("alpha_mode"),
      value: mat.alphaMode,
      tone: mat.alphaMode === "OPAQUE" ? "muted" : "default",
      mono: true,
    },
    {
      id: "opacity",
      label: t("opacity"),
      value: mat.opacity.toFixed(2),
      mono: true,
    },
    {
      id: "textures",
      label: t("textures"),
      value: mat.textureCount,
      mono: true,
    },
    {
      id: "bindings",
      label: t("bindings"),
      value: mat.boundMeshes.length,
      mono: true,
    },
  ].filter(Boolean) as KeyValueRow[];

  return (
    <section
      className="material-selected-panel"
      aria-label={t("selected_material")}
    >
      <KeyValueRows className="selected-kv" density="regular" rows={rows} />
      <MmdMaterialDetails mmd={mat.mmd} />
      <ShaderDetails mat={mat} />
    </section>
  );
}

export function MaterialListCard(props: MaterialListCardProps) {
  useLocale();
  const currentFilePath = useFileStore(
    (state) => state.currentFile?.path ?? null,
  );
  const packMetadata = useFileStore((state) => state.packMetadata);
  const { useDebugFixtures } = useDebugPanelFixtures(
    props.debugPanelsEnabled ?? false,
  );
  if (!useDebugFixtures && packMetadata?.kind === "ifc")
    return (
      <IfcMaterialsPanel
        key={currentFilePath}
        inspection={packMetadata.inspection}
      />
    );
  return (
    <MaterialListCardContent
      key={currentFilePath ?? "__no-file__"}
      {...props}
    />
  );
}

function MaterialListCardContent({
  debugPanelsEnabled = false,
}: MaterialListCardProps) {
  useLocale();
  const storeMaterials = useFileStore(
    (state) => state.assetMetadata?.materials,
  );
  const { debugFixtures, useDebugFixtures } =
    useDebugPanelFixtures(debugPanelsEnabled);
  const materials = useDebugFixtures
    ? debugFixtures.debugPanelMetadata.materials
    : (storeMaterials ?? EMPTY_MATERIALS);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const visibleMaterials = useMemo(
    () =>
      materials.flatMap((material, index) =>
        normalizedSearch.length === 0 ||
        material.name.toLocaleLowerCase().includes(normalizedSearch)
          ? [{ index, material }]
          : [],
      ),
    [materials, normalizedSearch],
  );
  const activeIndex =
    materials.length > 0 ? Math.min(selectedIndex, materials.length - 1) : -1;
  const selectedMaterial = activeIndex >= 0 ? materials[activeIndex] : null;

  return (
    <MaterialBrowser
      items={visibleMaterials.map(({ material: mat }) => ({
        id: mat.id,
        name: mat.name,
        color: mat.color,
        count: mat.textureCount,
        meta: (
          <>
            {mat.type} · {mat.textureCount}
            {t("tex")}
            {mat.transparent ? ` · a:${mat.opacity.toFixed(2)}` : ""}
            {mat.boundMeshes.length > 0
              ? ` · ${mat.boundMeshes.length} bind${mat.boundMeshes.length === 1 ? "" : "s"}`
              : ""}
          </>
        ),
      }))}
      total={materials.length}
      selectedId={selectedMaterial?.id ?? null}
      onSelect={(id) =>
        setSelectedIndex(materials.findIndex((mat) => mat.id === id))
      }
      query={searchQuery}
      onQueryChange={setSearchQuery}
      details={
        selectedMaterial ? (
          <MaterialDetailPanel mat={selectedMaterial} />
        ) : (
          <SidebarEmpty>{t("select_a_material_to_inspect_it")}</SidebarEmpty>
        )
      }
    />
  );
}
