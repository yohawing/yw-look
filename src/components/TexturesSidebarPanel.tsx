import { useCallback } from "react";
import { useViewerStore } from "../stores/viewerStore";
import type { TextureEntry } from "../types/viewer";
import { TextureListCard } from "./TextureListCard";

type TexturesSidebarPanelProps = {
  textures: TextureEntry[];
};

export function TexturesSidebarPanel({ textures }: TexturesSidebarPanelProps) {
  const selectedTextureId = useViewerStore((state) => state.selectedTextureId);
  const viewerSurfaceMode = useViewerStore((state) => state.viewerSurfaceMode);

  const handleSelectTexture = useCallback(
    (textureId: string) => {
      const { setSelectedTextureId, setViewerSurfaceMode } =
        useViewerStore.getState();

      if (textureId === selectedTextureId && viewerSurfaceMode === "texture") {
        setViewerSurfaceMode("asset");
        return;
      }

      setSelectedTextureId(textureId);
      setViewerSurfaceMode("texture");
    },
    [selectedTextureId, viewerSurfaceMode],
  );

  return (
    <TextureListCard
      activeTextureId={selectedTextureId ?? textures[0]?.id ?? null}
      onSelectTexture={handleSelectTexture}
      textures={textures}
    />
  );
}
