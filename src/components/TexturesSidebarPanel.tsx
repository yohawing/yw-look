import { useCallback } from "react";
import { useDebugPanelFixtures } from "../hooks/useDebugPanelFixtures";
import { useFileStore } from "../stores/fileStore";
import { useViewerStore } from "../stores/viewerStore";
import type { TextureEntry } from "../types/viewer";
import { TextureListCard } from "./TextureListCard";

type TexturesSidebarPanelProps = {
  debugPanelsEnabled?: boolean;
};

const EMPTY_TEXTURES: TextureEntry[] = [];

export function TexturesSidebarPanel({
  debugPanelsEnabled = false,
}: TexturesSidebarPanelProps) {
  const storeTextures = useFileStore((state) => state.assetMetadata?.textures);
  const { debugFixtures, useDebugFixtures } =
    useDebugPanelFixtures(debugPanelsEnabled);
  const textures = useDebugFixtures
    ? debugFixtures.debugPanelMetadata.textures
    : (storeTextures ?? EMPTY_TEXTURES);
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
