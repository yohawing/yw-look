import { useEffect, type MutableRefObject } from "react";
import type { DirectionalLight } from "three";
import type { SceneContext } from "../types/viewer";
import {
  applyBackfaceCulling,
  applyBoundingBoxHelpers,
  applyDisplayMode,
  applySurfaceMaterialMode,
  applyShadows,
  applySkeletonHelpers,
  applyTextureFilter,
} from "../viewer";
import type {
  AssetViewportSceneDisplayProps,
  AssetViewportTextureProps,
} from "./types";

export function useSceneObjectEffects({
  backfaceCulling,
  displayMode,
  keyLightRef,
  sceneContextRef,
  showBoundingBoxes,
  showJointNames,
  showLocalAxis,
  showNormals,
  showShadows,
  showSkeleton,
  showUnlit,
  showVertexColors,
  textureFilterMode,
  viewerSurfaceMode,
}: Pick<
  AssetViewportSceneDisplayProps,
  | "backfaceCulling"
  | "displayMode"
  | "showBoundingBoxes"
  | "showJointNames"
  | "showLocalAxis"
  | "showNormals"
  | "showShadows"
  | "showSkeleton"
  | "showUnlit"
  | "showVertexColors"
  | "textureFilterMode"
> &
  Pick<AssetViewportTextureProps, "viewerSurfaceMode"> & {
    keyLightRef: MutableRefObject<DirectionalLight | null>;
    sceneContextRef: MutableRefObject<SceneContext | null>;
  }) {
  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.sourceObject) {
      return;
    }

    applyDisplayMode(context.sourceObject, displayMode);
  }, [displayMode, sceneContextRef]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.sourceObject) {
      return;
    }

    applyBackfaceCulling(context.sourceObject, backfaceCulling);
  }, [backfaceCulling, sceneContextRef]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.sourceObject) {
      return;
    }

    applyTextureFilter(context.sourceObject, textureFilterMode);
  }, [sceneContextRef, textureFilterMode]);

  useEffect(() => {
    const context = sceneContextRef.current;
    if (!context) {
      return;
    }
    applyShadows(
      context.scene,
      context.sourceObject,
      keyLightRef.current,
      showShadows,
    );
  }, [keyLightRef, sceneContextRef, showShadows]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.sourceObject) {
      return;
    }

    applySkeletonHelpers(
      context.scene,
      context.sourceObject,
      viewerSurfaceMode === "asset" &&
        (showSkeleton || context.boneOnlyPreview),
      showLocalAxis,
      showJointNames,
    );
  }, [
    sceneContextRef,
    showJointNames,
    showLocalAxis,
    showSkeleton,
    viewerSurfaceMode,
  ]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.sourceObject) {
      return;
    }

    applyBoundingBoxHelpers(
      context.scene,
      context.sourceObject,
      viewerSurfaceMode === "asset" && showBoundingBoxes,
    );
  }, [sceneContextRef, showBoundingBoxes, viewerSurfaceMode]);

  useEffect(() => {
    const context = sceneContextRef.current;

    if (!context?.sourceObject) {
      return;
    }

    applySurfaceMaterialMode(
      context.sourceObject,
      showNormals
        ? "normals"
        : showUnlit
          ? "unlit"
          : showVertexColors
            ? "vertexColors"
            : "shaded",
    );
  }, [sceneContextRef, showNormals, showUnlit, showVertexColors]);
}
