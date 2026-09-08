export type IfcColorMode = "original" | "category" | "element";
export type IfcElement = {
  id: number;
  guid?: string;
  groups?: readonly { id: number; name: string }[];
  name: string;
  category: string;
  storey: string;
  building: string;
};

export type IfcDetailSection = {
  group:
    | "Identity"
    | "Type"
    | "Materials"
    | "Element properties"
    | "Type properties"
    | "Quantities";
  name: string;
  rows: { name: string; value: string }[];
};

export type IfcInspectionSnapshot = {
  elements: readonly IfcElement[];
  selected: IfcElement | null;
  sections: readonly IfcDetailSection[];
  loading: boolean;
  error: string | null;
  limited: boolean;
  colorMode: IfcColorMode;
};

export type IfcInspection = {
  materials?: IfcMaterialCatalog;
  getDisplayMaterials?: () => readonly IfcMaterialRecord[];
  highlightMaterials?: (elementIds: readonly number[]) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => IfcInspectionSnapshot;
  setColorMode: (mode: IfcColorMode) => Promise<void>;
  select: (key: string | null) => Promise<void>;
  dispose: () => Promise<void>;
};

export type IfcMaterialRecord = {
  id: string;
  name: string;
  kind: "building" | "display";
  origin: "source" | "loader" | "fallback" | "category" | "element";
  rows: { name: string; value: string }[];
  elementIds: number[];
  shapeIds: number[];
  linkedIds: string[];
  color: string | null;
};
export type IfcMaterialCatalog = {
  building: IfcMaterialRecord[];
  display: IfcMaterialRecord[];
};
