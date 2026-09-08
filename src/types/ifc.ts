export type IfcColorMode = "original" | "category" | "element";
export type IfcElement = {
  id: number;
  guid?: string;
  name: string;
  category: string;
  storey: string;
  building: string;
};

export type IfcDetailSection = {
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
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => IfcInspectionSnapshot;
  setColorMode: (mode: IfcColorMode) => Promise<void>;
  select: (key: string | null) => Promise<void>;
  dispose: () => Promise<void>;
};
