import {
  ExclamationTriangleIcon,
  FileIcon,
  GearIcon,
  ImageIcon,
  InfoCircledIcon,
  LayersIcon,
  MixIcon,
} from "@radix-ui/react-icons";
import type { SidebarTabId } from "../types/ui";

export type { SidebarTabId } from "../types/ui";

export function SidebarTabIcon({ kind }: { kind: SidebarTabId }) {
  switch (kind) {
    case "properties":
      return <InfoCircledIcon aria-hidden="true" />;
    case "file":
      return <FileIcon aria-hidden="true" />;
    case "hierarchy":
      return <LayersIcon aria-hidden="true" />;
    case "materials":
      return <MixIcon aria-hidden="true" />;
    case "textures":
      return <ImageIcon aria-hidden="true" />;
    case "settings":
      return <GearIcon aria-hidden="true" />;
    case "warnings":
      return <ExclamationTriangleIcon aria-hidden="true" />;
  }
}
