import { useEffect, type RefObject } from "react";
import type { SelectedFile } from "../lib/files";
import type { TextureViewMode, ViewerSurfaceMode } from "../types/viewer";
import {
  createTextureViewerObject,
  disposePreviewObject,
  type SceneContext,
} from "../viewer";
import { frameMountedObject } from "./camera";
import { shouldFlipTexturePreviewY } from "./renderSettings";

type UseTexturePreviewOptions = {
  currentFile: SelectedFile | null;
  selectedTextureId: string | null;
  textureBlackPoint: number;
  textureExposure: number;
  textureGamma: number;
  textureTileCount: number;
  textureViewMode: TextureViewMode;
  textureWhitePoint: number;
  viewerSurfaceMode: ViewerSurfaceMode;
  texturePreview3D: boolean;
  sceneContextRef: RefObject<SceneContext | null>;
  viewerSurfaceModeRef: RefObject<ViewerSurfaceMode>;
  showGridRef: RefObject<boolean>;
  showAxesRef: RefObject<boolean>;
  cameraSpeedMultiplierRef: RefObject<number>;
  texturePreview3DRef: RefObject<boolean>;
};

export function useTexturePreview({
  currentFile,
  selectedTextureId,
  textureBlackPoint,
  textureExposure,
  textureGamma,
  textureTileCount,
  textureViewMode,
  textureWhitePoint,
  viewerSurfaceMode,
  texturePreview3D,
  sceneContextRef,
  viewerSurfaceModeRef,
  showGridRef,
  showAxesRef,
  cameraSpeedMultiplierRef,
  texturePreview3DRef,
}: UseTexturePreviewOptions) {
  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.sourceObject) {
      return;
    }

    if (context.previewObject) {
      context.scene.remove(context.previewObject);
      disposePreviewObject(context.previewObject);
      context.previewObject = null;
    }

    if (
      viewerSurfaceMode !== "texture" ||
      !selectedTextureId ||
      !context.textureRegistry.has(selectedTextureId)
    ) {
      context.sourceObject.visible = true;
      context.mountedObject = context.sourceObject;
      frameMountedObject(
        context,
        context.sourceObject,
        viewerSurfaceModeRef.current,
        showGridRef.current,
        showAxesRef.current,
        cameraSpeedMultiplierRef.current,
        context.rawMaxDimension,
        texturePreview3DRef.current,
      );
      return;
    }

    const selectedTexture = context.textureRegistry.get(selectedTextureId);
    if (!selectedTexture) {
      return;
    }

    const previewObject = createTextureViewerObject(
      selectedTexture,
      textureViewMode,
      textureExposure,
      textureBlackPoint,
      textureWhitePoint,
      textureTileCount,
      textureGamma,
      shouldFlipTexturePreviewY(selectedTexture, currentFile),
    );
    context.sourceObject.visible = false;
    context.previewObject = previewObject;
    context.mountedObject = previewObject;
    context.scene.add(previewObject);
    frameMountedObject(
      context,
      previewObject,
      viewerSurfaceModeRef.current,
      showGridRef.current,
      showAxesRef.current,
      cameraSpeedMultiplierRef.current,
      undefined,
      texturePreview3DRef.current,
    );
  }, [
    selectedTextureId,
    textureBlackPoint,
    textureExposure,
    textureGamma,
    textureTileCount,
    textureViewMode,
    textureWhitePoint,
    currentFile,
    viewerSurfaceMode,
  ]);

  // Toggling between flat 2D image-viewer framing and orbitable 3D
  // plane preview only takes effect when a texture is currently
  // mounted; otherwise the viewport is showing the asset and the
  // flag is irrelevant until the user enters texture mode.
  useEffect(() => {
    const context = sceneContextRef.current;
    if (!context?.mountedObject || viewerSurfaceModeRef.current !== "texture") {
      return;
    }
    frameMountedObject(
      context,
      context.mountedObject,
      viewerSurfaceModeRef.current,
      showGridRef.current,
      showAxesRef.current,
      cameraSpeedMultiplierRef.current,
      undefined,
      texturePreview3D,
    );
  }, [texturePreview3D]);
}
